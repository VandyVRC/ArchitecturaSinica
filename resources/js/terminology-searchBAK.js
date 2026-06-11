let terminologyData = [];
let filteredData = [];
let currentPage = 1;
let activeFacet = 'all';
const perPage = 20;

function collectTextValues(value, output = []) {
  if (!value) return output;
  if (typeof value === 'string' || typeof value === 'number') {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectTextValues(item, output));
    return output;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach(item => collectTextValues(item, output));
  }
  return output;
}

function normalizeText(text) {
  return String(text || '').toLowerCase().trim();
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getEntryTitle(entry) {
  if (entry.displayTitleEnglish) return entry.displayTitleEnglish;
  if (Array.isArray(entry.keyword) && entry.keyword.length) return entry.keyword[0];
  return entry.id || 'Untitled';
}

function getEntryTypeLabel(type) {
  return type ? String(type) : 'uncategorized';
}

function extractPinyin(entry) {
  // extract pinyin with diacritics for sorting
  const kw = Array.isArray(entry.keyword) ? entry.keyword : [];
  const pinyinRx = /[āáǎàēéěèīíǐìōóǒòūúǔùüǘǚǜńňǎǹǒǎ]/i;

  for (let i = 0; i < kw.length; i += 1) {
    const v = String(kw[i] || '');
    if (pinyinRx.test(v)) return v;
  }
  // fallback to index 3 (common pinyin position)
  if (kw[3]) return String(kw[3]);
  return '';
}

function formatEntryLabel(entry) {
  // prefer pinyin with diacritics and Chinese characters
  const kw = Array.isArray(entry.keyword) ? entry.keyword : [];
  // regex to detect pinyin with diacritics
  const pinyinRx = /[āáǎàēéěèīíǐìōóǒòūúǔùüǘǚǜńňǎǹǒǎ]/i;
  const chineseRx = /[\u4E00-\u9FFF]/;

  let pinyin = '';
  let chinese = '';

  for (let i = 0; i < kw.length; i += 1) {
    const v = String(kw[i] || '');
    if (!pinyin && pinyinRx.test(v)) pinyin = v;
    if (!chinese && chineseRx.test(v)) chinese = v;
    if (pinyin && chinese) break;
  }

  // fallbacks: common positions used in the data
  if (!pinyin && kw[3]) pinyin = String(kw[3]);
  if (!chinese && kw[1]) chinese = String(kw[1]);

  // final fallback to first available label
  const fallback = kw[0] || entry.displayTitleEnglish || entry.id || '';
  const parts = [];
  if (pinyin) parts.push(pinyin);
  if (chinese) parts.push(chinese);
  if (parts.length === 0 && fallback) parts.push(fallback);
  return parts.join(' ');
}
function recordMatchesQuery(entry, query, fields = 'all') {
  if (!query) return true;
  const lowerQuery = normalizeText(query);
  const values = fields === 'all'
    ? collectTextValues(entry)
    : fields.flatMap(field => collectTextValues(entry[field]));
  return values.some(value => normalizeText(value).includes(lowerQuery));
}

function buildFacetCounts(entries) {
  const counts = new Map();
  entries.forEach(entry => {
    const type = getEntryTypeLabel(entry.type);
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({ type, count }));
}

const ARCHITECTURAL_SUBCATEGORIES = [
  {
    key: 'bracketing',
    label: 'bracketing',
    keywordIds: ['k000001', 'k000003', 'k000007', 'k000013', 'k000014', 'k000015', 'k000019', 'k000023', 'k000024', 'k000029', 'k000033', 'k000034', 'k000058', 'k000059', 'k000065', 'k000071', 'k000072', 'k000098', 'k000099', 'k000100', 'k000103', 'k000105', 'k000134', 'k000137', 'k000148', 'k000155', 'k000156', 'k000157', 'k000158', 'k000159', 'k000166', 'k000167', 'k000168', 'k000169', 'k000172', 'k000178', 'k000193', 'k000215', 'k000216', 'k000217', 'k000219', 'k000220', 'k000221', 'k000222', 'k000233', 'k000240', 'k000247', 'k000248', 'k000249', 'k000250', 'k000251', 'k000256', 'k000257', 'k000258', 'k000259', 'k000263', 'k000265']
  },
  {
    key: 'building frame',
    label: 'building frame',
    keywordIds: ['k000005', 'k000006', 'k000011', 'k000017', 'k000018', 'k000028', 'k000035', 'k000038', 'k000045', 'k000064', 'k000067', 'k000081', 'k000097', 'k000102', 'k000107', 'k000111', 'k000114', 'k000115', 'k000116', 'k000117', 'k000120', 'k000133', 'k000138', 'k000139', 'k000140', 'k000141', 'k000142', 'k000149', 'k000150', 'k000151', 'k000152', 'k000153', 'k000160', 'k000161', 'k000171', 'k000183', 'k000190', 'k000191', 'k000192', 'k000194', 'k000204', 'k000218', 'k000223', 'k000224', 'k000225', 'k000231', 'k000232', 'k000252', 'k000253', 'k000254', 'k000255', 'k000261', 'k000262']
  },
  {
    key: 'foundations',
    label: 'foundations',
    keywordIds: ['k000005', 'k000018', 'k000102', 'k000128', 'k000136', 'k000144', 'k000145', 'k000164', 'k000207', 'k000209', 'k000210', 'k000211', 'k000235', 'k000236']
  },
  {
    key: 'roofing tiles',
    label: 'roofing tiles',
    keywordIds: ['k000009', 'k000104', 'k000106', 'k000108', 'k000109', 'k000110', 'k000206', 'k000238', 'k000239', 'k000241']
  },
  {
    key: 'roof types',
    label: 'roof types',
    keywordIds: ['k000125', 'k000126', 'k000143', 'k000146', 'k000147', 'k000185', 'k000186', 'k000188', 'k000189']
  }
];

function extractKeywordId(entry) {
  const source = `${entry.sourceFile || ''} ${entry.idno || ''} ${entry.id || ''}`;
  const match = source.match(/k\d{3,6}/i);
  return match ? match[0].toLowerCase() : '';
}

function entryMatchesArchSubcategory(entry, subKey) {
  const def = ARCHITECTURAL_SUBCATEGORIES.find(item => item.key === subKey);
  if (!def) return false;
  const keywordId = extractKeywordId(entry);
  return keywordId ? def.keywordIds.includes(keywordId) : false;
}

function buildSubFacetCounts(entries, mainFacetKey) {
  if (normalizeText(mainFacetKey) !== 'architectural feature') return [];
  const archEntries = entries.filter(entry => normalizeText(entry.type) === 'architectural feature');
  return ARCHITECTURAL_SUBCATEGORIES.map(def => {
    const count = archEntries.filter(entry => entryMatchesArchSubcategory(entry, def.key)).length;
    return {
      term: def.label,
      key: def.key,
      count
    };
  });
}

function getFacetLabels() {
  return {
    'all': 'View All',
    'architectural feature': 'architectural feature',
    'building type': 'building type',
    'site type': 'site type',
    'time period': 'time period',
    'roads and bridges': 'roads and bridges'
  };
}

function applyFilters() {
  const qsValue = document.getElementById('qs') ? document.getElementById('qs').value.trim() : '';
  const termValue = document.getElementById('term') ? document.getElementById('term').value.trim() : '';

  const searchFields = ['displayTitleEnglish', 'keyword', 'fullText', 'relatedTerms', 'architecturalFeature', 'buildingType', 'siteType', 'timePeriod', 'bridgeOrRoad', 'type'];

  let baseResults = terminologyData.filter(entry => {
    const queryMatches = recordMatchesQuery(entry, qsValue, ['displayTitleEnglish', 'keyword', 'fullText', 'relatedTerms', 'type']);
    const termMatches = recordMatchesQuery(entry, termValue, ['displayTitleEnglish', 'keyword', 'architecturalFeature', 'buildingType', 'siteType', 'timePeriod', 'bridgeOrRoad']);
    return queryMatches && termMatches;
  });

  if (activeFacet !== 'all') {
    // support subfacet selection in form 'main::sub'
    if (activeFacet.indexOf('::') > -1) {
      const [main, sub] = activeFacet.split('::');
      baseResults = baseResults.filter(entry => {
        if (normalizeText(entry.type) !== normalizeText(main)) return false;
        if (sub === 'all') return true;
        return entryMatchesArchSubcategory(entry, sub);
      });
    } else {
      baseResults = baseResults.filter(entry => normalizeText(entry.type) === normalizeText(activeFacet));
    }
  }

  // Sort alphabetically by pinyin
  baseResults.sort((a, b) => {
    const pinyinA = extractPinyin(a).toLowerCase();
    const pinyinB = extractPinyin(b).toLowerCase();
    return pinyinA.localeCompare(pinyinB, 'en', { sensitivity: 'base' });
  });

  return baseResults;
}

function renderFacets(entries) {
  const facetContainer = document.getElementById('terminology-facets') || document.querySelector('[data-template="app:display-facets"]');
  if (!facetContainer) return;

  const facetCounts = buildFacetCounts(entries);
  const labels = getFacetLabels();

  let html = '<div class="facet-display"><div style="margin-bottom:0.5em;"><h3 style="margin-top:0;">SEARCH CATEGORY</h3></div><div style="border-top:2px solid #444; padding-top:0.75em;">';
  html += `<button type="button" class="btn btn-link facet-link${activeFacet === 'all' ? ' active' : ''}" data-facet="all" style="display:block; width:100%; text-align:left; padding:0.5em 0;">${labels.all}</button>`;
  facetCounts.forEach(facet => {
    const isActive = normalizeText(activeFacet) === normalizeText(facet.type) || activeFacet.startsWith(facet.type + '::');
    html += `<div style="margin-bottom:0.25em;">`;
    html += `<button type="button" class="btn btn-link facet-link${isActive ? ' active' : ''}" data-facet="${escapeHtml(facet.type)}" style="display:block; width:100%; text-align:left; padding:0.5em 0;">${escapeHtml(labels[facet.type] || facet.type)} (${facet.count})</button>`;

    // If this is the architectural feature main facet, render subcategories
    if (normalizeText(facet.type) === 'architectural feature') {
      const subFacets = buildSubFacetCounts(entries, 'architectural feature');
      if (subFacets.length || isActive) {
        html += '<div style="margin-left:0.75em; padding-left:0.5em; border-left:2px solid #eee; margin-top:0.25em;">';
        const subViewAllActive = activeFacet === `${facet.type}::all` || normalizeText(activeFacet) === normalizeText(facet.type);
        html += `<button type="button" class="btn btn-link subfacet-link${subViewAllActive ? ' active' : ''}" data-facet-main="${escapeHtml(facet.type)}" data-subfacet="all" style="display:block; width:100%; text-align:left; padding:0.25em 0;">View all</button>`;
        subFacets.forEach(sf => {
          const subActive = activeFacet === `${facet.type}::${sf.key}`;
          html += `<button type="button" class="btn btn-link subfacet-link${subActive ? ' active' : ''}" data-facet-main="${escapeHtml(facet.type)}" data-subfacet="${escapeHtml(sf.key)}" style="display:block; width:100%; text-align:left; padding:0.25em 0;">${escapeHtml(sf.term)} (${sf.count})</button>`;
        });
        html += '</div>';
      }
    }
    html += '</div>';
  });
  html += '</div></div>';

  facetContainer.innerHTML = html;
  // main facet buttons
  facetContainer.querySelectorAll('[data-facet]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      activeFacet = button.getAttribute('data-facet') || 'all';
      currentPage = 1;
      renderResults();
    });
  });
  // subfacet buttons
  facetContainer.querySelectorAll('[data-subfacet]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      const main = button.getAttribute('data-facet-main');
      const sub = button.getAttribute('data-subfacet');
      activeFacet = `${main}::${sub}`;
      currentPage = 1;
      renderResults();
    });
  });
}

