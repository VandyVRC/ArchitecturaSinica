#!/usr/bin/env python3
"""
tei2Json.py - Extract searchable JSON from Architectura Sinica TEI XML.

Designed for TEI records in:
  ArchitecturaSinica/tcadrt/data/**/tei/*.xml

Usage examples:
  python3 tei2Json.py ../tcadrt/data/places/buildings/tei/000152.xml
  python3 tei2Json.py ../tcadrt/data --combined json/combined.json --pretty
  python3 tei2Json.py ../tcadrt/data -o json
  python3 tei2Json.py ../tcadrt/data/places --combined json/combined.json --pretty
  python3 tei2Json.py ../tcadrt/data/keywords/tei --combined json/terminology-combined.json --pretty
  python3 tei2Json.py ../tcadrt/data/bibl/tei --combined json/bibliography-combined.json --pretty
"""

import argparse
import json
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

try:
    from lxml import etree as LET
except ImportError:
    LET = None

NS = {
    "tei": "http://www.tei-c.org/ns/1.0",
    "xml": "http://www.w3.org/XML/1998/namespace",
}


def strip_xml_comment_markers(xml_text: str) -> str:
    """Drop XML comment markers; useful for malformed nested comment cases."""
    return xml_text.replace("<!--", "").replace("-->", "")


def clean_text(value: str) -> str:
    return " ".join((value or "").split())


