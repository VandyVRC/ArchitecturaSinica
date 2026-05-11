let placeData = [];
let placeResults = [];
let currentPage = 1;
const perPage = 20;

// Load place data on page load and show all results initially
fetch('/json/combined.json')
  .then(response => response.json())
  .then(data => {
    placeData = data;
    placeResults = placeData.slice();
    console.log(`Loaded ${data.length} place records`);
    // hide spinner if present
    const spinner = document.getElementById('searchSpinner');
    if (spinner) spinner.style.display = 'none';
    // show all results immediately
    displayResults(1);
  })
  .catch(error => {
    console.error('Error loading place data:', error);
  });

function performSearch(query, fields = 'all') {
  if (!query || query.length < 1) return [];
  const lowerQuery = query.toLowerCase();
  return placeData.filter(entry => {
    if (fields === 'all') {
      return Object.values(entry).some(value => {
        if (typeof value === 'string') return value.toLowerCase().includes(lowerQuery);
        if (Array.isArray(value)) return value.some(v => typeof v === 'string' && v.toLowerCase().includes(lowerQuery));
        return false;
      });
    } else {
      const fieldsArray = Array.isArray(fields) ? fields : [fields];
      return fieldsArray.some(field => {
        const fieldValue = entry[field];
        if (typeof fieldValue === 'string') return fieldValue.toLowerCase().includes(lowerQuery);
        if (Array.isArray(fieldValue)) return fieldValue.some(v => typeof v === 'string' && v.toLowerCase().includes(lowerQuery));
        return false;
      });
    }
  });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function displayResults(page = 1) {
  const resultsPanel = document.querySelector('div[data-template="search:show-hits"]') || document.getElementById('search-results-panel');
  if (!resultsPanel) return;
  const spinner = document.getElementById('searchSpinner');
  if (spinner) spinner.style.display = 'none';

  if (placeResults.length === 0) {
    resultsPanel.innerHTML = '<div class="alert alert-info" style="margin: 2em 0;"><p>No results found. Try adjusting your search criteria.</p></div>';
    return;
  }

  const start = (page - 1) * perPage;
  const end = start + perPage;
  const pageResults = placeResults.slice(start, end);
  const totalPages = Math.ceil(placeResults.length / perPage);

  let html = `<div style="margin: 1em 0; padding: 1em; background-color: #f9f9f9; border-left: 4px solid #007bff;">
    <p style="margin: 0;"><strong>Found ${placeResults.length} result${placeResults.length !== 1 ? 's' : ''}</strong> (showing ${start + 1}-${Math.min(end, placeResults.length)})</p>`;

  if (totalPages > 1) {
    html += '<div style="margin-top: 0.5em;">';
    if (page > 1) html += `<button class="btn btn-sm btn-default" onclick="changePage(${page - 1});">&laquo; Previous</button>`;
    for (let i = 1; i <= totalPages; i++) {
      if (i === page) html += `<span class="btn btn-sm btn-default disabled">${i}</span>`;
      else html += `<button class="btn btn-sm btn-default" onclick="changePage(${i});">${i}</button>`;
    }
    if (page < totalPages) html += `<button class="btn btn-sm btn-default" onclick="changePage(${page + 1});">Next &raquo;</button>`;
    html += '</div>';
  }
  html += '</div>';

  html += pageResults.map(entry => {
    const titleText = entry.displayTitleEnglish || (Array.isArray(entry.title) ? entry.title[0] : entry.title) || 'Untitled';
    const placeNames = Array.isArray(entry.placeName) ? entry.placeName.join('; ') : (entry.placeName || '');
    const keywords = Array.isArray(entry.keyword) ? entry.keyword.join('; ') : (entry.keyword || '');
    const dynasty = Array.isArray(entry.dynasty) ? entry.dynasty.join('; ') : (entry.dynasty || '');
    const date = Array.isArray(entry.dateLabel) ? entry.dateLabel.join('; ') : (entry.dateLabel || '');

    return `
      <div style="margin-bottom: 1.5em; padding-bottom: 1em; border-bottom: 1px solid #ddd;">
        <h4 style="margin-top: 0; margin-bottom: 0.5em;">
          <a href="${entry.idno || '#'}" target="_blank">${escapeHtml(titleText)}</a>
        </h4>
        ${placeNames ? `<p style="margin: 0.25em 0;"><strong>Place Name:</strong> ${escapeHtml(placeNames)}</p>` : ''}
        ${keywords ? `<p style="margin: 0.25em 0;"><strong>Keywords:</strong> ${escapeHtml(keywords)}</p>` : ''}
        ${dynasty ? `<p style="margin: 0.25em 0;"><strong>Dynasty:</strong> ${escapeHtml(dynasty)}</p>` : ''}
        ${date ? `<p style="margin: 0.25em 0;"><strong>Date:</strong> ${escapeHtml(date)}</p>` : ''}
        <p style="margin: 0.25em 0; color: #666;"><small><strong>ID:</strong> ${escapeHtml(entry.id || 'N/A')}</small></p>
      </div>
    `;
  }).join('');

  resultsPanel.innerHTML = html;
}

function changePage(page) {
  currentPage = page;
  displayResults(page);
  const resultsEl = document.getElementById('search-results-panel');
  if (resultsEl) window.scrollTo(0, resultsEl.offsetTop - 100);
}

function executeSearch(e) {
  if (e) e.preventDefault();
  const spinner = document.getElementById('searchSpinner');
  if (spinner) spinner.style.display = 'inline';

  const params = {
    q: document.getElementById('qs') ? document.getElementById('qs').value.trim() : '',
    placeName: document.getElementById('placeName') ? document.getElementById('placeName').value.trim() : ''
  };

  const fieldMap = {
    q: 'all',
    placeName: 'placeName'
  };

  let combined = [];
  let hasInput = false;

  for (const [formField, recordField] of Object.entries(fieldMap)) {
    if (params[formField]) {
      hasInput = true;
      const results = performSearch(params[formField], recordField);
      if (combined.length === 0) combined = results;
      else combined = combined.filter(r => results.includes(r));
    }
  }

  if (hasInput) {
    placeResults = combined;
    currentPage = 1;
    displayResults(1);
  } else {
    if (spinner) spinner.style.display = 'none';
    const panel = document.getElementById('search-results-panel');
    if (panel) panel.innerHTML = '<div class="alert alert-info" style="margin: 2em 0;"><p>Please enter at least one search criterion.</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const searchForm = document.querySelector('form[action="search.html"]') || document.getElementById('research-tool');
  if (searchForm) searchForm.addEventListener('submit', executeSearch);
  else console.warn('Search form not found');
});