function renderPagination(totalResults) {
  const totalPages = Math.max(1, Math.ceil(totalResults / perPage));
  let html = '<div class="text-right" style="margin-bottom:0.75em;">';
  if (totalPages > 1) {
    if (currentPage > 1) {
      html += `<button type="button" class="btn btn-default btn-sm" onclick="changePage(${currentPage - 1})">&laquo; Prev</button> `;
    }
    const maxPages = Math.min(totalPages, 6);
    for (let page = 1; page <= maxPages; page += 1) {
      if (page === currentPage) {
        html += `<span class="btn btn-primary btn-sm disabled">${page}</span> `;
      } else {
        html += `<button type="button" class="btn btn-default btn-sm" onclick="changePage(${page})">${page}</button> `;
      }
    }
    if (totalPages > maxPages) {
      html += `<button type="button" class="btn btn-default btn-sm" onclick="changePage(${Math.min(totalPages, currentPage + 1)})">Next &raquo;</button>`;
    }
  }
  html += '</div>';
  return html;
}

function renderResults() {
  const resultsPanel = document.getElementById('search-results-panel') || document.querySelector('[data-template="search:show-hits"]');
  if (!resultsPanel) return;

  const spinner = document.getElementById('searchSpinner');
  if (spinner) spinner.style.display = 'none';

  filteredData = applyFilters();

  if (!document.getElementById('terminology-facets') || !document.getElementById('terminology-hits')) {
    resultsPanel.innerHTML = `
      <div class="row">
        <div class="col-md-4">
          <div id="terminology-facets"></div>
        </div>
        <div class="col-md-8">
          <div id="terminology-hits"></div>
        </div>
      </div>`;
  }

  renderFacets(filteredData);

  const hitsContainer = document.getElementById('terminology-hits') || resultsPanel;
  if (filteredData.length === 0) {
    hitsContainer.innerHTML = '<div class="alert alert-info" style="margin:2em 0;"><p>No results found. Try adjusting your search criteria or facet selection.</p></div>';
    return;
  }

  const start = (currentPage - 1) * perPage;
  const end = start + perPage;
  const pageResults = filteredData.slice(start, end);
  const typeLabel = activeFacet === 'all' ? '' : ` - ${escapeHtml(activeFacet)}`;

  let html = `<div style="margin:0 0 1em 0;"><h3 style="margin-top:0;">${filteredData.length} Search results${typeLabel}</h3></div>`;
  html += renderPagination(filteredData.length);
  html += '<div class="terminology-results">';

  pageResults.forEach((entry, index) => {
    const rowNumber = start + index + 1;
    const keywordSummary = Array.isArray(entry.keyword) ? entry.keyword.slice(0, 4).join('; ') : (entry.keyword || '');
    html += `
      <div class="terminology-result" style="display:flex; gap:1em; align-items:flex-start; padding:0.5em 0; border-bottom:1px solid #eee;">
        <div style="flex:0 0 2.5em; text-align:center;">
          <span class="badge" style="background:#7a7a7a; padding:0.45em 0.65em; border-radius:999px;">${rowNumber}</span>
        </div>
        <div style="flex:1;">
          <div style="font-size:1.05em; line-height:1.35; margin-bottom:0.15em;">
            <a href="${entry.idno || '#'}" target="_blank" rel="noopener">${escapeHtml(formatEntryLabel(entry))}</a>
            <span style="color:#666;"> (${escapeHtml(getEntryTypeLabel(entry.type))})</span>
          </div>
          ${keywordSummary ? `<div style="color:#666; font-size:0.95em;">${escapeHtml(keywordSummary)}</div>` : ''}
        </div>
      </div>`;
  });

  html += '</div>';
  html += renderPagination(filteredData.length);
  hitsContainer.innerHTML = html;
}

