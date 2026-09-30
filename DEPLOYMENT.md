# Standalone PREKEY electoral atlas

The folder can be moved out of the parent project. The election and Census
sources, builders, browser site, and local server are relative to this folder.
No parent workspace paths are required. Keep the original CEE files and raw
Census responses for reproducibility; never publish an API key.

## Local rebuild

Install Python 3 and run in this folder:

```text
python -m pip install -r requirements.txt
python build_electoral_tables.py
python build_map_data.py
python serve_map.py
```

On Windows, `start_map.bat` opens the already-built map without installing
dependencies. The server chooses a free loopback port; closing its terminal
stops it. Opening `site/index.html` directly from disk will not load GeoJSON
because browsers restrict local `fetch` requests.

## Static hosting

Deploy **only the contents of `site/`** to a static host. For example,
choose `site` as the publish directory in Netlify, Cloudflare Pages, or a
similar service. For GitHub Pages, the workflow in
`.github/workflows/deploy-pages.yml` publishes `site/` on every push to
`main`. In the repository, open **Settings > Pages > Build and deployment**,
set **Source** to **GitHub Actions**, and check the **Actions** tab for the
first deployment. The site URL is
`https://ffsletmehaveausername.github.io/despingue/`. No server-side Python,
Census key, raw election workbook, or source ZIP is needed on the host.
Keep all `site/data/*.geojson` alongside `index.html`, `app.js`, and
`styles.css`; the app uses relative paths and works under a subpath.
The Leaflet library and OpenStreetMap base tiles require network access.
For sustained public traffic, use an appropriately licensed tile provider
and retain map attribution; do not rely on unrestricted OSM tile use.

## What the map represents

- The election polygons are actual CEE precinct boundaries for the selected
  election plan, joined by PREKEY to aggregated **observed** returns.
- The Census overlay remains on original TIGER block groups, with ACS
  estimates joined by block-group GEOID. It does **not** represent precinct
  estimates or infer how residents voted.
- The `2008` election is available in `electoral_ready/` for analysis, but
  no verified 2008 precinct polygon is supplied for mapping. `2012` votes
  are mapped, but no same-vintage ACS block-group layer is provided.
- ACS 5-year estimates contain sampling uncertainty; simplified display
  geometry is for rendering, not spatial analysis. Use source shapes and
  raw API JSON for any future apportionment or precise area measurement.
- Missing fields are not zero-filled. Precinct totals sum available original
  numeric values by source; check the year-specific audit JSON for blank
  source cells and the 2012 referendum coverage difference.

Before publishing an updated map, rerun both builders, inspect the audit
files and map joins, and test all year/contest/overlay controls locally.