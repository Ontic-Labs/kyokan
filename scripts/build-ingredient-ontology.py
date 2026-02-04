"""
Convert synonyms-1.json and synonyms-2.json into a unified ingredient ontology.

Usage:
    python scripts/build-ingredient-ontology.py

Reads:
    data/synonyms-1.json  (134 entries: normalized_name, canonical_name, synonyms[], fdc_id)
    data/synonyms-2.json  (700+ entries: slug, display_name, synonym_array[], fdc_id)

Writes:
    data/ingredient-ontology.json
"""

import json
import re
from pathlib import Path
from typing import List, Dict, Any, Optional, Set

ROOT = Path(__file__).resolve().parent.parent
S1_PATH = ROOT / "data" / "synonyms-1.json"
S2_PATH = ROOT / "data" / "synonyms-2.json"
OUTPUT_PATH = ROOT / "data" / "ingredient-ontology.json"

# ── Modifier word sets ──────────────────────────────────────────────────────

COLOR_WORDS = {"red", "green", "yellow", "orange", "purple", "white", "black", "brown", "golden"}
FORM_WORDS = {"raw", "cooked", "dried", "ground", "fresh", "frozen", "canned", "whole", "powdered"}
PREP_WORDS = {
    "chopped", "diced", "minced", "sliced", "shredded", "peeled", "seeded",
    "grated", "crushed", "roasted", "toasted", "smoked", "blanched", "sauteed",
    "melted", "softened", "julienned", "cubed", "mashed", "pureed",
}
SIZE_WORDS = {"small", "medium", "large", "thin", "thick", "baby", "mini"}


def slugify(text: str) -> str:
    """Convert display name to slug."""
    s = text.lower().strip()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def derive_tokens(surface_forms: List[str]) -> List[str]:
    """Extract unique tokens from all surface forms."""
    token_set: Set[str] = set()
    for form in surface_forms:
        for t in form.lower().split():
            cleaned = re.sub(r"[^a-z0-9]", "", t)
            if cleaned and len(cleaned) >= 2:
                token_set.add(cleaned)
    return sorted(token_set)


def derive_modifiers(tokens: List[str]) -> Dict[str, List[str]]:
    return {
        "color": [t for t in tokens if t in COLOR_WORDS],
        "form": [t for t in tokens if t in FORM_WORDS],
        "prep": [t for t in tokens if t in PREP_WORDS],
        "size": [t for t in tokens if t in SIZE_WORDS],
        "origin": [],
    }


def slug_to_equivalence_class(slug: str) -> str:
    """Strip prep/state/color suffixes to get base equivalence class."""
    suffixes = [
        "-raw", "-cooked", "-frozen", "-canned", "-peeled", "-seeded",
        "-boneless", "-skinless", "-dried", "-ground", "-fresh", "-smoked",
        "-roasted", "-toasted", "-whole", "-sliced", "-diced", "-minced",
        "-chopped", "-shredded", "-crushed",
    ]
    base = slug
    for suf in suffixes:
        if base.endswith(suf):
            base = base[: -len(suf)]
    return base


def dedup_ordered(items: List[str]) -> List[str]:
    """Deduplicate list preserving order, case-insensitive."""
    seen: Set[str] = set()
    result = []
    for item in items:
        key = item.lower().strip()
        if key and key not in seen:
            seen.add(key)
            result.append(item.strip())
    return result


def normalize_fdc_id(val: Any) -> Optional[int]:
    if val is None:
        return None
    if isinstance(val, int):
        return val if val > 0 else None
    if isinstance(val, str):
        try:
            n = int(val)
            return n if n > 0 else None
        except ValueError:
            return None
    return None