function changePage(page) {
  currentPage = page;
  renderResults();
  const resultsEl = document.getElementById('search-results-panel');
  if (resultsEl) {
    window.scrollTo(0, resultsEl.offsetTop - 100);
  }
}

function executeSearch(event) {
  if (event) event.preventDefault();
  const spinner = document.getElementById('searchSpinner');
  if (spinner) spinner.style.display = 'inline';
  currentPage = 1;
  renderResults();
}

function bindSearchForm() {
  const searchForm = document.querySelector('form[action="terminology.html"]');
  if (searchForm) {
    searchForm.addEventListener('submit', executeSearch);
    searchForm.addEventListener('reset', () => {
      window.setTimeout(() => {
        activeFacet = 'all';
        currentPage = 1;
        renderResults();
      }, 0);
    });
  }

  const qsInput = document.getElementById('qs');
  const termInput = document.getElementById('term');
  if (qsInput) qsInput.addEventListener('input', () => {
    currentPage = 1;
    renderResults();
  });
  if (termInput) termInput.addEventListener('input', () => {
    currentPage = 1;
    renderResults();
  });
}

document.addEventListener('DOMContentLoaded', function() {
  bindSearchForm();
  fetch('/json/terminology-combined.json')
    .then(response => response.json())
    .then(data => {
      terminologyData = data;
      filteredData = terminologyData.slice();
      renderResults();
    })
    .catch(error => {
      console.error('Error loading terminology data:', error);
      const resultsPanel = document.getElementById('search-results-panel') || document.querySelector('[data-template="search:show-hits"]');
      if (resultsPanel) {
        resultsPanel.innerHTML = '<div class="alert alert-danger" style="margin:2em 0;"><p>Unable to load terminology data.</p></div>';
      }
      const spinner = document.getElementById('searchSpinner');
      if (spinner) spinner.style.display = 'none';
    });
});
