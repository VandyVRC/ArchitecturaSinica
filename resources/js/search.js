/*
 * search.js  --  Architectura Sinica site-wide search (static, client-side).
 *
 * Two search boxes on search.html:
 *   #qs  (Keyword)    -> full-text search across ALL datasets:
 *                        places, bibliography and terminology.
 *   #placeName        -> matches ONLY site/building titles in the places data.
 *
 * Places results render with a map, facets (Dynasty / Province /
 * Architectural Feature) and a timeline, mirroring the research tool.
 * Bibliography and terminology matches render as result lists.
 *
 * Data is static JSON served from /json; this is an S3/CloudFront site.
 */

const PLACES_URL = '/json/places-combined.json';
const BIBLIOGRAPHY_URL = '/json/bibliography-combined.json';
const TERMINOLOGY_URL = '/json/terminology-combined.json';

let placesData = [];
let biblData = [];
let termData = [];

let siteTree = [];          // [{ site, children: [place,...] }]
const placeById = new Map();

// Facet selections.
const activeFacets = {
  dynasty: new Set(),
  province: new Set(),
  buildingType: new Set(),
  architecturalFeature: new Set()
};

// Timeline state.
const timeline = { dataMin: null, dataMax: null, selMin: null, selMax: null };

// English feature/dynasty/building-type label -> { pinyin, chinese }.
const featureLabels = new Map();
const dynastyLabels = new Map();
const buildingTypeLabels = new Map();

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

const CJK_CHAR_RE = /[\u4e00-\u9fff]/;

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function uriId(uri) {
  return String(uri || '').replace(/\/+$/, '').split('/').pop();
}

function isSite(record) {
  return String(record && record.type).toLowerCase() === 'site';
}

function firstCjk(values) {
  for (const v of values || []) {
    if (v && CJK_CHAR_RE.test(v)) return String(v).trim();
  }
  return '';
}

/** Collect every searchable string from a record (for full-text search). */
function allText(record) {
  const out = [];
  const walk = v => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string' || typeof v === 'number') { out.push(String(v)); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(record);
  return out.join(' \u0001 ');
}