def load_s1() -> Dict[str, Dict[str, Any]]:
    """Load synonyms-1.json, keyed by slug."""
    raw = json.loads(S1_PATH.read_text("utf-8"))
    entries = {}
    for item in raw:
        name = item["normalized_name"]
        slug = slugify(name)
        display = item.get("canonical_name", name)
        synonyms = item.get("synonyms", [])
        fdc_id = normalize_fdc_id(item.get("fdc_id"))

        # Build surface forms: display name + normalized name + synonyms
        surface_forms = dedup_ordered([display, name] + synonyms)

        entries[slug] = {
            "slug": slug,
            "displayName": display,
            "surfaceForms": surface_forms,
            "fdcId": fdc_id,
        }
    return entries


def load_s2() -> Dict[str, Dict[str, Any]]:
    """Load synonyms-2.json, keyed by slug."""
    raw = json.loads(S2_PATH.read_text("utf-8"))
    entries = {}
    for item in raw:
        slug = item["slug"]
        display = item["display_name"]
        synonyms = item.get("synonym_array", [])
        fdc_id = normalize_fdc_id(item.get("fdc_id"))

        surface_forms = dedup_ordered([display] + synonyms)

        entries[slug] = {
            "slug": slug,
            "displayName": display,
            "surfaceForms": surface_forms,
            "fdcId": fdc_id,
        }
    return entries


def merge_entries(s1: Dict, s2: Dict) -> List[Dict[str, Any]]:
    """
    Merge s1 and s2. When both have the same slug, combine surface forms
    and prefer s2's fdc_id (larger dataset, more curated).
    """
    all_slugs = sorted(set(list(s1.keys()) + list(s2.keys())))
    merged = []

    for slug in all_slugs:
        e1 = s1.get(slug)
        e2 = s2.get(slug)

        if e1 and e2:
            # Merge: combine surface forms, prefer s2 fdc_id, use s2 display name
            display = e2["displayName"]
            fdc_id = e2["fdcId"] or e1["fdcId"]
            surface_forms = dedup_ordered(e2["surfaceForms"] + e1["surfaceForms"])
        elif e2:
            display = e2["displayName"]
            fdc_id = e2["fdcId"]
            surface_forms = e2["surfaceForms"]
        else:
            display = e1["displayName"]
            fdc_id = e1["fdcId"]
            surface_forms = e1["surfaceForms"]

        merged.append({
            "slug": slug,
            "displayName": display,
            "surfaceForms": surface_forms,
            "fdcId": fdc_id,
        })

    return merged


def enrich_entry(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Add tokens, modifiers, equivalence class, and stub fields."""
    tokens = derive_tokens(raw["surfaceForms"])
    modifiers = derive_modifiers(tokens)
    equivalence_class = slug_to_equivalence_class(raw["slug"])

    return {
        "slug": raw["slug"],
        "displayName": raw["displayName"],
        "surfaceForms": raw["surfaceForms"],
        "tokens": tokens,
        "modifiers": modifiers,
        "aliases": {},
        "fdc": {
            "fdcId": raw["fdcId"],
            "dataType": None,
            "description": None,
        },
        "equivalenceClass": equivalence_class,
        "taxonomy": {
            "group": None,
            "family": None,
            "genus": None,
            "species": None,
        },
        "substitutions": [],
    }


def main():
    print("Loading synonyms-1.json...")
    s1 = load_s1()
    print(f"  {len(s1)} entries")

    print("Loading synonyms-2.json...")
    s2 = load_s2()
    print(f"  {len(s2)} entries")

    print("Merging...")
    merged = merge_entries(s1, s2)
    print(f"  {len(merged)} unique slugs")

    # Count overlaps
    overlap = len(set(s1.keys()) & set(s2.keys()))
    print(f"  {overlap} overlapping slugs merged")

    print("Enriching entries...")
    ontology = [enrich_entry(e) for e in merged]

    # Stats
    with_fdc = sum(1 for e in ontology if e["fdc"]["fdcId"])
    total_surface = sum(len(e["surfaceForms"]) for e in ontology)
    print(f"  {with_fdc}/{len(ontology)} have fdc_id")
    print(f"  {total_surface} total surface forms")

    print(f"Writing {OUTPUT_PATH}...")
    OUTPUT_PATH.write_text(
        json.dumps(ontology, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("Done.")


if __name__ == "__main__":
    main()
