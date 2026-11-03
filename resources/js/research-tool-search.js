/*
 * research-tool-search.js
 *
 * Static, client-side renderer for the Architectura Sinica research tool.
 * Loads the combined places JSON and renders an alphabetical list of sites,
 * with their related places (buildings, pagodas, etc.) nested underneath.
 *
 * Data model (from tei2Json.py):
 *   - Sites:           record.type === 'site'
 *   - Related places:  every other type (e.g. 'schema:LandmarksOrHistoricalBuildings',
 *                      'building', 'buildings', 'building type')
 *   - Nesting link:    a relation on the related place with
 *                        ana === 'contained' (ref === 'schema:containedInPlace')
 *                      whose `active` is the place itself and whose `passive`
 *                      is the parent place URI. Parents may themselves be
 *                      related places, so we walk up to the root site.
 *
 * Mirrors the pattern used by bibliography-search.js and terminology-search.js:
 * fetch JSON, render into #search-results-panel, ignore the legacy Srophe
 * data-template divs. This is a static S3/CloudFront site, not an eXist app.
 */

let placesData = [];
let siteTree = []; // [{ site, children: [place, ...] }]
let orphanPlaces = []; // related places with no resolvable parent site

// Active facet selections. Each holds a Set of selected values (empty = no filter).
const activeFacets = {
  province: new Set(),
  dynasty: new Set(),
  buildingType: new Set(),
  architecturalFeature: new Set()
};

const DATA_URL = '/json/places-combined.json';
const TERMINOLOGY_URL = '/json/terminology-combined.json';

// Timeline (year range) filter state.
const timeline = {
  dataMin: null,   // earliest year across all places
  dataMax: null,   // latest year across all places
  selMin: null,    // currently selected window start
  selMax: null     // currently selected window end
};

const CJK_CHAR_RE = /[\u4e00-\u9fff]/;

// English architectural-feature label -> { pinyin, chinese }.
const featureLabels = new Map();
// Dynasty name (lowercased, English or romanized) -> { pinyin, chinese }.
const dynastyLabels = new Map();
// Building-type English label -> { pinyin, chinese }.
const buildingTypeLabels = new Map();

// Manual fallbacks for dynasty buckets whose exact spelling isn't a
// terminology display/keyword form.
const DYNASTY_LABEL_FALLBACK = {
  'nan song': { pinyin: 'Nán Sòng', chinese: '南宋' },
  'bei wei': { pinyin: 'Běi Wèi', chinese: '北魏' },
  'wei': { pinyin: 'Wèi', chinese: '魏' }
};

function firstCjk(values) {
  for (const v of values || []) {
    if (v && CJK_CHAR_RE.test(v)) return String(v).trim();
  }
  return '';
}

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
    // Also index romanized (ASCII) keyword forms for dynasties, e.g. "Bei Song".
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

/**
 * Combine pinyin + Chinese into one label, e.g. "Běi Sòng 北宋".
 */
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

/**
 * Display label for an architectural-feature facet value: "pinyin 中文" if
 * known, otherwise the original English string.
 */
function featureDisplayLabel(value) {
  return combineLabel(featureLabels.get(String(value).trim())) || value;
}

/**
 * Display label for a dynasty facet value: "pinyin 中文" if known,
 * otherwise the original bucket name.
 */
function dynastyDisplayLabel(value) {
  const key = String(value).trim().toLowerCase();
  return combineLabel(dynastyLabels.get(key)) || combineLabel(DYNASTY_LABEL_FALLBACK[key]) || value;
}

