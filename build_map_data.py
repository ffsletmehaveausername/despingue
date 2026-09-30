"""Export standalone browser layers; ACS estimates remain on block groups."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import shapefile
from pyproj import CRS, Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "site" / "data"
YEARS = (2012, 2016, 2020, 2024)
ACS_FIELDS = {
    "B01003": ("B01003_001E",),
    "B01002": ("B01002_001E",),
    "B19013": ("B19013_001E",),
    "B19301": ("B19301_001E",),
    "B19058": ("B19058_001E", "B19058_002E"),
    "B23025": ("B23025_003E", "B23025_005E"),
    "B19001": tuple(f"B19001_{index:03d}E" for index in range(1, 18)),
    "B25003": ("B25003_001E", "B25003_002E", "B25003_003E"),
    "B25077": ("B25077_001E",),
    "B15003": tuple(f"B15003_{index:03d}E" for index in range(1, 26)),
}
EDUCATION_FIELDS = {
    "EDU_LT_HS_PCT": tuple(f"B15003_{index:03d}E" for index in range(2, 17)),
    "EDU_HS_GED_PCT": ("B15003_017E", "B15003_018E"),
    "EDU_SOME_COLLEGE_PCT": ("B15003_019E", "B15003_020E", "B15003_021E"),
    "EDU_BACHELORS_PCT": ("B15003_022E",),
    "EDU_GRADUATE_PCT": ("B15003_023E", "B15003_024E", "B15003_025E"),
    "EDU_BACHELORS_PLUS_PCT": ("B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E"),
}
NULL_VALUES = {-666666666, -666666667, -555555555, -333333333, -222222222, -999999999, -888888888}


def geometry_features(path: Path, key_field: str, tolerance: float):
    source = CRS.from_wkt(path.with_suffix(".prj").read_text(encoding="utf-8"))
    project = Transformer.from_crs(source, CRS.from_epsg(32161), always_xy=True)
    web = Transformer.from_crs(CRS.from_epsg(32161), CRS.from_epsg(4326), always_xy=True)
    reader = shapefile.Reader(str(path))
    for record in reader.iterShapeRecords():
        properties = record.record.as_dict()
        key = str(properties[key_field]).strip()
        if key_field != "GEOID":
            key = str(int(key))
        projected = transform(project.transform, shape(record.shape.__geo_interface__))
        geometry = transform(web.transform, projected.simplify(tolerance, preserve_topology=True))
        if geometry.is_empty:
            raise ValueError(f"Empty map geometry for {key} in {path}")
        yield key, properties, mapping(geometry)


def write_layer(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump({"type": "FeatureCollection", "features": features}, handle, ensure_ascii=False, separators=(",", ":"))


def precinct_path(year: int) -> tuple[Path, str]:
    if year == 2024:
        return ROOT / "cee_precinct_boundaries" / "Pre_CEE_2025" / "Pre_CEE_2025.shp", "Precinto"
    return ROOT / "cee_precinct_boundaries" / "Precintos_2011" / "Pre_CEE_2011.shp", "Precinto2"


def build_precincts(year: int) -> None:
    path, key_field = precinct_path(year)
    with (ROOT / "electoral_ready" / f"precincts_{year}.csv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    votes = {row["PREKEY"]: {field: int(value) if value else None for field, value in row.items() if field not in ("YEAR", "PREKEY")} for row in rows}
    if len(votes) != len(rows):
        raise ValueError(f"Duplicate PREKEY in precinct table for {year}")
    features = []
    seen = set()
    for key, attributes, geometry in geometry_features(path, key_field, 25):
        if key in seen:
            raise ValueError(f"Duplicate precinct geometry: {key}")
        seen.add(key)
        if key not in votes:
            raise ValueError(f"No election data for precinct {year}/{key}")
        municipio = attributes.get("Municipio") or attributes.get("MUNICIPIO") or ""
        features.append({"type": "Feature", "properties": {"prekey": key, "municipio": str(municipio).strip(), "votes": votes[key]}, "geometry": geometry})
    if seen != votes.keys():
        raise ValueError(f"Election precincts without geometry in {year}: {sorted(votes.keys() - seen)}")
    write_layer(OUTPUT / f"precincts_{year}.geojson", features)
    print(f"{year}: {len(features)} precinct polygons joined to observed election returns")


def estimate(value: str) -> int | float | None:
    if not value or value in ("null", "None"):
        return None
    result = float(value)
    if result in NULL_VALUES:
        return None
    return int(result) if result.is_integer() else result


def percentage(values: dict[str, int | float | None], denominator_field: str, fields: tuple[str, ...]) -> float | None:
    denominator = values.get(denominator_field)
    estimates = [values.get(field) for field in fields]
    if denominator is None or denominator <= 0 or any(value is None for value in estimates):
        return None
    return round(sum(value for value in estimates if value is not None) / denominator * 100, 1)


def build_block_groups(year: int) -> None:
    values: dict[str, dict[str, int | float | None]] = {}
    expected_keys: set[str] | None = None
    for table, fields in ACS_FIELDS.items():
        path = ROOT / "raw_downloads" / "acs5" / str(year) / f"{table}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        header = data[0]
        offsets = {field: header.index(field) for field in fields}
        geography = [header.index(field) for field in ("state", "county", "tract", "block group")]
        table_keys = set()
        for row in data[1:]:
            key = "".join(row[index] for index in geography)
            if key in table_keys:
                raise ValueError(f"Duplicate ACS block group {year}/{table}/{key}")
            table_keys.add(key)
            values.setdefault(key, {}).update({field: estimate(row[index]) for field, index in offsets.items()})
        if expected_keys is not None and table_keys != expected_keys:
            raise ValueError(f"ACS {year}/{table} block-group keys differ from other tables")
        expected_keys = table_keys

    for block_values in values.values():
        for field, components in EDUCATION_FIELDS.items():
            block_values[field] = percentage(block_values, "B15003_001E", components)
        block_values["HOMEOWNERSHIP_PCT"] = percentage(block_values, "B25003_001E", ("B25003_002E",))
        block_values["HH_INCOME_100K_PLUS_PCT"] = percentage(
            block_values,
            "B19001_001E",
            tuple(f"B19001_{index:03d}E" for index in range(14, 18)),
        )
        for index in range(2, 26):
            block_values.pop(f"B15003_{index:03d}E")
        for index in range(1, 18):
            block_values.pop(f"B19001_{index:03d}E")
        for field in ("B25003_001E", "B25003_002E", "B25003_003E"):
            block_values.pop(field)

    path = ROOT / "tiger_block_groups" / f"tl_{year}_72_bg" / f"tl_{year}_72_bg.shp"
    features = []
    seen = set()
    for key, attributes, geometry in geometry_features(path, "GEOID", 25):
        if key in seen or key not in values:
            raise ValueError(f"Missing or duplicate ACS values for geometry {year}/{key}")
        seen.add(key)
        features.append({"type": "Feature", "properties": {"geoid": key, "name": attributes.get("NAMELSAD", ""), **values[key]}, "geometry": geometry})
    if seen != values.keys():
        raise ValueError(f"ACS {year} values without geometry: {len(values.keys() - seen)}")
    write_layer(OUTPUT / f"block_groups_{year}.geojson", features)
    print(f"{year}: {len(features)} Census block groups with original ACS estimates")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("years", type=int, nargs="*", choices=YEARS)
    arguments = parser.parse_args()
    for election_year in arguments.years or YEARS:
        build_precincts(election_year)
        if election_year != 2012:
            build_block_groups(election_year)