function textIncludes(record, query) {
  if (!query) return true;
  return allText(record).toLowerCase().includes(query.toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* Place labels                                                               */
/* -------------------------------------------------------------------------- */

function englishLabel(record) {
  if (!record) return 'Untitled';
  if (record.displayTitleEnglish) return record.displayTitleEnglish;
  if (Array.isArray(record.placeName) && record.placeName.length) return record.placeName[0];
  if (Array.isArray(record.title) && record.title.length) return record.title[0];
  return record.id || 'Untitled';
}

function secondaryLabel(record) {
  const names = Array.isArray(record && record.placeName) ? record.placeName : [];
  return names.slice(1).filter(Boolean).slice(0, 3).join(' \u00b7 ');
}

function locationLabel(record) {
  if (Array.isArray(record.province) && record.province.length) return record.province[0];
  if (Array.isArray(record.nestedLocation) && record.nestedLocation.length) return record.nestedLocation[0];
  return '';
}

function typeLabel(record) {
  if (isSite(record)) return 'site';
  const traits = Array.isArray(record.traitType) ? record.traitType.filter(Boolean) : [];
  if (traits.length) return traits[0];
  const t = String(record.type || '').toLowerCase();
  if (t === 'schema:landmarksorhistoricalbuildings') return 'building';
  return t || 'related place';
}

/** Names only, for the Place Name search box. */
function placeNameText(record) {
  const names = [];
  if (record.displayTitleEnglish) names.push(record.displayTitleEnglish);
  if (Array.isArray(record.placeName)) names.push(...record.placeName);
  if (Array.isArray(record.title)) names.push(...record.title);
  if (Array.isArray(record.alternateNames)) names.push(...record.alternateNames);
  return names.join(' \u0001 ');
}

function placeNameMatches(record, query) {
  if (!query) return true;
  return placeNameText(record).toLowerCase().includes(query.toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* Pinyin / Chinese lookups (from terminology data)                           */
/* -------------------------------------------------------------------------- */

const DYNASTY_LABEL_FALLBACK = {
  'nan song': { pinyin: 'Nán Sòng', chinese: '南宋' },
  'bei wei': { pinyin: 'Běi Wèi', chinese: '北魏' },
  'wei': { pinyin: 'Wèi', chinese: '魏' }
};

function buildPinyinLookups(terminology) {
  if (!Array.isArray(terminology)) return;
  terminology.forEach(t => {
    const py = t && t.pinyin;
    if (!py) return;
    const pinyin = String(py).trim();
    const chinese = (t.chineseTraditional && String(t.chineseTraditional).trim()) || firstCjk(t.keyword);
    const entry = { pinyin, chinese };
    const type = String(t.type || '').toLowerCase();
    if (t.displayTitleEnglish) {
      const en = String(t.displayTitleEnglish).trim();
      featureLabels.set(en, entry);
      if (type === 'time period') dynastyLabels.set(en.toLowerCase(), entry);
      if (type === 'building type') buildingTypeLabels.set(en, entry);
    }
    if (type === 'time period' && Array.isArray(t.keyword)) {
      t.keyword.forEach(k => {
        if (k && /^[\x00-\x7F]+$/.test(k)) {
          const key = String(k).trim().toLowerCase();
          if (!dynastyLabels.has(key)) dynastyLabels.set(key, entry);
        }
      });
    }
  });
}

function combineLabel(entry) {
  if (!entry) return null;
  return entry.chinese ? `${entry.pinyin} ${entry.chinese}` : entry.pinyin;
}

/**
 * Two-line facet label: pinyin (or the raw value) on top, with the Chinese
 * form as a muted subtitle underneath when available.
 */
function facetLabelHtml(prefix, entry, fallbackValue) {
  const pinyin = entry ? entry.pinyin : fallbackValue;
  const chinese = entry ? entry.chinese : '';
  let html = `<span>${prefix}${escapeHtml(pinyin)}`;
  if (chinese) {
    html += `<br><span style="opacity:0.6; font-size:0.85em;">${escapeHtml(chinese)}</span>`;
  }
  html += '</span>';
  return html;
}

function featureDisplayLabel(value) {
  return combineLabel(featureLabels.get(String(value).trim())) || value;
}

function dynastyDisplayLabel(value) {
  const key = String(value).trim().toLowerCase();
  return combineLabel(dynastyLabels.get(key)) || combineLabel(DYNASTY_LABEL_FALLBACK[key]) || value;
}

function buildingTypeDisplayLabel(value) {
  return combineLabel(buildingTypeLabels.get(String(value).trim())) || value;
}

/* -------------------------------------------------------------------------- */
/* Date range extraction                                                      */
/* -------------------------------------------------------------------------- */

function parseYear(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/^(-?\d{1,4})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (year === 0 || year === 1) return null; // placeholders
  return year;
}

function recordYearSpan(record) {
  let ranges = Array.isArray(record.dateRange) ? record.dateRange : [];
  if (ranges.length === 0 && Array.isArray(record.dynastyRange)) ranges = record.dynastyRange;
  let lo = null;
  let hi = null;
  ranges.forEach(r => {
    const f = parseYear(r.from);
    const t = parseYear(r.to);
    if (f === null && t === null) return;
    const start = f === null ? t : f;
    const end = t === null ? f : t;
    if (lo === null || start < lo) lo = start;
    if (hi === null || end > hi) hi = end;
  });
  return lo === null ? null : [lo, hi];
}

function groupYearSpan(group) {
  let lo = null;
  let hi = null;
  [group.site, ...group.children].forEach(p => {
    const span = recordYearSpan(p);
    if (!span) return;
    if (lo === null || span[0] < lo) lo = span[0];
    if (hi === null || span[1] > hi) hi = span[1];
  });
  return lo === null ? null : [lo, hi];
}

function groupInTimeline(group) {
  if (timeline.selMin === null || timeline.selMax === null) return true;
  const span = groupYearSpan(group);
  if (!span) return true;
  return span[0] <= timeline.selMax && span[1] >= timeline.selMin;
}

/* -------------------------------------------------------------------------- */
/* Facet value extraction                                                     */
/* -------------------------------------------------------------------------- */

function provinceValues(record) {
  const arr = Array.isArray(record.province) ? record.province : [];
  const english = arr.filter(v => v && !CJK_CHAR_RE.test(v));
  return [...new Set(english.map(v => v.trim().replace(/\s+Province$/i, '').trim()).filter(Boolean))];
}

const DYNASTY_BUCKETS = [
  { name: 'Han', match: ['Han'] },
  { name: 'Wei', match: ['Bei Wei', 'Northern Wei', 'Wei'] },
  { name: 'Bei Qi', match: ['Bei Qi', 'Northern Qi'] },
  { name: 'Sui', match: ['Sui'] },
  { name: 'Tang', match: ['Tang'] },
  { name: 'Five Dynasties', match: ['Five Dynasties'] },
  { name: 'Liao', match: ['Liao'] },
  { name: 'Northern Song', match: ['Northern Song', 'Bei Song'] },
  { name: 'Southern Song', match: ['Southern Song', 'Nan Song'] },
  { name: 'Song', match: ['Song'] },
  { name: 'Jin', match: ['Jin'] },
  { name: 'Yuan', match: ['Yuan'] },
  { name: 'Ming', match: ['Ming'] },
  { name: 'Qing', match: ['Qing'] }
];
const DYNASTY_ORDER = DYNASTY_BUCKETS.map(b => b.name);

function normalizeDynasty(raw) {
  if (!raw) return [];
  let s = String(raw).trim();
  if (/^k\d{3,}$/i.test(s)) return [];
  s = s.replace(/\d{2,4}\s*[-–]\s*\d{2,4}/g, ' ').replace(/\b\d{2,4}\b/g, ' ');
  const found = new Set();
  DYNASTY_BUCKETS.forEach(bucket => {
    if (bucket.match.some(p => new RegExp('\\b' + p.replace(/\s+/g, '\\s+') + '\\b', 'i').test(s))) {
      found.add(bucket.name);
    }
  });
  if (found.has('Northern Song') || found.has('Southern Song')) found.delete('Song');
  return [...found];
}

function dynastyValues(record) {
  const arr = Array.isArray(record.dynasty) ? record.dynasty : [];
  const out = [];
  arr.forEach(v => out.push(...normalizeDynasty(v)));
  return [...new Set(out)];
}

function architecturalFeatureValues(record) {
  const arr = Array.isArray(record.architecturalFeature) ? record.architecturalFeature : [];
  return [...new Set(arr.map(v => String(v || '').trim()).filter(Boolean))];
}

function buildingTypeValues(record) {
  const arr = Array.isArray(record.buildingType) ? record.buildingType : [];
  return [...new Set(arr.map(v => String(v || '').trim()).filter(Boolean))];
}

const FACET_EXTRACTORS = {
  dynasty: dynastyValues,
  province: provinceValues,
  buildingType: buildingTypeValues,
  architecturalFeature: architecturalFeatureValues
};

function groupFacetValues(group, facetKey) {
  const extractor = FACET_EXTRACTORS[facetKey];
  const values = new Set();
  extractor(group.site).forEach(v => values.add(v));
  group.children.forEach(child => extractor(child).forEach(v => values.add(v)));
  return values;
}

function groupMatchesFacets(group) {
  return Object.keys(activeFacets).every(key => {
    const selected = activeFacets[key];
    if (selected.size === 0) return true;
    const values = groupFacetValues(group, key);
    for (const v of selected) if (values.has(v)) return true;
    return false;
  });
}

const PLACE_LEVEL_FACETS = ['dynasty', 'buildingType', 'architecturalFeature'];

function placeMatchesPlaceFacets(place) {
  return PLACE_LEVEL_FACETS.every(key => {
    const selected = activeFacets[key];
    if (selected.size === 0) return true;
    const values = new Set(FACET_EXTRACTORS[key](place));
    for (const v of selected) if (values.has(v)) return true;
    return false;
  });
}

function anyPlaceFacetActive() {
  return PLACE_LEVEL_FACETS.some(key => activeFacets[key].size > 0);
}

/* -------------------------------------------------------------------------- */
/* Tree construction                                                          */
/* -------------------------------------------------------------------------- */

function containedParentId(record) {
  for (const rel of (Array.isArray(record.relations) ? record.relations : [])) {
    if (rel.ana === 'contained' || rel.ref === 'schema:containedInPlace') return uriId(rel.passive);
  }
  return null;
}

function buildTree(records) {
  records.forEach(r => placeById.set(r.id, r));
  const sites = records.filter(isSite);
  const related = records.filter(r => !isSite(r));

  function rootSiteId(record) {
    let current = record;
    const seen = new Set();
    while (current && !isSite(current)) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      const parentId = containedParentId(current);
      if (!parentId) return null;
      current = placeById.get(parentId);
      if (!current) return null;
    }
    return current ? current.id : null;
  }

  const childrenBySite = new Map();
  related.forEach(r => {
    const rootId = rootSiteId(r);
    if (rootId && placeById.get(rootId) && isSite(placeById.get(rootId))) {
      if (!childrenBySite.has(rootId)) childrenBySite.set(rootId, []);
      childrenBySite.get(rootId).push(r);
    }
  });

  const tree = sites.map(site => {
    const children = (childrenBySite.get(site.id) || []).slice();
    children.sort((a, b) => englishLabel(a).localeCompare(englishLabel(b), 'en', { sensitivity: 'base' }));
    return { site, children };
  });
  tree.sort((a, b) => englishLabel(a.site).localeCompare(englishLabel(b.site), 'en', { sensitivity: 'base' }));
  return tree;
}

/* -------------------------------------------------------------------------- */
/* Query state                                                                */
/* -------------------------------------------------------------------------- */

function getSearchValues() {
  const kwEl = document.getElementById('qs');
  const pnEl = document.getElementById('placeName');
  return {
    keyword: kwEl ? kwEl.value.trim() : '',
    placeName: pnEl ? pnEl.value.trim() : ''
  };
}

/**
 * Filter the place tree.
 *   - keyword: full-text on the place (any field)
 *   - placeName: only place titles
 *   - facets + timeline as before
 * Per-place facets narrow children; keyword/placeName also narrow children.
 */
function filterPlaceTree(keyword, placeName) {
  const results = [];
  const placeFacetActive = anyPlaceFacetActive();

  siteTree.forEach(group => {
    if (!groupMatchesFacets(group)) return;
    if (!groupInTimeline(group)) return;

    const siteFacetOk = !placeFacetActive || placeMatchesPlaceFacets(group.site);
    const facetChildren = placeFacetActive ? group.children.filter(placeMatchesPlaceFacets) : group.children;

    const matchPlace = p => textIncludes(p, keyword) && placeNameMatches(p, placeName);

    const siteHit = siteFacetOk && matchPlace(group.site);
    const matchedChildren = facetChildren.filter(matchPlace);

    if (siteHit) results.push({ site: group.site, children: matchedChildren });
    else if (matchedChildren.length) results.push({ site: group.site, children: matchedChildren });
  });
  return results;
}

/* -------------------------------------------------------------------------- */
/* Facet counts + rendering                                                   */
/* -------------------------------------------------------------------------- */

const FACET_DEFS = [
  { key: 'dynasty', label: 'Dynasty' },
  { key: 'province', label: 'Province' },
  { key: 'buildingType', label: 'Building Type' },
  { key: 'architecturalFeature', label: 'Architectural Feature' }
];

function groupPlaces(group) {
  return [group.site, ...group.children];
}

function computeFacetCounts(facetKey, keyword, placeName) {
  const counts = new Map();
  const extractor = FACET_EXTRACTORS[facetKey];
  siteTree.forEach(group => {
    const matchPlace = p => textIncludes(p, keyword) && placeNameMatches(p, placeName);
    const siteHit = matchPlace(group.site);
    const childHit = group.children.some(matchPlace);
    if (!siteHit && !childHit) return;
    if (!groupInTimeline(group)) return;

    const otherOk = Object.keys(activeFacets).every(key => {
      if (key === facetKey) return true;
      const selected = activeFacets[key];
      if (selected.size === 0) return true;
      const values = groupFacetValues(group, key);
      for (const v of selected) if (values.has(v)) return true;
      return false;
    });
    if (!otherOk) return;

    groupPlaces(group).forEach(place => {
      new Set(extractor(place)).forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    });
  });
  return counts;
}

function sortFacetEntries(facetKey, entries) {
  if (facetKey === 'dynasty') {
    const rank = v => { const i = DYNASTY_ORDER.indexOf(v); return i === -1 ? DYNASTY_ORDER.length : i; };
    return entries.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  }
  if (facetKey === 'architecturalFeature') {
    return entries.sort((a, b) =>
      featureDisplayLabel(a[0]).localeCompare(featureDisplayLabel(b[0]), 'en', { sensitivity: 'base' }));
  }
  // province & building type: by count desc, then alpha
  return entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));
}

function renderFacets(keyword, placeName) {
  const container = document.getElementById('place-facets');
  if (!container) return;

  let html = '';
  FACET_DEFS.forEach(def => {
    const counts = computeFacetCounts(def.key, keyword, placeName);
    const entries = sortFacetEntries(def.key, Array.from(counts.entries()));
    const selected = activeFacets[def.key];

    html += '<div class="facet-grp" style="margin-bottom:1.25em;">';
    html += `<div class="facet-title" style="color:#fff; font-weight:bold; border-bottom:1px solid rgba(255,255,255,0.4); padding-bottom:4px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
        <span>${escapeHtml(def.label)}</span>
        ${selected.size ? `<button type="button" class="btn btn-link facet-clear" data-facet="${def.key}" style="color:#ffd; padding:0; font-size:12px;">clear</button>` : ''}
      </div>`;

    if (entries.length === 0) {
      html += '<div style="color:rgba(255,255,255,0.6); font-size:13px;">No values</div>';
    } else {
      html += '<div class="facet-list" style="max-height:220px; overflow-y:auto;">';
      entries.forEach(([value, count]) => {
        const isOn = selected.has(value);
        const style = isOn
          ? 'color:#fff; background:#4a1414; font-weight:600;'
          : 'color:rgba(255,255,255,0.9); background:transparent;';
        const prefix = isOn ? '\u2713 ' : '';
        let labelHtml;
        if (def.key === 'architecturalFeature') {
          labelHtml = facetLabelHtml(prefix, featureLabels.get(String(value).trim()), value);
        } else if (def.key === 'dynasty') {
          const k = String(value).trim().toLowerCase();
          labelHtml = facetLabelHtml(prefix, dynastyLabels.get(k) || DYNASTY_LABEL_FALLBACK[k], value);
        } else if (def.key === 'buildingType') {
          labelHtml = facetLabelHtml(prefix, buildingTypeLabels.get(String(value).trim()), value);
        } else {
          labelHtml = `<span>${prefix}${escapeHtml(value)}</span>`;
        }
        html += `<button type="button" class="btn btn-link facet-link${isOn ? ' active' : ''}"
            data-facet="${def.key}" data-value="${escapeHtml(value)}"
            style="${style} text-align:left; width:100%; padding:7px 8px; margin-bottom:5px; text-decoration:none; border-radius:4px; display:flex; justify-content:space-between; gap:6px; align-items:flex-start;">
            ${labelHtml}<span style="opacity:0.75; white-space:nowrap;">${count}</span>
          </button>`;
      });
      html += '</div>';
    }
    html += '</div>';
  });

  container.innerHTML = html;
  container.querySelectorAll('.facet-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-facet');
      const value = btn.getAttribute('data-value');
      const set = activeFacets[key];
      if (set.has(value)) set.delete(value); else set.add(value);
      render();
    });
  });
  container.querySelectorAll('.facet-clear').forEach(btn => {
    btn.addEventListener('click', () => { activeFacets[btn.getAttribute('data-facet')].clear(); render(); });
  });
}