function buildingTypeDisplayLabel(value) {
  return combineLabel(buildingTypeLabels.get(String(value).trim())) || value;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

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

/**
 * English display label for a place. Falls back through the available name
 * fields so nothing renders as blank.
 */
function englishLabel(record) {
  if (!record) return 'Untitled';
  if (record.displayTitleEnglish) return record.displayTitleEnglish;
  if (Array.isArray(record.placeName) && record.placeName.length) return record.placeName[0];
  if (Array.isArray(record.title) && record.title.length) return record.title[0];
  return record.id || 'Untitled';
}

/**
 * Secondary label: the Chinese / pinyin forms, shown in muted text.
 */
function secondaryLabel(record) {
  const names = Array.isArray(record && record.placeName) ? record.placeName : [];
  // placeName[0] is English; the remaining forms are zh-Hant / zh-Hans / pinyin / wadegile.
  const extras = names.slice(1).filter(Boolean);
  return extras.slice(0, 3).join(' \u00b7 ');
}

function locationLabel(record) {
  const parts = [];
  if (Array.isArray(record.province) && record.province.length) {
    parts.push(record.province[0]);
  } else if (Array.isArray(record.nestedLocation) && record.nestedLocation.length) {
    parts.push(record.nestedLocation[0]);
  }
  return parts.join(', ');
}

function typeLabel(record) {
  if (isSite(record)) return 'site';
  const traits = Array.isArray(record.traitType) ? record.traitType.filter(Boolean) : [];
  if (traits.length) return traits[0];
  const t = String(record.type || '').toLowerCase();
  if (t === 'schema:landmarksorhistoricalbuildings') return 'building';
  return t || 'related place';
}

/**
 * Find the parent place URI for a related place via the containment relation.
 */
function containedParentId(record) {
  const rels = Array.isArray(record.relations) ? record.relations : [];
  for (const rel of rels) {
    const isContain = rel.ana === 'contained' || rel.ref === 'schema:containedInPlace';
    if (!isContain) continue;
    // active should be this record; passive is the parent.
    return uriId(rel.passive);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Date range extraction                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Parse a leading year from an ISO-ish date string. Treats "0000", "0" and
 * empty as unknown/open-ended (these are placeholders in the data, e.g. an
 * open-ended "Post Qing 1912 -" range stored as to="0000"), returning null
 * rather than a literal year 0.
 */
function parseYear(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/^(-?\d{1,4})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  // 0 ("0000") and 1 ("0001") are placeholders for unknown dates in this data,
  // not literal years, so treat them as unknown.
  if (year === 0 || year === 1) return null;
  return year;
}

/**
 * [minYear, maxYear] spanning a record's dates, or null.
 * Prefers the actual construction dates (dateRange); falls back to the broad
 * dynasty span (dynastyRange) only when no real Date state exists. This keeps
 * a Qing pavilion out of the Han era while still dating sites that are
 * described only by dynasty (e.g. "Northern Song - Ming").
 * Each range contributes its own [from..to]; an open-ended range (unknown
 * `to`) contributes just its `from` year, and vice versa.
 */
function recordYearSpan(record) {
  let ranges = Array.isArray(record.dateRange) ? record.dateRange : [];
  if (ranges.length === 0 && Array.isArray(record.dynastyRange)) {
    ranges = record.dynastyRange;
  }
  let lo = null;
  let hi = null;
  ranges.forEach(r => {
    const f = parseYear(r.from);
    const t = parseYear(r.to);
    if (f === null && t === null) return;
    // If one end is missing, treat the range as a point at the known end.
    const start = f === null ? t : f;
    const end = t === null ? f : t;
    if (lo === null || start < lo) lo = start;
    if (hi === null || end > hi) hi = end;
  });
  return lo === null ? null : [lo, hi];
}

/**
 * Year span for a whole group (site + children), unioned.
 */
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

/**
 * Does a group's date span overlap the currently selected timeline window?
 * Groups with no date info are always kept (not excluded by the timeline).
 */
function groupInTimeline(group) {
  if (timeline.selMin === null || timeline.selMax === null) return true;
  const span = groupYearSpan(group);
  if (!span) return true;
  return span[0] <= timeline.selMax && span[1] >= timeline.selMin;
}

/* -------------------------------------------------------------------------- */
/* Facet value extraction                                                     */
/* -------------------------------------------------------------------------- */

const CJK_RE = /[\u4e00-\u9fff]/;

/**
 * Province values live on sites as an array mixing English and Chinese forms
 * (e.g. ['Shanxi', '山西省']). Facet on the English (non-CJK) form.
 */
function provinceValues(record) {
  const arr = Array.isArray(record.province) ? record.province : [];
  const english = arr.filter(v => v && !CJK_RE.test(v));
  // Normalise so "Shanxi Province" and "Shanxi" collapse into one bucket.
  const normalized = english
    .map(v => v.trim().replace(/\s+Province$/i, '').trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}

/**
 * Canonical dynasty buckets, in chronological order. Each has a set of
 * `match` phrases (synonyms) that map onto the single canonical name.
 * Longer / more specific phrases are matched before generic ones so that,
 * e.g., "Northern Song" resolves to the Northern Song bucket rather than the
 * generic Song bucket.
 */
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

// Chronological rank of each canonical bucket, for sorting.
const DYNASTY_ORDER = DYNASTY_BUCKETS.map(b => b.name);

/**
 * Normalise a raw dynasty string into one or more canonical dynasty buckets.
 * Strips trailing date ranges, collapses synonyms (e.g. "Bei Song" and
 * "Northern Song" -> "Northern Song"), and drops noise (keyword ids, glosses).
 * When a specific bucket (Northern/Southern Song) matches, the generic "Song"
 * bucket is suppressed for that string.
 */
function normalizeDynasty(raw) {
  if (!raw) return [];
  let s = String(raw).trim();
  if (/^k\d{3,}$/i.test(s)) return []; // keyword id noise
  // Remove year numbers / ranges, e.g. "960 - 1127", "1644-1912", "618 - 907".
  s = s.replace(/\d{2,4}\s*[-–]\s*\d{2,4}/g, ' ').replace(/\b\d{2,4}\b/g, ' ');

  const found = new Set();
  DYNASTY_BUCKETS.forEach(bucket => {
    const hit = bucket.match.some(phrase =>
      new RegExp('\\b' + phrase.replace(/\s+/g, '\\s+') + '\\b', 'i').test(s)
    );
    if (hit) found.add(bucket.name);
  });

  // If a specific Song bucket matched, drop the generic "Song".
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
  province: provinceValues,
  dynasty: dynastyValues,
  buildingType: buildingTypeValues,
  architecturalFeature: architecturalFeatureValues
};

/**
 * All facet values for a group, aggregated across a site AND its children.
 * This is what makes a site count toward a Dynasty/Feature facet even when
 * the matching value only appears on a nested building.
 */
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
    const groupValues = groupFacetValues(group, key);
    // OR within a facet: keep the group if it has ANY selected value.
    for (const v of selected) if (groupValues.has(v)) return true;
    return false;
  });
}

function anyFacetActive() {
  return Object.values(activeFacets).some(s => s.size > 0);
}

// Province is a site-level attribute (buildings don't carry it), so it filters
// the whole group. Dynasty and architectural feature exist per place, so they
// filter individual places.
const PLACE_LEVEL_FACETS = ['dynasty', 'buildingType', 'architecturalFeature'];

/**
 * Does an individual place satisfy the active per-place facets (dynasty,
 * architectural feature)? For each active per-place facet the place must carry
 * one of the selected values.
 */
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

function buildTree(records) {
  const byId = new Map();
  records.forEach(r => byId.set(r.id, r));

  const sites = records.filter(isSite);
  const related = records.filter(r => !isSite(r));

  // Resolve each related place to its ROOT site by walking up the chain.
  function rootSiteId(record) {
    let current = record;
    const seen = new Set();
    while (current && !isSite(current)) {
      if (seen.has(current.id)) return null; // cycle guard
      seen.add(current.id);
      const parentId = containedParentId(current);
      if (!parentId) return null;
      current = byId.get(parentId);
      if (!current) return null;
    }
    return current ? current.id : null;
  }

  const childrenBySite = new Map();
  const orphans = [];
  related.forEach(r => {
    const rootId = rootSiteId(r);
    if (rootId && byId.get(rootId) && isSite(byId.get(rootId))) {
      if (!childrenBySite.has(rootId)) childrenBySite.set(rootId, []);
      childrenBySite.get(rootId).push(r);
    } else {
      orphans.push(r);
    }
  });

  const tree = sites.map(site => {
    const children = (childrenBySite.get(site.id) || []).slice();
    children.sort((a, b) => englishLabel(a).localeCompare(englishLabel(b), 'en', { sensitivity: 'base' }));
    return { site, children };
  });

  tree.sort((a, b) => englishLabel(a.site).localeCompare(englishLabel(b.site), 'en', { sensitivity: 'base' }));
  orphans.sort((a, b) => englishLabel(a).localeCompare(englishLabel(b), 'en', { sensitivity: 'base' }));

  return { tree, orphans };
}

/* -------------------------------------------------------------------------- */
/* Search / filter                                                            */
/* -------------------------------------------------------------------------- */

function recordMatches(record, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystacks = [];
  if (record.displayTitleEnglish) haystacks.push(record.displayTitleEnglish);
  if (Array.isArray(record.placeName)) haystacks.push(...record.placeName);
  if (Array.isArray(record.title)) haystacks.push(...record.title);
  if (Array.isArray(record.alternateNames)) haystacks.push(...record.alternateNames);
  if (Array.isArray(record.province)) haystacks.push(...record.province);
  if (Array.isArray(record.nestedLocation)) haystacks.push(...record.nestedLocation);
  if (record.fullText) haystacks.push(record.fullText);
  return haystacks.some(v => String(v || '').toLowerCase().includes(q));
}

function nameMatches(record, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const names = [];
  if (record.displayTitleEnglish) names.push(record.displayTitleEnglish);
  if (Array.isArray(record.placeName)) names.push(...record.placeName);
  if (Array.isArray(record.title)) names.push(...record.title);
  if (Array.isArray(record.alternateNames)) names.push(...record.alternateNames);
  return names.some(v => String(v || '').toLowerCase().includes(q));
}

/**
 * Filter the tree. A site stays if it matches, or if any of its children
 * match (in which case only the matching children are shown).
 */
function filterTree(tree, keyword, placeName) {
  const results = [];
  const placeFacetActive = anyPlaceFacetActive();

  tree.forEach(group => {
    // Province (site-level) facet + timeline drop the whole group.
    if (!groupMatchesFacets(group)) return;
    if (!groupInTimeline(group)) return;

    // Per-place facets (dynasty, architectural feature): narrow to matching
    // places so we don't drag in a site's unrelated buildings.
    const siteFacetOk = !placeFacetActive || placeMatchesPlaceFacets(group.site);
    const facetChildren = placeFacetActive
      ? group.children.filter(placeMatchesPlaceFacets)
      : group.children;

    // Then apply the keyword / place-name text search.
    const siteHit = siteFacetOk && recordMatches(group.site, keyword) && nameMatches(group.site, placeName);
    const matchedChildren = facetChildren.filter(
      c => recordMatches(c, keyword) && nameMatches(c, placeName)
    );

    if (siteHit) {
      // Site matches: show it with the (facet-filtered) children.
      results.push({ site: group.site, children: matchedChildren });
    } else if (matchedChildren.length) {
      // Only some children match: show the site as context with those children.
      results.push({ site: group.site, children: matchedChildren, partial: true });
    }
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

/**
 * All places in a group (the site plus its nested children).
 */
function groupPlaces(group) {
  return [group.site, ...group.children];
}

/**
 * Count how many PLACES (sites + nested children) carry each facet value,
 * given the CURRENT keyword, place-name and OTHER facet selections (ignoring
 * this facet's own selection, so counts stay stable as you toggle within it).
 */
function computeFacetCounts(facetKey, keyword, placeName) {
  const counts = new Map();
  const extractor = FACET_EXTRACTORS[facetKey];

  siteTree.forEach(group => {
    // The group must survive the name/keyword filter and OTHER facet filters
    // for its places to contribute to this facet's counts.
    const siteHit = recordMatches(group.site, keyword) && nameMatches(group.site, placeName);
    const childHit = group.children.some(
      c => recordMatches(c, keyword) && nameMatches(c, placeName)
    );
    if (!siteHit && !childHit) return;
    if (!groupInTimeline(group)) return;

    const otherOk = Object.keys(activeFacets).every(key => {
      if (key === facetKey) return true;
      const selected = activeFacets[key];
      if (selected.size === 0) return true;
      const groupValues = groupFacetValues(group, key);
      for (const v of selected) if (groupValues.has(v)) return true;
      return false;
    });
    if (!otherOk) return;

    // Count each place individually so totals reflect all matching places.
    groupPlaces(group).forEach(place => {
      new Set(extractor(place)).forEach(v => {
        counts.set(v, (counts.get(v) || 0) + 1);
      });
    });
  });
  return counts;
}

function sortFacetEntries(facetKey, entries) {
  if (facetKey === 'dynasty') {
    // Chronological order using the canonical bucket ordering.
    const rank = v => {
      const i = DYNASTY_ORDER.indexOf(v);
      return i === -1 ? DYNASTY_ORDER.length : i;
    };
    return entries.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  }
  if (facetKey === 'architecturalFeature') {
    // Alphabetical by pinyin display label.
    return entries.sort((a, b) =>
      featureDisplayLabel(a[0]).localeCompare(featureDisplayLabel(b[0]), 'en', { sensitivity: 'base' })
    );
  }
  // province: by count desc, then alpha
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
        // Selected: solid dark background with white text (readable).
        // Unselected: transparent with light text.
        const style = isOn
          ? 'color:#fff; background:#4a1414; font-weight:600;'
          : 'color:rgba(255,255,255,0.9); background:transparent;';
        // Dynasty and architectural-feature facets display "pinyin 中文".
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
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-facet');
      activeFacets[key].clear();
      render();
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

function getSearchValues() {
  const kwEl = document.getElementById('qs');
  const pnEl = document.getElementById('placeName');
  return {
    keyword: kwEl ? kwEl.value.trim() : '',
    placeName: pnEl ? pnEl.value.trim() : ''
  };
}

function renderChild(place) {
  const label = escapeHtml(englishLabel(place));
  const secondary = escapeHtml(secondaryLabel(place));
  const type = escapeHtml(typeLabel(place));
  const href = place.idno || '#';
  return `
    <li class="rt-child" style="padding:0.35em 0; border-bottom:1px solid #f0f0f0;">
      <a href="${href}" target="_blank" rel="noopener" style="font-weight:500;">${label}</a>
      ${secondary ? `<span style="color:#888; font-size:0.92em;"> ${secondary}</span>` : ''}
      <span class="badge" style="background:#9a9a9a; margin-left:0.5em;">${type}</span>
    </li>`;
}

function renderGroup(group, index) {
  const site = group.site;
  const label = escapeHtml(englishLabel(site));
  const secondary = escapeHtml(secondaryLabel(site));
  const loc = escapeHtml(locationLabel(site));
  const href = site.idno || '#';
  const childCount = group.children.length;
  const bodyId = `rt-group-${index}`;

  let childrenHtml = '';
  if (childCount) {
    childrenHtml = `
      <ul class="rt-children" id="${bodyId}" style="list-style:none; margin:0.5em 0 0 0; padding:0 0 0 1.5em;">
        ${group.children.map(renderChild).join('')}
      </ul>`;
  }

  const toggle = childCount
    ? `<button type="button" class="btn btn-link rt-toggle" data-target="${bodyId}"
         style="padding:0 0.5em 0 0; text-decoration:none; font-size:1.1em; color:#702020;"
         aria-expanded="true">&#9660;</button>`
    : `<span style="display:inline-block; width:1.5em;"></span>`;

  return `
    <li class="rt-site" style="padding:0.85em 0; border-bottom:2px solid #e5e5e5;">
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

/* -------------------------------------------------------------------------- */
/* Mobile filter-menu collapse                                                */
/* -------------------------------------------------------------------------- */

// On mobile, collapse the filter menu by default once results exist so the
// results are visible near the top. Once the user taps the toggle, respect
// their choice for the rest of the session. CSS (max-width:768px) does the
// actual hide/show; desktop is unaffected.
let filtersCollapsed = true;      // default collapsed when results are present
let filtersUserOverride = false;  // true once the user taps the toggle

function updateFiltersToggleLabel() {
  const btn = document.getElementById('filters-toggle');
  if (!btn) return;
  btn.textContent = filtersCollapsed ? 'Show filters' : 'Hide filters';
  btn.setAttribute('aria-expanded', filtersCollapsed ? 'false' : 'true');
}

function syncFiltersMenu(hasResults) {
  document.body.classList.toggle('has-results', hasResults);
  // When there are no results, never collapse (menu stays fully visible).
  const collapsed = hasResults && filtersCollapsed;
  document.body.classList.toggle('filters-collapsed', collapsed);
  updateFiltersToggleLabel();
}

function wireFiltersToggle() {
  const btn = document.getElementById('filters-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    filtersCollapsed = !filtersCollapsed;
    filtersUserOverride = true;
    document.body.classList.toggle('filters-collapsed',
      document.body.classList.contains('has-results') && filtersCollapsed);
    updateFiltersToggleLabel();
  });
}

function render() {
  const panel = document.getElementById('search-results-panel');
  if (!panel) return;

  const spinner = document.getElementById('searchSpinner');
  if (spinner) spinner.style.display = 'none';

  const { keyword, placeName } = getSearchValues();
  renderTimeline();
  renderFacets(keyword, placeName);
  const filtered = filterTree(siteTree, keyword, placeName);

  updateMap(filtered);

  const totalSites = filtered.length;
  const totalPlaces = filtered.reduce((n, g) => n + g.children.length, 0);

  // Mobile: collapse the filter menu when results exist (unless the user has
  // overridden the state this session); keep it expanded when empty.
  if (!filtersUserOverride) filtersCollapsed = totalSites > 0;
  syncFiltersMenu(totalSites > 0);

  let html = `
    <div style="margin:1em 0; padding:1em; background:#f9f9f9; border-left:4px solid #702020;">
      <p style="margin:0;"><strong>${totalSites} site${totalSites !== 1 ? 's' : ''}</strong>
      with ${totalPlaces} related place${totalPlaces !== 1 ? 's' : ''}</p>
    </div>`;

  if (totalSites === 0) {
    html += '<div class="alert alert-info" style="margin:2em 0;"><p>No places found. Try adjusting your search criteria.</p></div>';
    panel.innerHTML = html;
    return;
  }

  html += '<ul class="rt-site-list" style="list-style:none; margin:0; padding:0;">';
  html += filtered.map((g, i) => renderGroup(g, i)).join('');
  html += '</ul>';

  panel.innerHTML = html;

  // Wire up expand/collapse toggles.
  panel.querySelectorAll('.rt-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.getAttribute('data-target'));
      if (!target) return;
      const collapsed = target.style.display === 'none';
      target.style.display = collapsed ? '' : 'none';
      btn.innerHTML = collapsed ? '\u25BC' : '\u25B6';
      btn.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Map                                                                        */
/* -------------------------------------------------------------------------- */

let placeMap = null;
let markerLayer = null;

/**
 * Return [lat, lon] for a group: prefer the site's gps, else the first child
 * that has coordinates.
 */
function groupLatLng(group) {
  const fromGps = record => {
    const gps = Array.isArray(record.gps) ? record.gps : [];
    for (const g of gps) {
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

/**
 * Sync map markers to the currently filtered groups.
 */
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
    const marker = L.marker(latlng).bindPopup(
      `<a href="${href}" target="_blank" rel="noopener"><strong>${label}</strong></a>` +
      (count ? `<br><span style="color:#666;">${count} related place${count !== 1 ? 's' : ''}</span>` : '')
    );
    markerLayer.addLayer(marker);
    bounds.push(latlng);
  });

  if (bounds.length) {
    placeMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
  }
}

/* -------------------------------------------------------------------------- */
/* Timeline range slider                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Compute slider bounds from the true min/max year across all records
 * (year 0 / 1 placeholders are already treated as unknown by parseYear),
 * rounded outward to whole centuries so the slider spans the full data range.
 */
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
  if (timeline.dataMin === null) {
    container.innerHTML = '';
    return;
  }

  const minPct = yearToPercent(timeline.selMin);
  const maxPct = yearToPercent(timeline.selMax);

  // A few evenly spaced ticks.
  const tickCount = 5;
  let ticks = '';
  for (let i = 0; i < tickCount; i += 1) {
    const pct = (i / (tickCount - 1)) * 100;
    const year = percentToYear(pct);
    ticks += `<span class="tl-tick" style="left:${pct}%;">${year}</span>`;
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
      <div class="tl-handle" id="tl-handle-min" tabindex="0" role="slider"
           aria-label="Start year" aria-valuemin="${timeline.dataMin}" aria-valuemax="${timeline.dataMax}"
           aria-valuenow="${timeline.selMin}" style="left:${minPct}%;"></div>
      <div class="tl-handle" id="tl-handle-max" tabindex="0" role="slider"
           aria-label="End year" aria-valuemin="${timeline.dataMin}" aria-valuemax="${timeline.dataMax}"
           aria-valuenow="${timeline.selMax}" style="left:${maxPct}%;"></div>
      ${ticks}
    </div>`;

  wireTimeline(container);
}

function wireTimeline(container) {
  const track = container.querySelector('#tl-track');
  const resetBtn = container.querySelector('.tl-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      timeline.selMin = timeline.dataMin;
      timeline.selMax = timeline.dataMax;
      render();
    });
  }
  if (!track) return;

  const startDrag = which => downEvent => {
    downEvent.preventDefault();
    const rect = track.getBoundingClientRect();

    const move = moveEvent => {
      const clientX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
      let pct = ((clientX - rect.left) / rect.width) * 100;
      pct = Math.max(0, Math.min(100, pct));
      const year = percentToYear(pct);
      if (which === 'min') {
        timeline.selMin = Math.min(year, timeline.selMax);
      } else {
        timeline.selMax = Math.max(year, timeline.selMin);
      }
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

  const minH = container.querySelector('#tl-handle-min');
  const maxH = container.querySelector('#tl-handle-max');
  [['min', minH], ['max', maxH]].forEach(([which, handle]) => {
    if (!handle) return;
    handle.addEventListener('mousedown', startDrag(which));
    handle.addEventListener('touchstart', startDrag(which), { passive: false });
    // Keyboard support: arrow keys nudge by 10 years.
    handle.addEventListener('keydown', e => {
      const step = (e.key === 'ArrowLeft' || e.key === 'ArrowDown') ? -10
        : (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 10 : 0;
      if (!step) return;
      e.preventDefault();
      if (which === 'min') {
        timeline.selMin = Math.max(timeline.dataMin, Math.min(timeline.selMin + step, timeline.selMax));
      } else {
        timeline.selMax = Math.min(timeline.dataMax, Math.max(timeline.selMax + step, timeline.selMin));
      }
      render();
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Init                                                                       */
/* -------------------------------------------------------------------------- */

function bindForm() {
  const form = document.querySelector('form[action="research-tool.html"]');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      render();
    });
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
  wireFiltersToggle();
  initMap();

  // Terminology data is optional: it only supplies pinyin labels for the
  // architectural-feature facet. If it fails, we fall back to English labels.
  const terminologyPromise = fetch(TERMINOLOGY_URL)
    .then(r => (r.ok ? r.json() : []))
    .then(buildPinyinLookups)
    .catch(err => console.warn('Could not load terminology pinyin lookup:', err));

  const placesPromise = fetch(DATA_URL)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      placesData = Array.isArray(data) ? data : [];
      const built = buildTree(placesData);
      siteTree = built.tree;
      orphanPlaces = built.orphans;

      // Initialise the timeline bounds/selection from the data.
      const bounds = computeTimelineBounds(placesData);
      if (bounds) {
        timeline.dataMin = bounds[0];
        timeline.dataMax = bounds[1];
        timeline.selMin = bounds[0];
        timeline.selMax = bounds[1];
      }

      console.log(`Loaded ${placesData.length} places: ${siteTree.length} sites`);
    })
    .catch(error => {
      console.error('Error loading places data:', error);
      const panel = document.getElementById('search-results-panel');
      if (panel) {
        panel.innerHTML = '<div class="alert alert-danger" style="margin:2em 0;"><p>Unable to load places data.</p></div>';
      }
      const spinner = document.getElementById('searchSpinner');
      if (spinner) spinner.style.display = 'none';
      throw error;
    });

  // Render once both are settled so pinyin labels are available on first paint.
  Promise.allSettled([terminologyPromise, placesPromise]).then(() => {
    if (siteTree.length) render();
  });
});
