"""
Patch ingredient-ontology.json with the next ~100 missing high-frequency ingredients.

Usage:
    python scripts/patch-ontology-next100.py
"""

import json
import re
from pathlib import Path
from typing import List, Set

ROOT = Path(__file__).resolve().parent.parent
ONTOLOGY_PATH = ROOT / "data" / "ingredient-ontology.json"

# ── Surface form additions to EXISTING entries ──────────────────────────────
SURFACE_FORM_PATCHES = {
    "brown-sugar": ["dark brown sugar", "light brown sugar", "packed brown sugar"],
    "apples": ["apple"],
    "rice": ["cooked rice", "rice"],
    "allspice": ["allspice", "ground allspice"],
    "pineapple": ["crushed pineapple", "pineapple juice", "pineapple chunks"],
    "russet-potatoes": ["potato", "potatoes", "red potatoes", "yukon gold potatoes"],
    "ginger": ["gingerroot", "ginger root", "fresh ginger root"],
    "spinach": ["fresh spinach", "baby spinach", "frozen chopped spinach"],
    "strawberries": ["strawberries", "fresh strawberries"],
    "dried-oregano": ["dried parsley", "dried rosemary"],
    "lemon": ["lemons", "lemon, zest of", "lemon zest"],
    "almonds": ["slivered almonds", "sliced almonds"],
    "chicken-breasts": ["boneless skinless chicken breast"],
    "chicken-broth": ["low sodium chicken broth", "low-sodium chicken broth"],
    "fresh-basil": ["basil leaves"],
    "fresh-rosemary": ["fresh oregano"],
    "eggs": ["hard-boiled eggs", "hard boiled eggs"],
    "parmesan-cheese": ["parmesan"],
    "sour-cream": ["sour cream"],
    "tomatoes": ["plum tomatoes", "roma tomatoes"],
    "celery-ribs": ["celery stalks", "celery stalk"],
    "carrots": ["baby carrots"],
    "peach": ["peaches", "fresh peaches"],
    "leeks": ["leeks", "leek"],
    "breadcrumbs": ["dry breadcrumbs"],
    "oats": ["oatmeal", "quick oats", "old fashioned oats"],
    "mint": ["of fresh mint", "fresh mint", "mint leaves"],
    "ground-cinnamon": ["cinnamon"],
    "sweet-onion": ["sweet onion", "vidalia onion"],
    "almonds-whole-raw": ["slivered almonds", "sliced almonds", "almonds"],
    "cucumber": ["cucumbers"],
    "lime": ["lime, juice of"],
    "jalapenos": ["jalapeno peppers", "jalapeno"],
    "peanut-butter": ["creamy peanut butter", "crunchy peanut butter", "smooth peanut butter"],
    "water": ["ice cubes"],
    "soy-sauce": ["low sodium soy sauce", "low-sodium soy sauce"],
    "tomatoes-raw": ["plum tomatoes", "stewed tomatoes"],
}