def text_content(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return clean_text("".join(element.itertext()))


def unique_keep_order(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def first_nonempty(values: list[str]) -> str:
    for v in values:
        if v:
            return v
    return ""


def contains_cjk(value: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", value or ""))


def language_texts(root: ET.Element, xpath: str, lang: str) -> list[str]:
    values = []
    for el in root.findall(xpath, NS):
        if clean_text(el.get("{http://www.w3.org/XML/1998/namespace}lang", "")) == lang:
            txt = text_content(el)
            if txt:
                values.append(txt)
    return unique_keep_order(values)


def cjk_name_texts(root: ET.Element, xpath: str) -> list[str]:
    values = []
    for el in root.findall(xpath, NS):
        txt = text_content(el)
        if txt and contains_cjk(txt):
            values.append(txt)
    return unique_keep_order(values)


def parse_geo_pair(geo_text: str) -> dict | None:
    parts = clean_text(geo_text).split()
    if len(parts) < 2:
        return None
    try:
        lat = float(parts[0])
        lon = float(parts[1])
    except ValueError:
        return None
    return {"lat": lat, "lon": lon}


def extract_id_from_uri(uri: str) -> str:
    match = re.search(r"/place/([^/]+)", uri)
    return match.group(1) if match else ""


def normalize_keyword_uri(uri: str) -> str:
    value = clean_text(uri).strip()
    if not value:
        return ""
    value = value.replace("/Keyword/", "/keyword/")
    value = value.replace("/keyword/", "/keyword/")
    value = value.rstrip("/")
    if value.endswith("/tei"):
        value = value[:-4]
    return value


def choose_keyword_label(entry: ET.Element) -> str:
    terms = entry.findall("tei:term", NS)
    if not terms:
        return ""

    for lang in ("en", "zh-latn-pinyin", "zh-Hant", "zh-Hans"):
        for term in terms:
            if clean_text(term.get("{http://www.w3.org/XML/1998/namespace}lang", "")) == lang:
                txt = text_content(term)
                if txt:
                    return txt

    for term in terms:
        txt = text_content(term)
        if txt:
            return txt
    return ""


def build_keyword_lookup(input_path: Path) -> dict[str, str]:
    lookup: dict[str, str] = {}

    # Works for inputs like .../tcadrt/data/places or .../tcadrt/data/places/buildings/tei/0001.xml
    data_root = None
    for candidate in [input_path, *input_path.parents]:
        if candidate.name == "data":
            data_root = candidate
            break
    if data_root is None:
        return lookup

    keywords_dir = data_root / "keywords" / "tei"
    if not keywords_dir.exists():
        return lookup

    for file in sorted(keywords_dir.glob("*.xml")):
        try:
            tree = ET.parse(file)
        except ET.ParseError:
            continue
        root = tree.getroot()
        entry = root.find(".//tei:entryFree", NS)
        if entry is None:
            continue

        idno = text_content(entry.find("tei:idno[@type='URI']", NS))
        if not idno:
            continue

        key = normalize_keyword_uri(idno)
        label = choose_keyword_label(entry)
        if key and label:
            lookup[key] = label

    return lookup


def relation_keyword_labels(relations: list[dict], keyword_lookup: dict[str, str], ana_filter: str | None = None) -> list[str]:
    labels: list[str] = []
    for rel in relations:
        ana = clean_text(rel.get("ana", ""))
        if ana_filter and ana != ana_filter:
            continue

        passive = normalize_keyword_uri(rel.get("passive", ""))
        if "/keyword/" not in passive:
            continue

        label = keyword_lookup.get(passive)
        if label:
            labels.append(label)
        else:
            labels.append(passive.rsplit("/", 1)[-1])

    return unique_keep_order(labels)


def keyword_terms(entry: ET.Element) -> list[str]:
    values = []
    for term in entry.findall("tei:term", NS):
        txt = text_content(term)
        if txt:
            values.append(txt)
    return unique_keep_order(values)


def person_name(person_el: ET.Element) -> str:
    forenames = [text_content(e) for e in person_el.findall("tei:forename", NS) if text_content(e)]
    surnames = [text_content(e) for e in person_el.findall("tei:surname", NS) if text_content(e)]
    joined = clean_text(" ".join(forenames + surnames))
    return joined or text_content(person_el)


def normalize_bibl_value(value: str) -> str:
    """Normalize bibliography facet values for consistent frontend filtering."""
    value = value.strip()
    # Remove common trailing punctuation from author/editor names and publication info
    value = value.rstrip(",;:")
    return value


def normalize_bibl_facet(values: list[str]) -> list[str]:
    """Apply normalization and deduplication to bibliography facet values."""
    normalized = []
    seen_lower = set()
    for v in values:
        normalized_v = normalize_bibl_value(v)
        if normalized_v and normalized_v.lower() not in seen_lower:
            normalized.append(normalized_v)
            seen_lower.add(normalized_v.lower())
    return normalized


def bibliography_to_json(filepath: Path, root_input: Path | None = None) -> dict | None:
    try:
        tree = ET.parse(filepath)
    except ET.ParseError:
        try:
            xml_text = filepath.read_text(encoding="utf-8", errors="ignore")
            xml_text = strip_xml_comment_markers(xml_text)
            root_el = ET.fromstring(xml_text)
            tree = ET.ElementTree(root_el)
        except ET.ParseError:
            return None

    root = tree.getroot()
    body = root.find("tei:text/tei:body", NS)
    if body is None:
        return None

    bibl_struct = body.find("tei:biblStruct", NS)
    if bibl_struct is None:
        return None

    idno = ""
    for id_el in bibl_struct.findall(".//tei:idno[@type='URI']", NS):
        value = text_content(id_el)
        if "architecturasinica.org/bibl/" in value and not value.endswith("/tei"):
            idno = value
            break
    if not idno:
        idno = text_content(root.find("tei:teiHeader//tei:publicationStmt/tei:idno[@type='URI']", NS)).replace("/tei", "")

    bid = idno.rstrip("/").rsplit("/", 1)[-1] if idno else filepath.stem

    titles = [
        text_content(el)
        for el in bibl_struct.findall(".//tei:title", NS)
        if text_content(el)
    ]

    authors = []
    for el in bibl_struct.findall(".//tei:author", NS):
        name = person_name(el)
        if name:
            authors.append(name)

    editors = []
    for el in bibl_struct.findall(".//tei:editor", NS):
        name = person_name(el)
        if name:
            editors.append(name)

    pub_places = [
        text_content(el)
        for el in bibl_struct.findall(".//tei:imprint/tei:pubPlace", NS)
        if text_content(el)
    ]

    publishers = [
        text_content(el)
        for el in bibl_struct.findall(".//tei:imprint/tei:publisher", NS)
        if text_content(el)
    ]

    dates = [
        text_content(el)
        for el in bibl_struct.findall(".//tei:imprint/tei:date", NS)
        if text_content(el)
    ]

    relation_keywords = []
    for rel in body.findall(".//tei:listRelation/tei:relation", NS):
        mutual = clean_text(rel.get("mutual", ""))
        if mutual:
            relation_keywords.extend(mutual.split())

    # Normalize all facet values for consistency
    titles = normalize_bibl_facet(titles)
    authors = normalize_bibl_facet(authors)
    editors = normalize_bibl_facet(editors)
    pub_places = normalize_bibl_facet(pub_places)
    publishers = normalize_bibl_facet(publishers)
    dates = normalize_bibl_facet(dates)

    # "keyword" is the generic catch-all facet used by bibliography search.
    keywords = unique_keep_order(titles + authors + editors + pub_places + publishers + dates + relation_keywords)
    keywords = normalize_bibl_facet(keywords)

    full_text = text_content(body)

    record = {
        "id": bid,
        "idno": idno,
        "keyword": keywords,
        "author": authors,
        "title": titles,
        "editor": editors,
        "publicationPlace": pub_places,
        "publisher": publishers,
        "date": dates,
        "fullText": full_text,
    }

    if root_input is not None:
        try:
            record["sourceFile"] = str(filepath.relative_to(root_input))
        except ValueError:
            record["sourceFile"] = str(filepath)

    return {k: v for k, v in record.items() if v not in ("", [], {})}


def terminology_to_json(filepath: Path, root_input: Path | None = None) -> dict | None:
    try:
        tree = ET.parse(filepath)
    except ET.ParseError:
        try:
            xml_text = filepath.read_text(encoding="utf-8", errors="ignore")
            xml_text = strip_xml_comment_markers(xml_text)
            root_el = ET.fromstring(xml_text)
            tree = ET.ElementTree(root_el)
        except ET.ParseError:
            return None

    root = tree.getroot()
    body = root.find("tei:text/tei:body", NS)
    if body is None:
        return None

    entry = body.find("tei:entryFree", NS)
    if entry is None:
        return None

    raw_type = clean_text(entry.get("type", "")).lower()
    terms = keyword_terms(entry)
    display = first_nonempty([
        text_content(t) for t in entry.findall("tei:term[@xml:lang='en']", NS)
    ] + terms)

    idno = text_content(entry.find("tei:idno[@type='URI']", NS))
    kid = idno.rsplit("/", 1)[-1] if idno else filepath.stem

    # facet fields for terminology page
    architectural_feature = []
    time_period = []
    bridge_or_road = []
    building_type = []
    site_type = []

    if raw_type == "architectural feature":
        architectural_feature = [display] if display else []
    elif raw_type == "time period":
        time_period = [display] if display else []
    elif raw_type in ("roads and bridges", "bridge or road"):
        bridge_or_road = [display] if display else []
    elif raw_type == "building type":
        building_type = [display] if display else []
    elif raw_type == "site type":
        site_type = [display] if display else []

    related_terms = []
    for term in entry.findall(".//tei:term[@ref]", NS):
        ref = clean_text(term.get("ref", ""))
        txt = text_content(term)
        if ref or txt:
            item = {"ref": ref, "term": txt}
            related_terms.append({k: v for k, v in item.items() if v})

    full_text = text_content(body)

    record = {
        "id": kid,
        "idno": idno,
        "displayTitleEnglish": display,
        "keyword": terms,
        "type": raw_type,
        "architecturalFeature": architectural_feature,
        "timePeriod": time_period,
        "bridgeOrRoad": bridge_or_road,
        "buildingType": building_type,
        "siteType": site_type,
        "relatedTerms": related_terms,
        "fullText": full_text,
    }

    if root_input is not None:
        try:
            record["sourceFile"] = str(filepath.relative_to(root_input))
        except ValueError:
            record["sourceFile"] = str(filepath)

    return {k: v for k, v in record.items() if v not in ("", [], {})}


def tei_to_json(
    filepath: Path,
    root_input: Path | None = None,
    keyword_lookup: dict[str, str] | None = None,
) -> dict | None:
    try:
        tree = ET.parse(filepath)
    except ET.ParseError:
        try:
            xml_text = filepath.read_text(encoding="utf-8", errors="ignore")
            xml_text = strip_xml_comment_markers(xml_text)
            root_el = ET.fromstring(xml_text)
            tree = ET.ElementTree(root_el)
        except ET.ParseError:
            if LET is None:
                return None
            try:
                tree = LET.parse(str(filepath), parser=LET.XMLParser(recover=True))
            except LET.XMLSyntaxError:
                return None

    root = tree.getroot()
    header = root.find("tei:teiHeader", NS)
    body = root.find("tei:text/tei:body", NS)
    if header is None or body is None:
        return None

    place = body.find(".//tei:listPlace/tei:place", NS)
    if place is None:
        return None

    title_stmt = header.find(".//tei:titleStmt", NS)
    pub_stmt = header.find(".//tei:publicationStmt", NS)

    # Names and titles
    place_names = [
        text_content(el)
        for el in place.findall("tei:placeName", NS)
        if text_content(el)
    ]
    english_names = [
        text_content(el)
        for el in place.findall("tei:placeName[@xml:lang='en']", NS)
        if text_content(el)
    ]
    alternate_names = [
        text_content(el)
        for el in place.findall("tei:placeName[@type='alternate']", NS)
        if text_content(el)
    ]

    header_titles = []
    if title_stmt is not None:
        for title in title_stmt.findall("tei:title", NS):
            txt = text_content(title)
            if txt:
                header_titles.append(txt)

    title_traditional_candidates = []
    if title_stmt is not None:
        title_traditional_candidates.extend(language_texts(title_stmt, ".//tei:foreign", "zh-Hant"))
        title_traditional_candidates.extend(language_texts(title_stmt, "tei:title", "zh-Hant"))
    title_traditional_candidates.extend(language_texts(place, "tei:placeName", "zh-Hant"))
    title_traditional = first_nonempty(title_traditional_candidates)

    author_traditional = unique_keep_order(
        cjk_name_texts(title_stmt, "tei:editor")
        + cjk_name_texts(title_stmt, "tei:principal")
        + cjk_name_texts(title_stmt, ".//tei:respStmt//tei:name")
    ) if title_stmt is not None else []

    traditional_chinese_text = unique_keep_order(
        language_texts(place, ".//tei:desc", "zh-Hant")
        + language_texts(place, ".//tei:note", "zh-Hant")
    )

    display_title_english = first_nonempty(english_names + header_titles + place_names)

    # URI / id
    idno = ""
    idno_el = place.find("tei:idno[@type='URI']", NS)
    if idno_el is not None and clean_text(idno_el.text or ""):
        idno = clean_text(idno_el.text or "")
    elif pub_stmt is not None:
        pub_id = pub_stmt.find("tei:idno[@type='URI']", NS)
        if pub_id is not None:
            idno = clean_text(pub_id.text or "")

    # Type and descriptive fields
    place_type = clean_text(place.get("type", ""))
    descriptions = [
        text_content(el)
        for el in place.findall("tei:desc[@type='building-data']", NS)
        if text_content(el)
    ]

    trait_types = [
        text_content(el)
        for el in place.findall("tei:trait[@type='type']/tei:desc", NS)
        if text_content(el)
    ]

    dynasties = []
    date_labels = []
    for state in place.findall("tei:state[@type='existence']", NS):
        subtype = clean_text(state.get("subtype", ""))
        desc_el = state.find("tei:desc", NS)
        desc_text = text_content(desc_el)
        if not desc_text:
            continue
        if subtype == "dynasty":
            dynasties.append(desc_text)
        else:
            date_labels.append(desc_text)

    state_ranges = []
    for state in place.findall("tei:state[@type='existence']", NS):
        from_value = clean_text(state.get("from", ""))
        to_value = clean_text(state.get("to", ""))
        if from_value or to_value:
            state_ranges.append({"from": from_value, "to": to_value})

    # Location and geo
    nested_locations = [
        text_content(el)
        for el in place.findall("tei:location[@type='nested']//tei:placeName", NS)
        if text_content(el)
    ]

    gps_points = []
    for geo in place.findall("tei:location[@type='gps']/tei:geo", NS):
        parsed = parse_geo_pair(text_content(geo))
        if parsed:
            gps_points.append(parsed)

    # Relations
    relations = []
    for rel in body.findall(".//tei:listRelation/tei:relation", NS):
        rel_obj = {
            "ref": clean_text(rel.get("ref", "")),
            "ana": clean_text(rel.get("ana", "")),
            "active": clean_text(rel.get("active", "")),
            "passive": clean_text(rel.get("passive", "")),
        }
        rel_obj = {k: v for k, v in rel_obj.items() if v}
        if rel_obj:
            relations.append(rel_obj)

    keyword_lookup = keyword_lookup or {}
    relation_keywords = relation_keyword_labels(relations, keyword_lookup)
    relation_dynasties = relation_keyword_labels(relations, keyword_lookup, ana_filter="dynasty")
    relation_arch_features = relation_keyword_labels(relations, keyword_lookup, ana_filter="architectural-feature")

    province_names = [
        text_content(el)
        for el in place.findall("tei:location[@type='nested']/tei:region[@type='province']/tei:placeName", NS)
        if text_content(el)
    ]

    # Contributors
    editors = []
    if title_stmt is not None:
        for editor in title_stmt.findall("tei:editor", NS):
            name = text_content(editor)
            if not name:
                continue
            role = clean_text(editor.get("role", ""))
            editors.append({"name": name, "role": role} if role else {"name": name})

    principal = text_content(title_stmt.find("tei:principal", NS)) if title_stmt is not None else ""

    full_text = text_content(body)

    record: dict = {
        "id": extract_id_from_uri(idno) if idno else filepath.stem,
        "idno": idno,
        "title": unique_keep_order(header_titles or place_names),
        "displayTitleEnglish": display_title_english,
        "titleTraditional": title_traditional,
        "authorTraditional": author_traditional,
        "traditionalChineseText": traditional_chinese_text,
        "type": place_type,
        "placeName": unique_keep_order(place_names),
        "keyword": relation_keywords,
        "architecturalFeature": relation_arch_features,
        "province": unique_keep_order(province_names),
        "alternateNames": unique_keep_order(alternate_names),
        "nestedLocation": unique_keep_order(nested_locations),
        "description": unique_keep_order(descriptions),
        "traitType": unique_keep_order(trait_types),
        "dynasty": unique_keep_order(dynasties + relation_dynasties),
        "dateLabel": unique_keep_order(date_labels),
        "dateRange": state_ranges,
        "gps": gps_points,
        "relations": relations,
        "principal": principal,
        "editor": editors,
        "fullText": full_text,
    }

    if root_input is not None:
        try:
            record["sourceFile"] = str(filepath.relative_to(root_input))
        except ValueError:
            record["sourceFile"] = str(filepath)

    return {k: v for k, v in record.items() if v not in ("", [], {})}


def detect_dataset_kind(sample_file: Path) -> str:
    path = str(sample_file).lower()
    if "/keywords/" in path:
        return "keywords"
    if "/bibl/" in path:
        return "bibl"
    return "places"


def gather_xml_files(path: Path) -> list[Path]:
    if path.is_file() and path.suffix.lower() == ".xml":
        return [path]
    if path.is_dir():
        return sorted(p for p in path.rglob("*.xml") if p.is_file())
    return []


def write_json(path: Path, payload, pretty: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2 if pretty else None)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract JSON records from Architectura Sinica TEI XML"
    )
    parser.add_argument("input", help="TEI XML file or directory")
    parser.add_argument(
        "-o",
        "--output",
        help="Output file (single input) or output directory (directory input)",
    )
    parser.add_argument(
        "--combined",
        help="Write all extracted records into one JSON array file",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    args = parser.parse_args()

    input_path = Path(args.input)
    files = gather_xml_files(input_path)
    if not files:
        print(f"Error: no XML files found at {input_path}", file=sys.stderr)
        sys.exit(1)

    root_input = input_path if input_path.is_dir() else input_path.parent
    keyword_lookup = build_keyword_lookup(input_path)
    dataset_kind = detect_dataset_kind(files[0])

    records: list[dict] = []
    for f in files:
        if dataset_kind == "keywords":
            rec = terminology_to_json(f, root_input=root_input)
        elif dataset_kind == "bibl":
            rec = bibliography_to_json(f, root_input=root_input)
        else:
            rec = tei_to_json(f, root_input=root_input, keyword_lookup=keyword_lookup)
        if rec is None:
            print(f"Skipping {f}: invalid or unsupported TEI", file=sys.stderr)
            continue
        records.append(rec)

    if not records:
        print("Error: no records were extracted", file=sys.stderr)
        sys.exit(1)

    if input_path.is_file():
        single_record = records[0]
        if args.output:
            write_json(Path(args.output), single_record, args.pretty)
        else:
            print(json.dumps(single_record, ensure_ascii=False, indent=2 if args.pretty else None))
        return

    # Directory mode
    if args.output and not args.combined:
        outdir = Path(args.output)
        outdir.mkdir(parents=True, exist_ok=True)
        for rec in records:
            source = rec.get("sourceFile", "")
            stem = Path(source).stem if source else rec.get("id", "record")
            write_json(outdir / f"{stem}.json", rec, args.pretty)
        print(f"Wrote {len(records)} records to {outdir}")

    if args.combined:
        write_json(Path(args.combined), records, args.pretty)
        print(f"Wrote combined JSON with {len(records)} records to {args.combined}")

    if not args.output and not args.combined:
        print(json.dumps(records, ensure_ascii=False, indent=2 if args.pretty else None))


if __name__ == "__main__":
    main()
