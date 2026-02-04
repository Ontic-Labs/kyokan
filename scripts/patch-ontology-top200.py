"""
Patch ingredient-ontology.json with missing top-200 recipe ingredients.

Some are new entries, others are surface form additions to existing entries.

Usage:
    python scripts/patch-ontology-top200.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ONTOLOGY_PATH = ROOT / "data" / "ingredient-ontology.json"

# ── Surface form additions to EXISTING entries ──────────────────────────────
# Maps: existing slug -> list of new surface forms to add
SURFACE_FORM_PATCHES = {
    "garlic-cloves": ["garlic clove"],
    "green-bell-pepper": ["green pepper", "green peppers"],
    "chicken-breasts": [
        "boneless skinless chicken breasts",
        "boneless skinless chicken breast halves",
        "chicken breast halves",
        "cooked chicken",
    ],
    "thyme-dried": ["dried thyme"],
    "black-pepper": ["pepper", "fresh ground pepper", "fresh ground black pepper", "freshly ground black pepper"],
    "salt": ["salt & pepper", "salt & freshly ground black pepper", "salt and pepper"],
    "heavy-cream": ["whipping cream", "heavy whipping cream"],
    "unsalted-butter": ["butter", "melted butter", "softened butter"],
    "red-chili-flakes": ["crushed red pepper flakes", "red pepper flakes"],
    "mushrooms": ["fresh mushrooms", "sliced mushrooms"],
    "lemon": ["lemon, juice of"],
    "water": ["water", "boiling water", "hot water", "cold water", "warm water", "ice water", "ice"],
    "chicken-breasts": [
        "boneless skinless chicken breasts",
        "boneless skinless chicken breast halves",
        "cooked chicken",
        "chicken breast halves",
    ],
    "ground-beef": ["lean ground beef"],
    "eggs": ["egg yolks"],
    "cayenne-pepper": ["cayenne"],
    "green-chilies": ["green chilies", "green chiles"],
    "pecans": ["pecans"],
    "milk": ["skim milk", "whole milk", "2% milk", "low-fat milk"],
}

# ── New entries (not in ontology at all) ────────────────────────────────────
NEW_ENTRIES = [
    {
        "slug": "flour",
        "displayName": "Flour",
        "surfaceForms": ["flour", "all-purpose flour", "plain flour", "ap flour", "wheat flour"],
        "fdc": {"fdcId": 789890, "dataType": "foundation", "description": "Flour, wheat, all-purpose, enriched, bleached"},
        "equivalenceClass": "flour",
    },
    {
        "slug": "milk",
        "displayName": "Milk",
        "surfaceForms": ["milk", "whole milk", "skim milk", "2% milk", "low-fat milk", "reduced fat milk"],
        "fdc": {"fdcId": 171265, "dataType": "sr_legacy", "description": "Milk, whole, 3.25% milkfat, with added vitamin D"},
        "equivalenceClass": "milk",
    },
    {
        "slug": "butter",
        "displayName": "Butter",
        "surfaceForms": ["butter", "salted butter", "melted butter", "softened butter", "stick butter"],
        "fdc": {"fdcId": 173410, "dataType": "sr_legacy", "description": "Butter, salted"},
        "equivalenceClass": "butter",
    },
    {
        "slug": "pepper",
        "displayName": "Black Pepper",
        "surfaceForms": ["pepper", "black pepper", "ground pepper", "fresh ground pepper",
                         "freshly ground black pepper", "fresh ground black pepper",
                         "ground black pepper", "cracked black pepper"],
        "fdc": {"fdcId": 170931, "dataType": "sr_legacy", "description": "Spices, pepper, black"},
        "equivalenceClass": "black-pepper",
    },
    {
        "slug": "oil",
        "displayName": "Vegetable Oil",
        "surfaceForms": ["oil", "vegetable oil", "cooking oil", "canola oil", "neutral oil"],
        "fdc": {"fdcId": 171025, "dataType": "sr_legacy", "description": "Oil, vegetable, soybean, refined"},
        "equivalenceClass": "oil",
    },
    {
        "slug": "margarine",
        "displayName": "Margarine",
        "surfaceForms": ["margarine", "margarine or butter"],
        "fdc": {"fdcId": 173430, "dataType": "sr_legacy", "description": "Margarine, regular, 80% fat, composite, stick, with salt"},
        "equivalenceClass": "margarine",
    },
    {
        "slug": "vinegar",
        "displayName": "Vinegar",
        "surfaceForms": ["vinegar", "white vinegar", "distilled vinegar", "distilled white vinegar"],
        "fdc": {"fdcId": 173468, "dataType": "sr_legacy", "description": "Vinegar, distilled"},
        "equivalenceClass": "vinegar",
    },
    {
        "slug": "shortening",
        "displayName": "Shortening",
        "surfaceForms": ["shortening", "vegetable shortening"],
        "fdc": {"fdcId": 171011, "dataType": "sr_legacy", "description": "Shortening, household, soybean (partially hydrogenated)-cottonseed (partially hydrogenated)"},
        "equivalenceClass": "shortening",
    },
    {
        "slug": "cheese",
        "displayName": "Cheese",
        "surfaceForms": ["cheese", "shredded cheese", "grated cheese"],
        "fdc": {"fdcId": 170851, "dataType": "sr_legacy", "description": "Cheese, cheddar"},
        "equivalenceClass": "cheese",
    },
    {
        "slug": "garlic-salt",
        "displayName": "Garlic Salt",
        "surfaceForms": ["garlic salt"],
        "fdc": {"fdcId": 171325, "dataType": "sr_legacy", "description": "Spices, garlic powder"},
        "equivalenceClass": "garlic-salt",
    },
    {
        "slug": "cider-vinegar",
        "displayName": "Cider Vinegar",
        "surfaceForms": ["cider vinegar", "apple cider vinegar"],
        "fdc": {"fdcId": 173469, "dataType": "sr_legacy", "description": "Vinegar, cider"},
        "equivalenceClass": "vinegar",
    },
    {
        "slug": "semi-sweet-chocolate-chips",
        "displayName": "Semi-Sweet Chocolate Chips",
        "surfaceForms": ["semi-sweet chocolate chips", "semisweet chocolate chips", "chocolate chips"],
        "fdc": {"fdcId": 170272, "dataType": "sr_legacy", "description": "Chocolate, dark, 45-59% cacao solids"},
        "equivalenceClass": "chocolate-chips",
    },
    {
        "slug": "ground-cloves",
        "displayName": "Ground Cloves",
        "surfaceForms": ["ground cloves", "cloves", "whole cloves"],
        "fdc": {"fdcId": 170922, "dataType": "sr_legacy", "description": "Spices, cloves, ground"},
        "equivalenceClass": "cloves",
    },
    {
        "slug": "half-and-half",
        "displayName": "Half-and-Half",
        "surfaceForms": ["half-and-half", "half and half", "half & half"],
        "fdc": {"fdcId": 170855, "dataType": "sr_legacy", "description": "Cream, fluid, half and half"},
        "equivalenceClass": "half-and-half",
    },
    {
        "slug": "seasoning-salt",
        "displayName": "Seasoning Salt",
        "surfaceForms": ["seasoning salt", "season salt", "lawry's seasoned salt"],
        "fdc": {"fdcId": 173468, "dataType": "sr_legacy", "description": "Salt, table"},
        "equivalenceClass": "seasoning-salt",
    },
    {
        "slug": "tabasco-sauce",
        "displayName": "Tabasco Sauce",
        "surfaceForms": ["tabasco sauce", "tabasco", "hot pepper sauce"],
        "fdc": {"fdcId": 171150, "dataType": "sr_legacy", "description": "Sauce, hot chile, sriracha"},
        "equivalenceClass": "hot-sauce",
    },
    {
        "slug": "chicken",
        "displayName": "Chicken",
        "surfaceForms": ["chicken", "cooked chicken", "rotisserie chicken"],
        "fdc": {"fdcId": 171077, "dataType": "sr_legacy", "description": "Chicken, broilers or fryers, meat only, cooked, roasted"},
        "equivalenceClass": "chicken",
    },
    {
        "slug": "cooking-spray",
        "displayName": "Cooking Spray",
        "surfaceForms": ["cooking spray", "nonstick cooking spray", "non-stick cooking spray", "pam"],
        "fdc": {"fdcId": 171025, "dataType": "sr_legacy", "description": "Oil, vegetable, soybean, refined"},
        "equivalenceClass": "cooking-spray",
    },
    {
        "slug": "almond-extract",
        "displayName": "Almond Extract",
        "surfaceForms": ["almond extract", "pure almond extract"],
        "fdc": {"fdcId": 170684, "dataType": "sr_legacy", "description": "Vanilla extract"},
        "equivalenceClass": "almond-extract",
    },
    {
        "slug": "celery-ribs",
        "displayName": "Celery",
        "surfaceForms": ["celery ribs", "celery stalks", "celery stalk", "celery rib"],
        "fdc": {"fdcId": 169988, "dataType": "sr_legacy", "description": "Celery, raw"},
        "equivalenceClass": "celery",
    },
    {
        "slug": "green-chilies",
        "displayName": "Green Chilies",
        "surfaceForms": ["green chilies", "green chiles", "diced green chiles", "canned green chilies"],
        "fdc": {"fdcId": 168569, "dataType": "sr_legacy", "description": "Peppers, hot chili, green, canned"},
        "equivalenceClass": "green-chilies",
    },
    {
        "slug": "pecans",
        "displayName": "Pecans",
        "surfaceForms": ["pecans", "pecan halves", "chopped pecans", "toasted pecans"],
        "fdc": {"fdcId": 170182, "dataType": "sr_legacy", "description": "Nuts, pecans"},
        "equivalenceClass": "pecans",
    },
]


def enrich_new_entry(raw):
    """Add standard ontology fields to a new entry."""
    import re

    tokens = set()
    for sf in raw["surfaceForms"]:
        for t in sf.lower().split():
            cleaned = re.sub(r"[^a-z0-9]", "", t)
            if cleaned and len(cleaned) >= 2:
                tokens.add(cleaned)

    COLOR_WORDS = {"red", "green", "yellow", "orange", "purple", "white", "black", "brown", "golden"}
    FORM_WORDS = {"raw", "cooked", "dried", "ground", "fresh", "frozen", "canned", "whole", "powdered"}
    PREP_WORDS = {"chopped", "diced", "minced", "sliced", "shredded", "peeled", "seeded",
                  "grated", "crushed", "roasted", "toasted", "smoked", "melted", "softened"}
    SIZE_WORDS = {"small", "medium", "large", "thin", "thick", "baby", "mini"}

    sorted_tokens = sorted(tokens)

    return {
        "slug": raw["slug"],
        "displayName": raw["displayName"],
        "surfaceForms": raw["surfaceForms"],
        "tokens": sorted_tokens,
        "modifiers": {
            "color": [t for t in sorted_tokens if t in COLOR_WORDS],
            "form": [t for t in sorted_tokens if t in FORM_WORDS],
            "prep": [t for t in sorted_tokens if t in PREP_WORDS],
            "size": [t for t in sorted_tokens if t in SIZE_WORDS],
            "origin": [],
        },
        "aliases": {},
        "fdc": raw["fdc"],
        "equivalenceClass": raw.get("equivalenceClass", raw["slug"]),
        "taxonomy": {"group": None, "family": None, "genus": None, "species": None},
        "substitutions": [],
    }


def main():
    ontology = json.loads(ONTOLOGY_PATH.read_text("utf-8"))
    slug_index = {e["slug"]: e for e in ontology}

    # 1. Patch surface forms onto existing entries
    patched_count = 0
    for slug, new_forms in SURFACE_FORM_PATCHES.items():
        if slug in slug_index:
            entry = slug_index[slug]
            existing = {sf.lower() for sf in entry["surfaceForms"]}
            for form in new_forms:
                if form.lower() not in existing:
                    entry["surfaceForms"].append(form)
                    existing.add(form.lower())
                    patched_count += 1
        else:
            print(f"  WARNING: slug '{slug}' not found for patching")

    print(f"Added {patched_count} surface forms to existing entries")

    # 2. Add new entries
    added = 0
    for raw in NEW_ENTRIES:
        if raw["slug"] not in slug_index:
            entry = enrich_new_entry(raw)
            ontology.append(entry)
            slug_index[raw["slug"]] = entry
            added += 1
        else:
            # Merge surface forms into existing
            existing_entry = slug_index[raw["slug"]]
            existing_lower = {sf.lower() for sf in existing_entry["surfaceForms"]}
            for sf in raw["surfaceForms"]:
                if sf.lower() not in existing_lower:
                    existing_entry["surfaceForms"].append(sf)
                    existing_lower.add(sf.lower())
            print(f"  Merged surface forms into existing '{raw['slug']}'")

    print(f"Added {added} new entries")

    # 3. Sort by slug
    ontology.sort(key=lambda e: e["slug"])

    # 4. Stats
    total_sf = sum(len(e["surfaceForms"]) for e in ontology)
    with_fdc = sum(1 for e in ontology if e["fdc"]["fdcId"])
    print(f"Total entries: {len(ontology)}")
    print(f"With FDC ID: {with_fdc}")
    print(f"Total surface forms: {total_sf}")

    ONTOLOGY_PATH.write_text(
        json.dumps(ontology, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("Written.")


if __name__ == "__main__":
    main()
