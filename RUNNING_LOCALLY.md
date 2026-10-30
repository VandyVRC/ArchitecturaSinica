# Running Architectura Sinica locally

The site is static HTML, CSS, JavaScript and JSON. It is hosted on S3 behind CloudFront and has no server-side code, so any static file server will work.

## Requirements

- Python 3 (any recent version) to serve the site
- A web browser
- Internet access for the map tiles (OpenStreetMap), Google Fonts and the Plausible analytics script. The pages still work without it, but the map will be blank.

To regenerate the JSON data (optional, see below) you also need Python 3.10 or newer and the TEI source repository checked out as `../tcadrt` next to this project.

## Start the site

Run the server from the project root, the folder that contains `index.html`, `search.html` and `research-tool.html`:

```bash
cd /path/to/ArchitecturaSinica
python3 -m http.server 8000
```

Then open:

- Home: http://localhost:8000/
- Search: http://localhost:8000/search.html
- Research tool: http://localhost:8000/research-tool.html
- Terminology: http://localhost:8000/terminology.html
- Bibliography: http://localhost:8000/bibliography.html

Stop the server with `Ctrl+C`.

### Why it must be served from the project root

- The pages use root-relative paths such as `/resources/js/search.js` and `/json/places-combined.json`. The server root has to be the project root, or these files will return 404.
- The navbar is loaded at runtime from `/resources/components/navbar.html` with an AJAX request, and the search scripts fetch JSON. Browsers block both when a page is opened with `file://`, so double-clicking an HTML file will not work.

## Try the search

- Type a keyword in the navbar and press Enter. You should land on `search.html` with the Keyword field filled and results already shown.
- You can also open a URL directly: `http://localhost:8000/search.html?fullText=pagoda`. The page also accepts `?q=` and `?placeName=`.
- The Keyword box searches places, bibliography and terminology. The Place Name box searches site and building titles only.

## Where the data comes from

| File | Used by |
| --- | --- |
| `json/places-combined.json` | `search.html`, `research-tool.html` |
| `json/bibliography-combined.json` | `search.html`, `bibliography.html` |
| `json/terminology-combined.json` | `search.html`, `terminology.html`, and pinyin labels in the facets |

Page scripts live in `resources/js/`:

- `search.js` drives `search.html`
- `research-tool-search.js` drives `research-tool.html`
- `bibliography-search.js` and `terminology-search.js` drive their pages
- `navbar-search.js` loads the navbar and handles the navbar search box

## Regenerating the JSON (optional)

The JSON files are generated from the TEI XML in the `tcadrt` repository. Run these from the project root:

```bash
python3 tei2Json.py ../tcadrt/data/places --combined json/places-combined.json --pretty
python3 tei2Json.py ../tcadrt/data/keywords/tei --combined json/terminology-combined.json --pretty
python3 tei2Json.py ../tcadrt/data/bibl/tei --combined json/bibliography-combined.json --pretty
```

`lxml` is optional. If it is installed, the script can recover from some malformed XML files.

Reload the page after regenerating. The browser may cache the old JSON, so do a hard refresh.

## Troubleshooting

- **Blank page or 404 for scripts and JSON.** The server was not started from the project root. Stop it and restart it there.
- **Old behavior after an edit.** Hard refresh (`Cmd+Shift+R` on macOS, `Ctrl+Shift+R` elsewhere) or open DevTools and tick "Disable cache" on the Network tab.
- **Port already in use.** Pick another port, for example `python3 -m http.server 8001`.
- **Server stops responding.** Python's built-in server can hang after a long session. Stop it and start a new one, ideally on a different port.
- **Navbar missing.** Open the browser console. The most common cause is the page being opened with `file://` instead of through the server.
- **Map shows no tiles.** The tiles load from OpenStreetMap, so check your internet connection.
- **No results on search.** Check the Network tab to confirm the three JSON files return 200.

## Deployment

Deployment runs from GitHub Actions in `.github/workflows/` (`codeToAWS.yml` and `dataToAWS.yml`). This document covers local preview only. Anything you want live must be committed and pushed so those workflows can publish it.
