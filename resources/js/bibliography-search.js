let searchData = [];
let allResults = [];
let currentPage = 1;
const perPage = 20;
let dataLoaded = false;
let currentSort = 'author'; // default sort key

function getSortLabel(key) {
  switch (key) {
    case 'title':
      return 'Title';
    case 'author':
      return 'Author';
    case 'date':
      return 'Publication date';
    case 'publicationPlace':
      return 'Publication place';
    default:
      return 'Author';
  }
}

// Load bibliography data on page load
fetch('/json/bibliography-combined.json')
  .then(response => response.json())
  .then(data => { 
    searchData = data;
    allResults = data; // Display all results initially
    dataLoaded = true;
    console.log(`Loaded ${data.length} bibliography records`);
    // If DOM is already ready, display results now; otherwise DOMContentLoaded handler will display them
    if (document.readyState !== 'loading') {
      sortRecords(currentSort);
      displayResults(1);
    }
  })
  .catch(error => {
    console.error('Error loading bibliography data:', error);
  });


/**
 * Perform a search across specified fields or all fields
 * @param {string} query - The search query
 * @param {string|array} fields - Field name(s) to search in; 'all' searches all fields
 * @returns {array} Array of matching records
 */
function performSearch(query, fields = 'all') {
  if (!query || query.length < 1) return [];
  const lowerQuery = query.toLowerCase();
  
  return searchData.filter(entry => {
    if (fields === 'all') {
      // Search all string and array fields
      return Object.values(entry).some(value => {
        if (typeof value === 'string') return value.toLowerCase().includes(lowerQuery);
        if (Array.isArray(value)) return value.some(v => 
          typeof v === 'string' && v.toLowerCase().includes(lowerQuery)
        );
        return false;
      });
    } else {
      // Search specific field(s)
      const fieldsArray = Array.isArray(fields) ? fields : [fields];
      return fieldsArray.some(field => {
        const fieldValue = entry[field];
        if (typeof fieldValue === 'string') return fieldValue.toLowerCase().includes(lowerQuery);
        if (Array.isArray(fieldValue)) return fieldValue.some(v => 
          typeof v === 'string' && v.toLowerCase().includes(lowerQuery)
        );
        return false;
      });
    }
  });
}

/**
 * Display search results with pagination
 * @param {number} page - Current page number
 */
