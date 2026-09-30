const $ = (selector) => document.querySelector(selector);
const formatNumber = (value) => value == null ? 'No estimate' : new Intl.NumberFormat('en-US').format(value);
const palette = {
  PNP: '#2e6ba8', PPD: '#cb514d', PIP: '#3a8f3a', MVC: '#e4b943',
  PD: '#aa6d52', PPT: '#a96086', MUS: '#81a048', PPR: '#b27644',
  SI: '#197e6f', NO: '#ce6753', SLA: '#458da7', EST: '#ce6753',
  IND: '#dda43d', IND_1: '#ac7655', IND_2: '#588f83', OTR: '#797c77',
};
const excluded = new Set(['TOT', 'MVT', 'NVT', 'BLN', 'NUL', 'CND', 'OVR', 'BAL']);
const contestDefinitions = [
  { id: 'GOB', label: 'Governor', prefix: 'GOB_' },
  { id: 'COM', label: 'Resident commissioner', prefix: 'COM_' },
  { id: 'SNA', label: 'Senate at-large (SNA)', prefix: 'SNA_' },
  { id: 'SND', label: 'Senate district (SND)', prefix: 'SND_' },
  { id: 'RPA', label: 'House at-large (RPA)', prefix: 'RPA_' },
  { id: 'RPD', label: 'House district (RPD)', prefix: 'RPD_' },
  { id: 'ALC', label: 'Mayor', prefix: 'ALC_' },
  { id: 'PLE', label: 'Plebiscite', prefix: 'PLE_' },
  { id: 'FIANZA', label: 'Referendum · bond', prefix: 'FIANZA_' },
  { id: 'LEGISLATURA', label: 'Referendum · legislature', prefix: 'LEGISLATURA_' },
];
const censusLabels = {
  B01003_001E: 'Population',
  B19013_001E: 'Median household income',
  B19301_001E: 'Per capita income',
  B01002_001E: 'Median age',
  B19058_002E: 'SNAP households',
  B25077_001E: 'Median home value',
  HOMEOWNERSHIP_PCT: 'Homeownership rate',
  HH_INCOME_100K_PLUS_PCT: 'Households with income $100K+',
  B15003_001E: 'Adults age 25+',
  EDU_LT_HS_PCT: 'Less than high school',
  EDU_HS_GED_PCT: 'High school diploma or GED',
  EDU_SOME_COLLEGE_PCT: "Some college or associate's degree",
  EDU_BACHELORS_PCT: "Bachelor's degree",
  EDU_GRADUATE_PCT: 'Graduate or professional degree',
  EDU_BACHELORS_PLUS_PCT: "Bachelor's degree or higher",
};
const state = {
  year: '2024', race: 'GOB', mode: 'winner', candidate: null,
  censusVisible: false, selected: null, layer: null, censusLayer: null,
  elections: {}, census: {}, choices: [], map: null, request: 0,
};

function showStatus(message) {
  $('#loading').textContent = message;
  $('#loading').hidden = false;
}