/* -------------------------------------------------------------------------- */
/* Map                                                                        */
/* -------------------------------------------------------------------------- */

let placeMap = null;
let markerLayer = null;

function groupLatLng(group) {
  const fromGps = record => {
    for (const g of (Array.isArray(record.gps) ? record.gps : [])) {
      const lat = Number(g && g.lat);
      const lon = Number(g && g.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    }
    return null;
  };
  return fromGps(group.site) || group.children.map(fromGps).find(Boolean) || null;
}

function initMap() {
  const el = document.getElementById('place-map');
  if (!el || typeof L === 'undefined') return;
  placeMap = L.map('place-map', { scrollWheelZoom: false }).setView([34.5, 108.5], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(placeMap);
  markerLayer = L.layerGroup().addTo(placeMap);
}

function updateMap(groups) {
  if (!placeMap || !markerLayer) return;
  markerLayer.clearLayers();
  const bounds = [];
  groups.forEach(group => {
    const latlng = groupLatLng(group);
    if (!latlng) return;
    const label = escapeHtml(englishLabel(group.site));
    const href = group.site.idno || '#';
    const count = group.children.length;
    markerLayer.addLayer(L.marker(latlng).bindPopup(
      `<a href="${href}" target="_blank" rel="noopener"><strong>${label}</strong></a>` +
      (count ? `<br><span style="color:#666;">${count} related place${count !== 1 ? 's' : ''}</span>` : '')
    ));
    bounds.push(latlng);
  });
  if (bounds.length) placeMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
}

/* -------------------------------------------------------------------------- */
/* Timeline range slider                                                      */
/* -------------------------------------------------------------------------- */

function computeTimelineBounds(places) {
  let lo = null;
  let hi = null;
  places.forEach(p => {
    const span = recordYearSpan(p);
    if (!span) return;
    if (lo === null || span[0] < lo) lo = span[0];
    if (hi === null || span[1] > hi) hi = span[1];
  });
  if (lo === null) return null;
  lo = Math.floor(lo / 100) * 100;
  hi = Math.ceil(hi / 100) * 100;
  if (hi <= lo) hi = lo + 100;
  return [lo, hi];
}

function yearToPercent(year) {
  const { dataMin, dataMax } = timeline;
  if (dataMax === dataMin) return 0;
  return ((year - dataMin) / (dataMax - dataMin)) * 100;
}
function percentToYear(pct) {
  const { dataMin, dataMax } = timeline;
  return Math.round(dataMin + (pct / 100) * (dataMax - dataMin));
}
function timelineIsFullRange() {
  return timeline.selMin === timeline.dataMin && timeline.selMax === timeline.dataMax;
}

function renderTimeline() {
  const container = document.getElementById('timeline-filter');
  if (!container) return;
  if (timeline.dataMin === null) { container.innerHTML = ''; return; }

  const minPct = yearToPercent(timeline.selMin);
  const maxPct = yearToPercent(timeline.selMax);
  let ticks = '';
  const tickCount = 5;
  for (let i = 0; i < tickCount; i += 1) {
    const pct = (i / (tickCount - 1)) * 100;
    ticks += `<span class="tl-tick" style="left:${pct}%;">${percentToYear(pct)}</span>`;
  }

  container.innerHTML = `
    <div class="tl-header">
      <span class="tl-label">Timeline</span>
      <span>
        <span class="tl-readout">${timeline.selMin}\u2013${timeline.selMax} CE</span>
        ${!timelineIsFullRange() ? '<button type="button" class="tl-reset">reset</button>' : ''}
      </span>
    </div>
    <div class="tl-track" id="tl-track">
      <div class="tl-range" style="left:${minPct}%; width:${maxPct - minPct}%;"></div>
      <div class="tl-handle" id="tl-handle-min" tabindex="0" role="slider" style="left:${minPct}%;"></div>
      <div class="tl-handle" id="tl-handle-max" tabindex="0" role="slider" style="left:${maxPct}%;"></div>
      ${ticks}
    </div>`;
  wireTimeline(container);
}

function wireTimeline(container) {
  const track = container.querySelector('#tl-track');
  const resetBtn = container.querySelector('.tl-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    timeline.selMin = timeline.dataMin;
    timeline.selMax = timeline.dataMax;
    render();
  });
  if (!track) return;

  const startDrag = which => downEvent => {
    downEvent.preventDefault();
    const rect = track.getBoundingClientRect();
    const move = moveEvent => {
      const clientX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
      let pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      const year = percentToYear(pct);
      if (which === 'min') timeline.selMin = Math.min(year, timeline.selMax);
      else timeline.selMax = Math.max(year, timeline.selMin);
      render();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
  };

  [['min', container.querySelector('#tl-handle-min')], ['max', container.querySelector('#tl-handle-max')]]
    .forEach(([which, handle]) => {
      if (!handle) return;
      handle.addEventListener('mousedown', startDrag(which));
      handle.addEventListener('touchstart', startDrag(which), { passive: false });
      handle.addEventListener('keydown', e => {
        const step = (e.key === 'ArrowLeft' || e.key === 'ArrowDown') ? -10
          : (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 10 : 0;
        if (!step) return;
        e.preventDefault();
        if (which === 'min') timeline.selMin = Math.max(timeline.dataMin, Math.min(timeline.selMin + step, timeline.selMax));
        else timeline.selMax = Math.min(timeline.dataMax, Math.max(timeline.selMax + step, timeline.selMin));
        render();
      });
    });
}

/* -------------------------------------------------------------------------- */
/* Result rendering                                                           */
/* -------------------------------------------------------------------------- */

function renderChild(place) {
  const label = escapeHtml(englishLabel(place));
  const secondary = escapeHtml(secondaryLabel(place));
  const type = escapeHtml(typeLabel(place));
  return `
    <li style="padding:0.35em 0; border-bottom:1px solid #f0f0f0;">
      <a href="${place.idno || '#'}" target="_blank" rel="noopener" style="font-weight:500;">${label}</a>
      ${secondary ? `<span style="color:#888; font-size:0.92em;"> ${secondary}</span>` : ''}
      <span class="badge" style="background:#9a9a9a; margin-left:0.5em;">${type}</span>
    </li>`;
}

function renderPlaceGroup(group, index) {
  const site = group.site;
  const label = escapeHtml(englishLabel(site));
  const secondary = escapeHtml(secondaryLabel(site));
  const loc = escapeHtml(locationLabel(site));
  const href = site.idno || '#';
  const childCount = group.children.length;
  const bodyId = `search-group-${index}`;

  const childrenHtml = childCount
    ? `<ul id="${bodyId}" style="list-style:none; margin:0.5em 0 0 0; padding:0 0 0 1.5em;">${group.children.map(renderChild).join('')}</ul>`
    : '';
  const toggle = childCount
    ? `<button type="button" class="btn btn-link rt-toggle" data-target="${bodyId}" style="padding:0 0.5em 0 0; text-decoration:none; font-size:1.1em; color:#702020;" aria-expanded="true">&#9660;</button>`
    : `<span style="display:inline-block; width:1.5em;"></span>`;

  return `
    <li style="padding:0.85em 0; border-bottom:2px solid #e5e5e5;">
      <div style="display:flex; align-items:baseline; gap:0.25em;">
        ${toggle}
        <div style="flex:1;">
          <a href="${href}" target="_blank" rel="noopener" style="font-size:1.15em; font-weight:600;">${label}</a>
          ${secondary ? `<span style="color:#777; font-size:0.95em;"> ${secondary}</span>` : ''}
          ${loc ? `<div style="color:#888; font-size:0.9em;">${loc}</div>` : ''}
        </div>
      </div>
      ${childrenHtml}
    </li>`;
}

function renderBibl(entry) {
  const title = (Array.isArray(entry.title) ? entry.title[0] : entry.title) || 'Untitled';
  const authors = Array.isArray(entry.author) ? entry.author.join('; ') : (entry.author || '');
  const date = Array.isArray(entry.date) ? entry.date[0] : (entry.date || '');
  return `
    <li style="padding:0.5em 0; border-bottom:1px solid #f0f0f0;">
      <a href="${entry.idno || '#'}" target="_blank" rel="noopener" style="font-weight:500;">${escapeHtml(title)}</a>
      ${authors ? `<div style="color:#666; font-size:0.92em;">${escapeHtml(authors)}${date ? ` (${escapeHtml(date)})` : ''}</div>` : ''}
    </li>`;
}

function renderTerm(entry) {
  const en = entry.displayTitleEnglish || (Array.isArray(entry.keyword) ? entry.keyword[0] : '') || entry.id;
  const py = entry.pinyin ? escapeHtml(entry.pinyin) : '';
  const zh = entry.chineseTraditional ? escapeHtml(entry.chineseTraditional) : firstCjk(entry.keyword);
  const label = [py, zh].filter(Boolean).join(' ') || escapeHtml(en);
  return `
    <li style="padding:0.5em 0; border-bottom:1px solid #f0f0f0;">
      <a href="${entry.idno || '#'}" target="_blank" rel="noopener" style="font-weight:500;">${label}</a>
      <span style="color:#888; font-size:0.9em;"> ${escapeHtml(en)}</span>
      ${entry.type ? `<span class="badge" style="background:#9a9a9a; margin-left:0.5em;">${escapeHtml(entry.type)}</span>` : ''}
    </li>`;
}

function render() {
  const panel = document.getElementById('search-results-panel');
  if (!panel) return;
  const spinner = document.getElementById('searchSpinner');
  if (spinner) spinner.style.display = 'none';

  const { keyword, placeName } = getSearchValues();

  // Places (keyword full-text + place-name titles + facets + timeline).
  renderTimeline();
  renderFacets(keyword, placeName);
  const placeGroups = filterPlaceTree(keyword, placeName);
  updateMap(placeGroups);

  // Bibliography & terminology only participate in the keyword (full-text)
  // search. The place-name box is places-only, so a place-name query with no
  // keyword should not surface bibl/term records.
  const biblMatches = (placeName && !keyword) ? [] : biblData.filter(r => textIncludes(r, keyword));
  const termMatches = (placeName && !keyword) ? [] : termData.filter(r => textIncludes(r, keyword));

  const placeCount = placeGroups.reduce((n, g) => n + 1 + g.children.length, 0);
  const total = placeCount + biblMatches.length + termMatches.length;

  let html = `
    <div style="margin:1em 0; padding:1em; background:#f9f9f9; border-left:4px solid #702020;">
      <p style="margin:0;"><strong>${total} result${total !== 1 ? 's' : ''}</strong>
      &mdash; ${placeGroups.length} site${placeGroups.length !== 1 ? 's' : ''},
      ${biblMatches.length} bibliography, ${termMatches.length} terminology</p>
    </div>`;

  if (total === 0) {
    html += '<div class="alert alert-info" style="margin:2em 0;"><p>No results found. Try adjusting your search criteria.</p></div>';
    panel.innerHTML = html;
    return;
  }

  if (placeGroups.length) {
    const body = '<ul style="list-style:none; margin:0 0 1.5em 0; padding:0;">' +
      placeGroups.map((g, i) => renderPlaceGroup(g, i)).join('') + '</ul>';
    html += renderSection('places', 'Places', placeGroups.length, body);
  }

  if (biblMatches.length) {
    let body = `<ul style="list-style:none; margin:0 0 1.5em 0; padding:0;">${biblMatches.slice(0, 100).map(renderBibl).join('')}</ul>`;
    if (biblMatches.length > 100) body += `<p class="text-muted">Showing first 100 of ${biblMatches.length} bibliography results.</p>`;
    html += renderSection('bibl', 'Bibliography', biblMatches.length, body);
  }

  if (termMatches.length) {
    let body = `<ul style="list-style:none; margin:0 0 1.5em 0; padding:0;">${termMatches.slice(0, 100).map(renderTerm).join('')}</ul>`;
    if (termMatches.length > 100) body += `<p class="text-muted">Showing first 100 of ${termMatches.length} terminology results.</p>`;
    html += renderSection('term', 'Terminology', termMatches.length, body);
  }

  panel.innerHTML = html;

  // Independent expand/collapse for each section.
  panel.querySelectorAll('.section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = document.getElementById(btn.getAttribute('data-target'));
      if (!body) return;
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      const caret = btn.querySelector('.section-caret');
      if (caret) caret.innerHTML = collapsed ? '\u25BC' : '\u25B6';
    });
  });

  // Expand/collapse for individual site rows within the Places section.
  panel.querySelectorAll('.rt-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.getAttribute('data-target'));
      if (!target) return;
      const collapsed = target.style.display === 'none';
      target.style.display = collapsed ? '' : 'none';
      btn.innerHTML = collapsed ? '\u25BC' : '\u25B6';
    });
  });
}

