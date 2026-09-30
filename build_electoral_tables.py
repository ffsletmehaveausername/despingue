"""Build audited unit and precinct election tables from the original CEE files."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

import xlrd


ROOT = Path(__file__).resolve().parent
YEARS = (2008, 2012, 2016, 2020, 2024)
CONTESTS = ("estatal", "legislativa", "municipal", "plebiscito")


def source_directory(year: int) -> Path:
    parent = ROOT / "historical_partial" if year < 2016 else ROOT
    return parent / "cee_election_returns" / str(year)


def integer(value: object, description: str) -> int:
    try:
        parsed = Decimal(str(value).strip())
    except InvalidOperation as exc:
        raise ValueError(f"Invalid {description}: {value!r}") from exc
    if not parsed.is_finite() or parsed != parsed.to_integral_value():
        raise ValueError(f"Non-integral {description}: {value!r}")
    return int(parsed)


def source_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_source(
    label: str,
    path: Path,
    sheet: str | None,
    fields: list[str],
    rows: object,
    units: dict[tuple[int, int], dict[str, int]],
    columns: list[str],
) -> dict:
    if fields.count("PREKEY") != 1 or fields.count("UNIKEY") != 1:
        raise ValueError(f"Missing or repeated PREKEY/UNIKEY in {path}: {sheet}")
    named = [field for field in fields if field]
    if len(named) != len(set(named)):
        raise ValueError(f"Repeated source column in {path}: {sheet}")
    measures = [field for field in named if field not in ("PREKEY", "UNIKEY", "COLKEY") and not field.startswith("STATUS")]
    status = [field for field in named if field.startswith("STATUS")]
    row_column = f"{label}__SOURCE_ROWS"
    measures_by_name = {field: f"{label}__{field}" for field in measures}
    columns.extend([row_column, *measures_by_name.values()])

    totals = Counter()
    populated = Counter()
    status_values: dict[str, Counter[str]] = defaultdict(Counter)
    records = blank_rows = footer_rows = 0
    source_keys: set[tuple[int, int]] = set()
    for row_number, row in enumerate(rows, start=2):
        if None in row:
            raise ValueError(f"Extra CSV cells in {path} at row {row_number}")
        precinct_value = str(row.get("PREKEY", "")).strip()
        unit_value = str(row.get("UNIKEY", "")).strip()
        if not precinct_value and not unit_value:
            other_values = [str(value).strip() for field, value in row.items() if field not in ("PREKEY", "UNIKEY") and str(value).strip()]
            if other_values:
                if len(other_values) != 1 or not other_values[0].startswith("Fichero publicado originalmente en Elecciones en P"):
                    raise ValueError(f"Data without PREKEY/UNIKEY in {path} at row {row_number}")
                footer_rows += 1
                continue
            blank_rows += 1
            continue
        if not precinct_value or not unit_value:
            raise ValueError(f"Partial key in {path} at row {row_number}")
        key = (integer(precinct_value, "PREKEY"), integer(unit_value, "UNIKEY"))
        if key[0] <= 0 or key[1] <= 0:
            raise ValueError(f"Non-geographic key in {path} at row {row_number}: {key}")
        if any(str(value).strip() for field, value in row.items() if not field):
            raise ValueError(f"Unnamed populated column in {path} at row {row_number}")

        records += 1
        source_keys.add(key)
        units[key][row_column] = units[key].get(row_column, 0) + 1
        for field in status:
            status_values[field][str(row.get(field, "")).strip()] += 1
        for field, destination in measures_by_name.items():
            value = str(row.get(field, "")).strip()
            if not value:
                continue
            count = integer(value, f"{field} in {path} row {row_number}")
            if count < 0:
                raise ValueError(f"Negative source count in {path} row {row_number}: {field}")
            populated[field] += 1
            totals[field] += count
            units[key][destination] = units[key].get(destination, 0) + count

    return {
        "source": path.relative_to(ROOT).as_posix(),
        "sheet": sheet,
        "sha256": source_hash(path),
        "rows": records,
        "blank_padded_rows": blank_rows,
        "publication_footer_rows": footer_rows,
        "unit_keys": len(source_keys),
        "precincts": len({key[0] for key in source_keys}),
        "non_additive_status_values": {field: dict(counts) for field, counts in status_values.items()},
        "columns": {
            field: {"source_total": totals[field], "populated_rows": populated[field], "blank_rows": records - populated[field]}
            for field in measures
        },
    }


def write_table(path: Path, year: int, keys: list[tuple[int, ...]], data: dict, columns: list[str]) -> None:
    key_fields = ["PREKEY", "UNIKEY"] if len(keys[0]) == 2 else ["PREKEY"]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["YEAR", *key_fields, *columns])
        writer.writeheader()
        for key in keys:
            writer.writerow({"YEAR": year, **dict(zip(key_fields, key)), **data[key]})


def build_year(year: int) -> None:
    directory = source_directory(year)
    if not directory.is_dir():
        raise FileNotFoundError(directory)
    units: dict[tuple[int, int], dict[str, int]] = defaultdict(dict)
    columns: list[str] = []
    sources: dict[str, dict] = {}

    if year <= 2016:
        files = list(directory.glob("*.xls"))
        if len(files) != 1:
            raise ValueError(f"Expected one original XLS in {directory}, found {len(files)}")
        workbook = xlrd.open_workbook(str(files[0]), on_demand=True)
        expected_sheets = 2 if year == 2012 else 1
        if workbook.nsheets != expected_sheets:
            raise ValueError(f"Expected {expected_sheets} sheets in {files[0]}")
        for index, sheet in enumerate(workbook.sheets()):
            label = "REFERENDUM" if year == 2012 and index == 1 else "GENERAL"
            fields = [str(field).strip() for field in sheet.row_values(0)]
            rows = (dict(zip(fields, sheet.row_values(number))) for number in range(1, sheet.nrows))
            sources[label] = add_source(label, files[0], sheet.name, fields, rows, units, columns)
    else:
        files = list(directory.glob("*.csv"))
        if len(files) != len(CONTESTS):
            raise ValueError(f"Expected four original CSVs in {directory}, found {len(files)}")
        for contest in CONTESTS:
            matches = [path for path in files if path.stem.lower().split()[0] == contest]
            if len(matches) != 1:
                raise ValueError(f"Expected one {contest} CSV in {directory}, found {len(matches)}")
            path = matches[0]
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                if reader.fieldnames is None:
                    raise ValueError(f"No header in {path}")
                label = contest.upper()
                sources[label] = add_source(label, path, None, reader.fieldnames, reader, units, columns)

    precincts: dict[tuple[int], dict[str, int]] = defaultdict(dict)
    for (precinct, _unit), values in units.items():
        for column, value in values.items():
            precinct_row = precincts[(precinct,)]
            precinct_row[column] = precinct_row.get(column, 0) + value

    for label, audit in sources.items():
        for field, details in audit["columns"].items():
            column = f"{label}__{field}"
            unit_total = sum(row.get(column, 0) for row in units.values())
            precinct_total = sum(row.get(column, 0) for row in precincts.values())
            if unit_total != details["source_total"] or precinct_total != details["source_total"]:
                raise ValueError(f"Vote conservation failed: {year} {column}")

    output = ROOT / "electoral_ready"
    output.mkdir(exist_ok=True)
    write_table(output / f"units_{year}.csv", year, sorted(units), units, columns)
    write_table(output / f"precincts_{year}.csv", year, sorted(precincts), precincts, columns)
    audit = {"year": year, "unit_keys": len(units), "precincts": len(precincts), "sources": sources}
    (output / f"audit_{year}.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print(f"{year}: {len(units)} units, {len(precincts)} precincts; source/unit/precinct counts reconcile")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("years", type=int, nargs="*", choices=YEARS)
    arguments = parser.parse_args()
    for election_year in arguments.years or YEARS:
        build_year(election_year)