function displayResults(page = 1) {
  const resultsPanel = document.getElementById('search-results-panel');
  if (!resultsPanel) return;
  
  // Hide spinner
  const spinner = document.getElementById('searchSpinner');
  if (spinner) spinner.style.display = 'none';
  
  const visibleResults = allResults.filter(hasDisplayTitle);

  if (visibleResults.length === 0) {
    resultsPanel.innerHTML = '<div class="alert alert-info" style="margin: 2em 0;"><p>No results found. Try adjusting your search criteria.</p></div>';
    return;
  }
  
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const pageResults = visibleResults.slice(start, end);
  const totalPages = Math.ceil(visibleResults.length / perPage);
  
  // Build result summary and pagination
  let html = `<div style="margin: 1em 0; padding: 1em; background-color: #f9f9f9; border-left: 4px solid #007bff;">
    <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:1em;">
      <p style="margin: 0;"><strong>Found ${visibleResults.length} result${visibleResults.length !== 1 ? 's' : ''}</strong> (showing ${start + 1}-${Math.min(end, visibleResults.length)})</p>
      <div class="dropdown" style="display:inline-block;">
        <button class="btn btn-default btn-sm dropdown-toggle" type="button" id="biblSortDropdown" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
          Sort: ${escapeHtml(getSortLabel(currentSort))} <span class="caret"></span>
        </button>
        <ul class="dropdown-menu dropdown-menu-right" aria-labelledby="biblSortDropdown">
          <li><a href="#" data-sort-key="title">Title</a></li>
          <li><a href="#" data-sort-key="author">Author</a></li>
          <li><a href="#" data-sort-key="date">Publication date</a></li>
          <li><a href="#" data-sort-key="publicationPlace">Publication place</a></li>
        </ul>
      </div>
    </div>`;
  
  // Pagination controls
  if (totalPages > 1) {
    html += '<div style="margin-top: 0.5em;">';
    if (page > 1) {
      html += `<button class="btn btn-sm btn-default" onclick="changePage(${page - 1});">&laquo; Previous</button>`;
    }
    for (let i = 1; i <= totalPages; i++) {
      if (i === page) {
        html += `<span class="btn btn-sm btn-default disabled">${i}</span>`;
      } else {
        html += `<button class="btn btn-sm btn-default" onclick="changePage(${i});">${i}</button>`;
      }
    }
    if (page < totalPages) {
      html += `<button class="btn btn-sm btn-default" onclick="changePage(${page + 1});">Next &raquo;</button>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // Build individual result cards (inside same container)
  html += '<div style="padding-top:0.75em;">';
  html += pageResults.map(entry => {
    const titleText = (entry.title && Array.isArray(entry.title) ? entry.title[0] : entry.title) || 'Untitled';
    const authors = Array.isArray(entry.author) ? entry.author.join('; ') : (entry.author || '');
    const editors = Array.isArray(entry.editor) ? entry.editor.join('; ') : (entry.editor || '');
    const pubInfo = [];
    if (entry.publicationPlace) {
      const places = Array.isArray(entry.publicationPlace) ? entry.publicationPlace[0] : entry.publicationPlace;
      pubInfo.push(places);
    }
    if (entry.publisher) {
      const pub = Array.isArray(entry.publisher) ? entry.publisher[0] : entry.publisher;
      pubInfo.push(pub);
    }
    if (entry.date) {
      const date = Array.isArray(entry.date) ? entry.date[0] : entry.date;
      pubInfo.push(date);
    }
    
    return `
      <div style="margin-bottom: 1.5em; padding-bottom: 1em; border-bottom: 1px solid #ddd;">
        <h4 style="margin-top: 0; margin-bottom: 0.5em;">
          <a href="${entry.idno || '#'}" target="_blank">${escapeHtml(titleText)}</a>
        </h4>
        ${authors ? `<p style="margin: 0.25em 0;"><strong>Author(s):</strong> ${escapeHtml(authors)}</p>` : ''}
        ${editors ? `<p style="margin: 0.25em 0;"><strong>Editor(s):</strong> ${escapeHtml(editors)}</p>` : ''}
        ${pubInfo.length > 0 ? `<p style="margin: 0.25em 0;"><strong>Publication:</strong> ${escapeHtml(pubInfo.join(': '))}</p>` : ''}
        <p style="margin: 0.25em 0; color: #666;"><small><strong>ID:</strong> ${escapeHtml(entry.id || 'N/A')}</small></p>
      </div>
    `;
  }).join('');
  html += '</div>';
  html += '</div>';

  resultsPanel.innerHTML = html;
  // wire up sort dropdown after rendering
  const sortMenu = resultsPanel.querySelectorAll('[data-sort-key]');
  sortMenu.forEach(item => {
    item.addEventListener('click', event => {
      event.preventDefault();
      currentSort = item.getAttribute('data-sort-key') || 'author';
      sortRecords(currentSort);
      currentPage = 1;
      displayResults(1);
    });
  });
}

/**
 * Change the current page and re-display results
 * @param {number} page - Page number to navigate to
 */
function changePage(page) {
  currentPage = page;
  displayResults(page);
  // Scroll to results
  const resultsEl = document.getElementById('search-results-panel');
  if (resultsEl) {
    window.scrollTo(0, resultsEl.offsetTop - 100);
  }
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function hasDisplayTitle(entry) {
  const title = entry && entry.title;
  if (Array.isArray(title)) {
    return title.some(item => String(item || '').trim().length > 0);
  }
  return String(title || '').trim().length > 0;
}

/**
 * Execute search based on form input values
 * Matches form field IDs from bibliography.html:
 * - id="qs" for keywords (name="q")
 * - id="title" for title
 * - id="author" for author
 * - id="pubPlace" for publication place
 * - id="publisher" for publisher
 * - id="date" for date
 * - id="idno" for id number
 */
function executeSearch(e) {
  if (e) e.preventDefault();
  
  // Show spinner
  const spinner = document.getElementById('searchSpinner');
  if (spinner) spinner.style.display = 'inline';
  
  // Get form field values - these match the IDs in bibliography.html
  const params = {
    q: document.getElementById('qs') ? document.getElementById('qs').value.trim() : '',
    title: document.getElementById('title') ? document.getElementById('title').value.trim() : '',
    author: document.getElementById('author') ? document.getElementById('author').value.trim() : '',
    pubPlace: document.getElementById('pubPlace') ? document.getElementById('pubPlace').value.trim() : '',
    publisher: document.getElementById('publisher') ? document.getElementById('publisher').value.trim() : '',
    date: document.getElementById('date') ? document.getElementById('date').value.trim() : '',
    idno: document.getElementById('idno') ? document.getElementById('idno').value.trim() : ''
  };
  
  // Map form fields to record fields
  const fieldMap = {
    q: 'all',
    title: 'title',
    author: 'author',
    pubPlace: 'publicationPlace',
    publisher: 'publisher',
    date: 'date',
    idno: 'id'
  };
  
  let combinedResults = [];
  let hasInput = false;
  
  // Perform searches for each field that has input
  for (const [formField, recordField] of Object.entries(fieldMap)) {
    if (params[formField]) {
      hasInput = true;
      const results = performSearch(params[formField], recordField);
      
      // AND logic: intersection of all searches
      if (combinedResults.length === 0) {
        combinedResults = results;
      } else {
        combinedResults = combinedResults.filter(r => results.includes(r));
      }
    }
  }
  
  if (hasInput) {
    allResults = combinedResults;
    // apply current sort to the filtered results
    sortRecords(currentSort);
    currentPage = 1;
    displayResults(1);
  } else {
    if (spinner) spinner.style.display = 'none';
    const panel = document.getElementById('search-results-panel');
    if (panel) {
      panel.innerHTML = '<div class="alert alert-info" style="margin: 2em 0;"><p>Please enter at least one search criterion.</p></div>';
    }
  }
}

/**
 * Initialize search form on page load
 */
document.addEventListener('DOMContentLoaded', function() {
  // Attach submit handler to the form
  const searchForm = document.querySelector('form[action="bibliography.html"]');
  if (searchForm) {
    searchForm.addEventListener('submit', executeSearch);
    // Handle form reset to show all results
    searchForm.addEventListener('reset', function() {
      window.setTimeout(() => {
        allResults = searchData;
        currentPage = 1;
        // reapply sort when reset
        sortRecords(currentSort);
        displayResults(1);
      }, 0);
    });
    // If data already loaded, render initial results now
    if (dataLoaded) {
      sortRecords(currentSort);
      displayResults(1);
    }
  } else {
    console.warn('Bibliography search form not found');
  }
});

/**
 * Return a string value for sorting based on key
 */
function getSortValue(entry, key) {
  if (!entry) return '';
  switch (key) {
    case 'title':
      return (Array.isArray(entry.title) ? entry.title[0] : (entry.title || '')) || '';
    case 'author':
      return (Array.isArray(entry.author) ? entry.author[0] : (entry.author || '')) || '';
    case 'date':
      return (Array.isArray(entry.date) ? entry.date[0] : (entry.date || '')) || '';
    case 'publicationPlace':
      return (Array.isArray(entry.publicationPlace) ? entry.publicationPlace[0] : (entry.publicationPlace || '')) || '';
    default:
      return '';
  }
}

/**
 * Sort the `allResults` array in-place by the given key.
 */
function sortRecords(key) {
  if (!key) return;
  allResults.sort((a, b) => {
    const va = String(getSortValue(a, key) || '').toLowerCase();
    const vb = String(getSortValue(b, key) || '').toLowerCase();
    return va.localeCompare(vb, 'en', { sensitivity: 'base' });
  });
}