/**
 * A collapsible result section with a clickable header. Sections expand/
 * collapse independently; each keeps its own open/closed state.
 */
function renderSection(key, label, count, bodyHtml) {
  const bodyId = `section-${key}`;
  return `
    <div class="result-section" style="margin-bottom:1.5em;">
      <h2 class="section-toggle" data-target="${bodyId}"
          style="color:#702020; border-bottom:2px solid #702020; padding-bottom:4px; cursor:pointer; user-select:none; display:flex; align-items:center; gap:8px;">
        <span class="section-caret" style="font-size:0.8em;">\u25BC</span>
        <span>${escapeHtml(label)}</span>
        <span>(${count})</span>
      </h2>
      <div class="section-body" id="${bodyId}">${bodyHtml}</div>
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Init                                                                       */
/* -------------------------------------------------------------------------- */

// Values parsed from the URL query, applied to the inputs on load.
const urlQuery = (() => {
  const params = new URLSearchParams(window.location.search);
  return {
    keyword: params.get('fullText') || params.get('q') || params.get('keyword') || '',
    placeName: params.get('placeName') || ''
  };
})();

/**
 * Populate the search inputs from the URL query. Called on load and again
 * shortly after, because the navbar loads asynchronously and its virtual
 * keyboard plugin re-initialises the `.keyboard` inputs; re-applying ensures
 * the prefilled value survives that and stays visible.
 */
function prefillFromUrl() {
  const kwEl = document.getElementById('qs');
  const pnEl = document.getElementById('placeName');
  if (kwEl && urlQuery.keyword && kwEl.value !== urlQuery.keyword) {
    kwEl.value = urlQuery.keyword;
  }
  if (pnEl && urlQuery.placeName && pnEl.value !== urlQuery.placeName) {
    pnEl.value = urlQuery.placeName;
  }
}

function bindForm() {
  const form = document.querySelector('form[action="search.html"]') || document.getElementById('research-tool');
  if (form) {
    form.addEventListener('submit', e => { e.preventDefault(); render(); });
    form.addEventListener('reset', () => {
      Object.values(activeFacets).forEach(s => s.clear());
      timeline.selMin = timeline.dataMin;
      timeline.selMax = timeline.dataMax;
      window.setTimeout(render, 0);
    });
  }
  const kwEl = document.getElementById('qs');
  const pnEl = document.getElementById('placeName');
  if (kwEl) kwEl.addEventListener('input', render);
  if (pnEl) pnEl.addEventListener('input', render);
}

document.addEventListener('DOMContentLoaded', function () {
  bindForm();
  prefillFromUrl();
  initMap();

  const asArray = data => (Array.isArray(data) ? data : []);

  const pPlaces = fetch(PLACES_URL).then(r => (r.ok ? r.json() : [])).then(d => {
    placesData = asArray(d);
    siteTree = buildTree(placesData);
    const bounds = computeTimelineBounds(placesData);
    if (bounds) {
      timeline.dataMin = bounds[0]; timeline.dataMax = bounds[1];
      timeline.selMin = bounds[0]; timeline.selMax = bounds[1];
    }
  }).catch(err => console.error('Error loading places data:', err));

  const pBibl = fetch(BIBLIOGRAPHY_URL).then(r => (r.ok ? r.json() : [])).then(d => { biblData = asArray(d); })
    .catch(err => console.warn('Could not load bibliography data:', err));

  const pTerm = fetch(TERMINOLOGY_URL).then(r => (r.ok ? r.json() : [])).then(d => {
    termData = asArray(d);
    buildPinyinLookups(termData);
  }).catch(err => console.warn('Could not load terminology data:', err));

  Promise.allSettled([pPlaces, pBibl, pTerm]).then(render);
});
