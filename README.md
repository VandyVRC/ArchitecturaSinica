# ArchitecturaSinica
New application repository. Based off of the Gaddel app architecture. 

## Data Extraction

Generate the place search JSON, terminology search JSON, and bibliography search JSON with:

```bash
python3 tei2Json.py ../tcadrt/data/places --combined json/combined.json --pretty
python3 tei2Json.py ../tcadrt/data/keywords/tei --combined json/terminology-combined.json --pretty
python3 tei2Json.py ../tcadrt/data/bibl/tei --combined json/bibliography-combined.json --pretty
```
