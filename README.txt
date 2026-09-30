PREKEY REBUILD INPUTS (copies; original project files remain in place)
=====================================================================

Scope: 2016, 2020, and 2024 precinct-level (PREKEY) census apportionment,
with separate original CEE election returns for a later results join.
No apportionment has been run in this folder.

Collected here:
- raw_downloads/acs5/<year>/<table>.json: original Census API responses
  for Puerto Rico block groups, 2016/2020/2024 ACS 5-year table groups.
  Includes estimates, margins of error, and annotations as published;
  no sentinel conversion, joins, or field reductions have been applied.
- raw_downloads/decennial_2020/P1_001N_blocks.json: original Census API
  response for 2020 Puerto Rico decennial block population counts.
- raw_downloads/tiger2020/tl_2020_72_tabblock20.zip: original Census
  TIGER/Line 2020 Puerto Rico block geometry download.
- tiger_block_groups/tl_<year>_72_bg/: matching Census TIGER block-group
  shapefile sets for 2016, 2020, and 2024.
- cee_precinct_boundaries/: direct CEE precinct polygons. Use
  Pre_CEE_2011 (Precinto2 field) for 2016 and 2020, and Pre_CEE_2025
  (Precinto field) for 2024, matching the project's year-specific
  electoral map builders. The 2011 precinct set also covers 2012.
- cee_unit_boundaries/: 2016 and 2020 CEE unit shapefiles plus the
  Uni_CEE_2025 revision used for the 2024 election. Retained as source
  geography/reference, not needed to derive PREKEY polygons.
- cee_election_returns/: source CEE election files at unit level for
  2016, 2020, and 2024. Join/aggregate votes to PREKEY only after
  checking the PREKEY identifiers and vote scope; do not spatially
  allocate municipal-only results as if they were precinct returns.
- historical_partial/: original 2008 and 2012 election files, plus the
  available 2012 CEE unit boundary shapefile. These are not ready for
  a same-vintage census-to-PREKEY reconstruction.

ELECTORAL TABLES (no Census apportionment)
===========================================
The election-only outputs in electoral_ready/ are derived directly from
the original CEE files above, NOT from the Drive FULL exports:

- precincts_<year>.csv: one row per PREKEY, for 2008/2012/2016/2020/2024.
- units_<year>.csv: one row per PREKEY + UNIKEY; all COLKEY rows are summed
  within their original election source before the precinct roll-up.
- audit_<year>.json: SHA-256 of every input, source row counts, status
  values, numeric field totals, and counts of blank source cells.

Regenerate in a standalone copy of this folder with Python 3:
    python -m pip install -r requirements.txt
    python build_electoral_tables.py

Each numeric source field, including ballot choices, blank/null votes,
totals, registration, and turnout, is kept as SOURCE__ORIGINAL_FIELD.
Examples: GENERAL__GOB_PNP, REFERENDUM__FIANZA_SI,
ESTATAL__GOB_PNP, PLEBISCITO__PLE_SLA. SOURCE__SOURCE_ROWS records how
many original rows contributed to each unit or precinct. Missing source
fields or absent contest rows stay blank rather than being set to zero.
Partially blank fields are sums of observed source values only: consult
audit_<year>.json for the blank-cell counts before using them as totals.
Non-additive STATUS fields stay in the original files; their value counts
are recorded in the audits rather than summed. Do not sum a TOT field
with its constituent party columns or sum registration across contests.

In 2012 the general-election sheet has 1,847 unit keys and the separate
referendum sheet has 1,753. Their precinct values are separately summed
without inventing votes for missing referendum unit keys. All 2024
plebiscite options come from the original plebiscito.csv, not the blank
PLE columns in the Drive export. All numeric source totals are checked
against both derived levels before files are written.

PREKEY matches every supplied CEE precinct polygon for 2012/2016/2020
(Pre_CEE_2011, field Precinto2) and 2024 (Pre_CEE_2025, field Precinto).
No verified 2008 precinct polygons are in this folder; do not place
2008 returns on 2011 boundaries without validating that plan first.

STANDALONE MAP
==============
The site/ folder is a static Leaflet map with observed PREKEY election
results and a separate, unapportioned ACS block-group overlay. It needs
no API key to view. Years shown: 2012/2016/2020/2024; 2012 has no
same-year ACS overlay and 2008 lacks verified map geometry.

On Windows, double-click start_map.bat to run the included site. Or:
  python serve_map.py

After updating original data, rebuild the derived outputs and map data:
  python -m pip install -r requirements.txt
  python build_electoral_tables.py
  python build_map_data.py
  python serve_map.py

build_map_data.py verifies PREKEY-to-CEE polygon and ACS-GEOID-to-TIGER
matches, then writes site/data/ as WGS84 GeoJSON. It does not assign
ACS values to precincts or alter the original raw downloads. See
DEPLOYMENT.md for static hosting and source-data limitations.

Run download_raw_census.ps1 to retrieve or resume original responses
using CENSUS_API_KEY in the environment or an ignored CensusAPIKey.txt
beside the script. Never publish or deploy the key. Only Census table groups used in the project's
existing socioeconomic workflows are requested, not the entire ACS
catalog. Check provenance and election-plan validity of CEE boundaries.
Prepared archive parquets are intentionally excluded from this folder.

See APPORTIONMENT_METHODOLOGY_ARCHIVE/apportion_with_block_weights.py
for the existing population-weighted workflow. It currently dissolves
CEE unit polygons to obtain PREKEY geometry. For the proposed PREKEY
rebuild, use cee_precinct_boundaries/ directly instead; the existing
script has NOT yet been changed to do so. Check coverage, valid geometry,
and PREKEY identifiers before the intersection. Election returns are not
inputs to the census-only apportionment step.

For historical census work, the archive labels 2012 census values a proxy;
same-vintage 2012 and 2008 ACS source extracts and matching TIGER BG
boundaries were not found here. A matching 2008 CEE unit boundary is
also not listed in the project inventory. Do not infer a same-vintage
rebuild for either year from the historical_partial files alone.