async function loadData(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

function fieldPrefix(race) {
  if (['SNA', 'SND', 'RPA', 'RPD'].includes(race.id)) {
    const source = state.year === '2012' || state.year === '2016' ? 'GENERAL' : 'LEGISLATIVA';
    return `${source}__${race.prefix}`;
  }
  const source = state.year === '2012' || state.year === '2016' ? 'GENERAL' :
    race.id === 'ALC' ? 'MUNICIPAL' : race.id === 'PLE' ? 'PLEBISCITO' : 'ESTATAL';
  if (race.id === 'FIANZA' || race.id === 'LEGISLATURA') return `REFERENDUM__${race.prefix}`;
  return `${source}__${race.prefix}`;
}

function raceChoices(race) {
  const fields = Object.keys(state.elections[state.year]?.features[0]?.properties.votes || {});
  const prefix = fieldPrefix(race);
  const choices = new Map();
  for (const field of fields) {
    if (!field.startsWith(prefix)) continue;
    const suffix = field.slice(prefix.length);
    if (excluded.has(suffix) || suffix.startsWith('INT_') || suffix.startsWith('MIX_')) continue;
    const label = suffix.split('_')[0];
    if (excluded.has(label)) continue;
    if (!choices.has(label)) choices.set(label, { field: `${prefix}${label}`, label, fields: [] });
    choices.get(label).fields.push(field);
  }
  return [...choices.values()];
}

function choiceVotes(votes, choice) {
  if (!choice) return null;
  let total = 0;
  let found = false;
  for (const field of choice.fields) {
    const value = votes[field];
    if (value == null) continue;
    total += value;
    found = true;
  }
  return found ? total : null;
}

function winner(votes) {
  let best = null;
  let tied = false;
  for (const choice of state.choices) {
    const value = choiceVotes(votes, choice);
    if (value == null || value <= 0) continue;
    if (!best || value > best.value) { best = { label: choice.label, value }; tied = false; }
    else if (value === best.value) tied = true;
  }
  return tied ? { label: 'Tie', value: best.value } : best;
}

function fillColor(feature) {
  const votes = feature.properties.votes;
  if (state.mode === 'winner') {
    const result = winner(votes);
    if (!result) return '#d6ded6';
    if (result.label === 'Tie') return '#909a95';
    return palette[result.label] || '#8b7861';
  }
  const choice = state.choices.find((item) => item.field === state.candidate);
  const value = choiceVotes(votes, choice);
  if (value == null) return '#d6ded6';
  const fraction = Math.max(0, Math.min(value / (state.maxVotes || 1), 1));
  return `hsl(164 47% ${88 - 54 * fraction}%)`;
}

function precinctStyle(feature) {
  return { color: '#fbfdf9', weight: 1.1, fillColor: fillColor(feature), fillOpacity: 0.88 };
}

function censusStyle(feature) {
  const value = feature.properties[$('#census-variable').value];
  const fraction = value == null ? null : Math.max(0, Math.min(value / (state.maxCensus || 1), 1));
  return {
    color: '#3a6560', weight: 0.45,
    fillColor: fraction == null ? '#dddcd1' : `hsl(43 77% ${86 - 46 * fraction}%)`,
    fillOpacity: Number($('#opacity').value) / 100,
  };
}

function detailRow(list, name, value) {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = name;
  description.textContent = value;
  row.append(term, description);
  list.append(row);
}

function formatCensusValue(value, field) {
  if (value == null) return 'No estimate';
  const formatted = formatNumber(value);
  if (['B19013_001E', 'B19301_001E', 'B25077_001E'].includes(field)) return `$${formatted}`;
  return field.endsWith('_PCT') ? `${formatted}%` : formatted;
}

function renderCensusDistribution(legend) {
  const field = $('#census-variable').value;
  const features = state.census[state.year].features;
  const values = features.map((feature) => feature.properties[field]).filter(Number.isFinite);
  legend.setAttribute('aria-label', `${censusLabels[field]} distribution`);

  const heading = document.createElement('div');
  heading.className = 'legend-title';
  heading.textContent = `${censusLabels[field]} distribution`;
  legend.append(heading);

  const summary = document.createElement('div');
  summary.className = 'distribution-summary';
  summary.textContent = `${formatNumber(values.length)} of ${formatNumber(features.length)} block groups`;
  legend.append(summary);

  const selectedProperties = state.selected?.kind === 'block' ? state.selected.properties : null;
  const selectedValue = selectedProperties?.[field];
  const selectedBin = Number.isFinite(selectedValue) && values.length
    ? Math.min(7, Math.floor(((selectedValue - Math.min(...values)) / (Math.max(...values) - Math.min(...values) || 1)) * 8))
    : null;
  if (selectedProperties) {
    const selection = document.createElement('div');
    selection.className = 'distribution-selection';
    const area = document.createElement('span');
    area.textContent = `Selected block group ${selectedProperties.geoid}`;
    const value = document.createElement('strong');
    value.textContent = Number.isFinite(selectedValue) ? formatCensusValue(selectedValue, field) : 'No estimate';
    selection.append(area, value);
    if (Number.isFinite(selectedValue) && values.length) {
      const comparison = document.createElement('span');
      const percentile = Math.round(values.filter((item) => item <= selectedValue).length / values.length * 100);
      comparison.textContent = `At or below ${percentile}% of block groups`;
      selection.append(comparison);
    }
    legend.append(selection);
  }

  if (!values.length) return;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const binCount = 8;
  const bins = Array(binCount).fill(0);
  const span = maximum - minimum;
  for (const value of values) {
    const index = span === 0 ? 0 : Math.min(binCount - 1, Math.floor(((value - minimum) / span) * binCount));
    bins[index] += 1;
  }
  const maxBin = Math.max(...bins);
  const binList = document.createElement('div');
  binList.className = 'distribution-bins';

  bins.forEach((count, index) => {
    const lower = minimum + (span * index) / binCount;
    const upper = index === binCount - 1 ? maximum : minimum + (span * (index + 1)) / binCount;
    const row = document.createElement('div');
    row.className = 'distribution-bin';
    if (index === selectedBin) row.classList.add('is-selected');
    const range = document.createElement('span');
    range.className = 'distribution-range';
    range.textContent = `${formatCensusValue(lower, field)}–${formatCensusValue(upper, field)}`;
    const track = document.createElement('span');
    track.className = 'distribution-track';
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('span');
    bar.className = 'distribution-bar';
    bar.style.width = `${(count / maxBin) * 100}%`;
    track.append(bar);
    const quantity = document.createElement('b');
    quantity.className = 'distribution-count';
    quantity.textContent = formatNumber(count);
    row.append(range, track, quantity);
    binList.append(row);
  });
  legend.append(binList);
}

function renderSelection() {
  const target = $('#selection-content');
  target.replaceChildren();
  if (!state.selected) {
    $('#selection-heading').textContent = 'Islandwide totals';
    const list = document.createElement('dl');
    for (const choice of state.choices) {
      let total = 0;
      for (const feature of state.elections[state.year].features) {
        total += choiceVotes(feature.properties.votes, choice) || 0;
      }
      detailRow(list, choice.label, formatNumber(total));
    }
    target.append(list);
    return;
  }
  $('#selection-heading').textContent = 'Selected area';
  const { kind, properties } = state.selected;
  const title = document.createElement('h3');
  const list = document.createElement('dl');
  if (kind === 'precinct') {
    title.textContent = `Precinto ${properties.prekey}`;
    detailRow(list, 'Municipio', properties.municipio || 'Not specified');
    for (const choice of state.choices) {
      const value = choiceVotes(properties.votes, choice);
      detailRow(list, choice.label, value == null ? 'No return' : formatNumber(value));
    }
  } else {
    title.textContent = `Block group ${properties.geoid}`;
    detailRow(list, 'ACS 5-year', state.year);
    for (const [field, label] of Object.entries(censusLabels)) {
      const value = properties[field];
      detailRow(list, label, formatCensusValue(value, field));
    }
  }
  target.append(title, list);
}

function renderLegend() {
  const legend = $('#legend');
  legend.replaceChildren();
  if (state.censusVisible && state.census[state.year]) {
    renderCensusDistribution(legend);
    return;
  }
  legend.setAttribute('aria-label', 'Election legend');
  const heading = document.createElement('div');
  heading.className = 'legend-title';
  heading.textContent = state.mode === 'winner' ? 'Precintos by leading choice' : 'Votes by precinto';
  legend.append(heading);
  if (state.mode === 'votes') {
    const line = document.createElement('div');
    line.className = 'legend-row';
    line.textContent = `0 → ${formatNumber(state.maxVotes)}`;
    legend.append(line);
    return;
  }
  const counts = new Map();
  for (const feature of state.elections[state.year].features) {
    const label = winner(feature.properties.votes)?.label || 'No return';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  for (const [label, count] of [...counts].sort((first, second) => second[1] - first[1])) {
    const row = document.createElement('div');
    row.className = 'legend-row';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = label === 'Tie' ? '#909a95' : palette[label] || '#d6ded6';
    const text = document.createElement('span');
    text.textContent = label;
    const quantity = document.createElement('b');
    quantity.textContent = count;
    row.append(swatch, text, quantity);
    legend.append(row);
  }
}

function renderRaceControls() {
  const available = contestDefinitions.filter((race) => raceChoices(race).length > 1);
  if (!available.some((race) => race.id === state.race)) state.race = available[0].id;
  const select = $('#race');
  select.replaceChildren();
  for (const race of available) select.add(new Option(race.label, race.id));
  select.value = state.race;
  state.choices = raceChoices(available.find((race) => race.id === state.race));
  const candidate = $('#candidate');
  candidate.replaceChildren();
  for (const choice of state.choices) candidate.add(new Option(choice.label, choice.field));
  if (!state.choices.some((choice) => choice.field === state.candidate)) state.candidate = state.choices[0]?.field;
  candidate.value = state.candidate;
  candidate.hidden = $('#candidate-label').hidden = state.mode !== 'votes';
  const selectedChoice = state.choices.find((choice) => choice.field === state.candidate);
  state.maxVotes = Math.max(1, ...state.elections[state.year].features.map((feature) => choiceVotes(feature.properties.votes, selectedChoice) || 0));
  const title = available.find((race) => race.id === state.race)?.label || 'Election';
  $('#map-heading-title').textContent = `${title} · ${state.mode === 'winner' ? 'winner' : 'votes'}`;
  $('#map-year').textContent = state.year;
  $('#map-scale').textContent = state.censusVisible ? `ACS ${state.year} · source block groups` : `CEE ${state.year} · observed precinto returns`;
  if (state.layer) state.layer.setStyle(precinctStyle);
  renderLegend();
  renderSelection();
}

function showCensus() {
  if (state.censusLayer) { state.map.removeLayer(state.censusLayer); state.censusLayer = null; }
  state.censusVisible = $('#census-toggle').checked && state.year !== '2012';
  $('#census-options').classList.toggle('open', state.censusVisible);
  $('.map-panel').classList.toggle('has-census', state.censusVisible);
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === (state.censusVisible ? 'unapportioned' : 'electoral')));
  if (!state.censusVisible || !state.census[state.year]) { renderRaceControls(); return; }
  const data = state.census[state.year];
  const field = $('#census-variable').value;
  state.maxCensus = Math.max(1, ...data.features.map((feature) => feature.properties[field] || 0));
  state.censusLayer = L.geoJSON(data, {
    style: censusStyle,
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(`Block group ${feature.properties.geoid}`);
        layer.on('click', () => {
          state.selected = { kind: 'block', properties: feature.properties };
          renderSelection();
          renderLegend();
        });
    },
  }).addTo(state.map);
  renderRaceControls();
}