# ── New entries ─────────────────────────────────────────────────────────────
NEW_ENTRIES = [
    {
        "slug": "rice",
        "displayName": "Rice",
        "surfaceForms": ["rice", "cooked rice", "white rice", "long grain rice"],
        "fdc": {"fdcId": 169756, "dataType": "sr_legacy", "description": "Rice, white, medium-grain, cooked"},
        "equivalenceClass": "rice",
    },
    {
        "slug": "allspice",
        "displayName": "Allspice",
        "surfaceForms": ["allspice", "ground allspice", "whole allspice"],
        "fdc": {"fdcId": 170921, "dataType": "sr_legacy", "description": "Spices, allspice, ground"},
        "equivalenceClass": "allspice",
    },
    {
        "slug": "cream-of-chicken-soup",
        "displayName": "Cream of Chicken Soup",
        "surfaceForms": ["cream of chicken soup", "condensed cream of chicken soup", "cream of mushroom soup", "condensed cream of mushroom soup"],
        "fdc": {"fdcId": 170486, "dataType": "sr_legacy", "description": "Soup, cream of chicken, canned, condensed"},
        "equivalenceClass": "cream-soup",
    },
    {
        "slug": "potato",
        "displayName": "Potato",
        "surfaceForms": ["potato", "potatoes", "red potatoes", "yukon gold potatoes", "baking potatoes", "russet potato"],
        "fdc": {"fdcId": 170026, "dataType": "sr_legacy", "description": "Potatoes, flesh and skin, raw"},
        "equivalenceClass": "potato",
    },
    {
        "slug": "beer",
        "displayName": "Beer",
        "surfaceForms": ["beer", "lager", "ale", "stout"],
        "fdc": {"fdcId": 174816, "dataType": "sr_legacy", "description": "Alcoholic beverage, beer, regular, all"},
        "equivalenceClass": "beer",
    },
    {
        "slug": "dried-cranberries",
        "displayName": "Dried Cranberries",
        "surfaceForms": ["dried cranberries", "craisins"],
        "fdc": {"fdcId": 168826, "dataType": "sr_legacy", "description": "Cranberries, dried, sweetened"},
        "equivalenceClass": "cranberries",
    },
    {
        "slug": "cool-whip",
        "displayName": "Whipped Topping",
        "surfaceForms": ["cool whip", "whipped topping", "frozen whipped topping"],
        "fdc": {"fdcId": 170862, "dataType": "sr_legacy", "description": "Toppings, whipped, frozen, low fat"},
        "equivalenceClass": "whipped-topping",
    },
    {
        "slug": "sweet-onion",
        "displayName": "Sweet Onion",
        "surfaceForms": ["sweet onion", "vidalia onion", "walla walla onion", "maui onion"],
        "fdc": {"fdcId": 170000, "dataType": "sr_legacy", "description": "Onions, raw"},
        "equivalenceClass": "onion",
    },
    {
        "slug": "caster-sugar",
        "displayName": "Caster Sugar",
        "surfaceForms": ["caster sugar", "castor sugar", "superfine sugar"],
        "fdc": {"fdcId": 169655, "dataType": "sr_legacy", "description": "Sugars, granulated"},
        "equivalenceClass": "sugar",
    },
    {
        "slug": "dry-sherry",
        "displayName": "Dry Sherry",
        "surfaceForms": ["dry sherry", "sherry", "cooking sherry"],
        "fdc": {"fdcId": 174838, "dataType": "sr_legacy", "description": "Alcoholic beverage, wine, table, white"},
        "equivalenceClass": "sherry",
    },
    {
        "slug": "vanilla-ice-cream",
        "displayName": "Vanilla Ice Cream",
        "surfaceForms": ["vanilla ice cream", "ice cream"],
        "fdc": {"fdcId": 167575, "dataType": "sr_legacy", "description": "Ice cream, vanilla"},
        "equivalenceClass": "ice-cream",
    },
    {
        "slug": "clove",
        "displayName": "Clove",
        "surfaceForms": ["clove", "cloves", "whole cloves"],
        "fdc": {"fdcId": 170922, "dataType": "sr_legacy", "description": "Spices, cloves, ground"},
        "equivalenceClass": "cloves",
    },
    {
        "slug": "french-bread",
        "displayName": "French Bread",
        "surfaceForms": ["french bread", "baguette", "crusty bread"],
        "fdc": {"fdcId": 174924, "dataType": "sr_legacy", "description": "Bread, french or vienna (includes sourdough)"},
        "equivalenceClass": "bread",
    },
    {
        "slug": "pork-chops",
        "displayName": "Pork Chops",
        "surfaceForms": ["pork chops", "pork loin chops", "boneless pork chops", "bone-in pork chops"],
        "fdc": {"fdcId": 167820, "dataType": "sr_legacy", "description": "Pork, fresh, loin, center loin (chops), bone-in, separable lean only, raw"},
        "equivalenceClass": "pork-chops",
    },
    {
        "slug": "spaghetti-sauce",
        "displayName": "Spaghetti Sauce",
        "surfaceForms": ["spaghetti sauce", "pasta sauce", "jarred pasta sauce", "marinara"],
        "fdc": {"fdcId": 170509, "dataType": "sr_legacy", "description": "Sauce, pasta, spaghetti/marinara, ready-to-serve"},
        "equivalenceClass": "pasta-sauce",
    },
    {
        "slug": "splenda",
        "displayName": "Splenda",
        "surfaceForms": ["splenda sugar substitute", "splenda", "sucralose"],
        "fdc": {"fdcId": 170257, "dataType": "sr_legacy", "description": "Sweeteners, tabletop, sucralose, SPLENDA packets"},
        "equivalenceClass": "sweetener",
    },
    {
        "slug": "brandy",
        "displayName": "Brandy",
        "surfaceForms": ["brandy", "cognac"],
        "fdc": {"fdcId": 174815, "dataType": "sr_legacy", "description": "Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 80 proof"},
        "equivalenceClass": "spirits",
    },
    {
        "slug": "ground-red-pepper",
        "displayName": "Ground Red Pepper",
        "surfaceForms": ["ground red pepper", "red pepper", "crushed red pepper"],
        "fdc": {"fdcId": 170932, "dataType": "sr_legacy", "description": "Spices, pepper, red or cayenne"},
        "equivalenceClass": "cayenne-pepper",
    },
    {
        "slug": "apple",
        "displayName": "Apple",
        "surfaceForms": ["apple", "apples", "granny smith apple", "green apple", "tart apple"],
        "fdc": {"fdcId": 1750339, "dataType": "foundation", "description": "Apples, red delicious, with skin, raw"},
        "equivalenceClass": "apple",
    },
    {
        "slug": "peach",
        "displayName": "Peach",
        "surfaceForms": ["peach", "peaches", "fresh peaches"],
        "fdc": {"fdcId": 169928, "dataType": "sr_legacy", "description": "Peaches, raw"},
        "equivalenceClass": "peach",
    },
    {
        "slug": "leeks",
        "displayName": "Leeks",
        "surfaceForms": ["leeks", "leek"],
        "fdc": {"fdcId": 169246, "dataType": "sr_legacy", "description": "Leeks, (bulb and lower leaf-portion), raw"},
        "equivalenceClass": "leeks",
    },
    {
        "slug": "carrots",
        "displayName": "Carrots",
        "surfaceForms": ["carrots", "carrot", "baby carrots", "shredded carrots"],
        "fdc": {"fdcId": 170393, "dataType": "sr_legacy", "description": "Carrots, raw"},
        "equivalenceClass": "carrots",
    },
    {
        "slug": "oats",
        "displayName": "Oats",
        "surfaceForms": ["oats", "oatmeal", "quick oats", "rolled oats", "old fashioned oats"],
        "fdc": {"fdcId": 173904, "dataType": "sr_legacy", "description": "Cereals, oats, regular and quick, not fortified, dry"},
        "equivalenceClass": "oats",
    },
    {
        "slug": "mint",
        "displayName": "Mint",
        "surfaceForms": ["mint", "fresh mint", "mint leaves", "of fresh mint", "spearmint"],
        "fdc": {"fdcId": 170929, "dataType": "sr_legacy", "description": "Spices, spearmint, fresh"},
        "equivalenceClass": "mint",
    },
    {
        "slug": "pineapple-juice",
        "displayName": "Pineapple Juice",
        "surfaceForms": ["pineapple juice"],
        "fdc": {"fdcId": 168199, "dataType": "sr_legacy", "description": "Pineapple juice, canned or bottled, unsweetened, without added ascorbic acid"},
        "equivalenceClass": "pineapple",
    },
    {
        "slug": "almond-extract",
        "displayName": "Almond Extract",
        "surfaceForms": ["almond extract", "pure almond extract"],
        "fdc": {"fdcId": 170684, "dataType": "sr_legacy", "description": "Vanilla extract"},
        "equivalenceClass": "almond-extract",
    },
    {
        "slug": "strawberries",
        "displayName": "Strawberries",
        "surfaceForms": ["strawberries", "fresh strawberries", "frozen strawberries", "strawberry"],
        "fdc": {"fdcId": 167762, "dataType": "sr_legacy", "description": "Strawberries, raw"},
        "equivalenceClass": "strawberries",
    },
    {
        "slug": "graham-cracker-crumbs",
        "displayName": "Graham Cracker Crumbs",
        "surfaceForms": ["graham cracker crumbs", "graham crackers", "graham cracker crust"],
        "fdc": {"fdcId": 174938, "dataType": "sr_legacy", "description": "Crackers, graham, plain or honey (includes cinnamon)"},
        "equivalenceClass": "graham-crackers",
    },
    {
        "slug": "yellow-cake-mix",
        "displayName": "Yellow Cake Mix",
        "surfaceForms": ["yellow cake mix", "cake mix", "white cake mix", "chocolate cake mix"],
        "fdc": {"fdcId": 174905, "dataType": "sr_legacy", "description": "Cake mix, yellow, dry mix, regular"},
        "equivalenceClass": "cake-mix",
    },
    {
        "slug": "frozen-corn",
        "displayName": "Frozen Corn",
        "surfaceForms": ["frozen corn", "corn kernels", "whole kernel corn"],
        "fdc": {"fdcId": 168529, "dataType": "sr_legacy", "description": "Corn, sweet, yellow, frozen, kernels, unprepared"},
        "equivalenceClass": "corn",
    },
    {
        "slug": "velveeta",
        "displayName": "Velveeta",
        "surfaceForms": ["velveeta cheese", "velveeta", "processed cheese", "american cheese"],
        "fdc": {"fdcId": 170850, "dataType": "sr_legacy", "description": "Cheese, pasteurized process, American"},
        "equivalenceClass": "processed-cheese",
    },
    {
        "slug": "semisweet-chocolate",
        "displayName": "Semisweet Chocolate",
        "surfaceForms": ["semisweet chocolate", "semi-sweet chocolate", "bittersweet chocolate", "dark chocolate"],
        "fdc": {"fdcId": 170272, "dataType": "sr_legacy", "description": "Chocolate, dark, 45-59% cacao solids"},
        "equivalenceClass": "chocolate",
    },
]


def enrich_new_entry(raw):
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
            existing_entry = slug_index[raw["slug"]]
            existing_lower = {sf.lower() for sf in existing_entry["surfaceForms"]}
            merged = 0
            for sf in raw["surfaceForms"]:
                if sf.lower() not in existing_lower:
                    existing_entry["surfaceForms"].append(sf)
                    existing_lower.add(sf.lower())
                    merged += 1
            if merged:
                print(f"  Merged {merged} surface forms into existing '{raw['slug']}'")

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