async function changeYear(year) {
  const request = ++state.request;
  showStatus('Loading map data…');
  try {
    if (!state.elections[year]) state.elections[year] = await loadData(`data/precincts_${year}.geojson`);
    if (year !== '2012' && !state.census[year]) state.census[year] = await loadData(`data/block_groups_${year}.geojson`);
    if (request !== state.request) return;
    if (state.layer) state.map.removeLayer(state.layer);
    if (state.censusLayer) state.map.removeLayer(state.censusLayer);
    state.layer = state.censusLayer = state.selected = null;
    state.year = year;
    state.race = 'GOB';
    state.candidate = null;
    state.layer = L.geoJSON(state.elections[year], {
      style: precinctStyle,
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(`${feature.properties.municipio} · Precinto ${feature.properties.prekey}`);
        layer.on('click', () => { state.selected = { kind: 'precinct', properties: feature.properties }; renderSelection(); });
      },
    }).addTo(state.map);
    $('#census-toggle').disabled = year === '2012';
    if (year === '2012') $('#census-toggle').checked = false;
    $('[data-tab="unapportioned"]').disabled = year === '2012';
    $('#census-availability').textContent = year === '2012' ? 'No same-year ACS block-group layer in this collection.' : `ACS ${year} 5-year estimates · original block groups`;
    document.querySelectorAll('[data-year]').forEach((button) => button.classList.toggle('is-active', button.dataset.year === year));
    state.map.fitBounds(state.layer.getBounds(), { padding: [18, 18] });
    showCensus();
    $('#loading').hidden = true;
  } catch (error) {
    if (request === state.request) showStatus(error.message);
  }
}

if (typeof L === 'undefined') {
  showStatus('Map library unavailable. Check network access.');
} else {
  state.map = L.map('map', { zoomControl: false, preferCanvas: true, scrollWheelZoom: true }).setView([18.22, -66.45], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 18 }).addTo(state.map);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  document.querySelectorAll('[data-year]').forEach((button) => button.addEventListener('click', () => changeYear(button.dataset.year)));
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((item) => {
      item.classList.toggle('is-active', item === button);
      item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
    });
    renderRaceControls();
  }));
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    $('#census-toggle').checked = button.dataset.tab === 'unapportioned';
    showCensus();
  }));
  $('#race').addEventListener('change', (event) => { state.race = event.target.value; state.candidate = null; renderRaceControls(); });
  $('#candidate').addEventListener('change', (event) => { state.candidate = event.target.value; renderRaceControls(); });
  $('#census-toggle').addEventListener('change', showCensus);
  $('#census-variable').addEventListener('change', showCensus);
  $('#opacity').addEventListener('input', (event) => {
    $('#opacity-value').value = `${event.target.value}%`;
    if (state.censusLayer) state.censusLayer.setStyle(censusStyle);
  });
  $('#reset-view').addEventListener('click', () => { if (state.layer) state.map.fitBounds(state.layer.getBounds(), { padding: [18, 18] }); });
  changeYear('2024');
}