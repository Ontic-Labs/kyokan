/**
 * Recipe-First Ingredient Mapping
 *
 * Maps recipe ingredient names to FDC food IDs using deterministic strategies:
 *
 *   1. Canonical bridge: Run canonicalizeDescription() on FDC foods, then
 *      match recipe ingredients against the resulting specificName values.
 *   2. Base name bridge: Match against FDC baseName values.
 *   3. Plural/singular tolerance.
 *   4. State prefix stripping ("dried oregano" → "oregano").
 *   5. Form suffix stripping ("garlic cloves" → "garlic").
 *   6. Recipe aliases (hardcoded, to be moved to canonical_ingredient_alias table).
 *   7. Combined strip + alias.
 *   8. Substring fallback.
 *
 * Populates the normalized schema from migration 009:
 *   - recipe_ingredient_vocab (raw corpus data)
 *   - canonical_ingredient (registry)
 *   - canonical_ingredient_alias (from RECIPE_ALIASES)
 *   - canonical_fdc_membership (join table)
 *
 * Usage:
 *   npx tsx scripts/map-recipe-ingredients.ts                    # dry run
 *   npx tsx scripts/map-recipe-ingredients.ts --write            # insert into DB
 *   npx tsx scripts/map-recipe-ingredients.ts --top 100          # only top N
 *   npx tsx scripts/map-recipe-ingredients.ts --write --top 500
 */

import * as fs from "fs";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { canonicalizeDescription, slugify } from "../src/lib/canonicalize";

dotenv.config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecipeIngredient {
  name: string;
  frequency: number;
}

interface FdcFood {
  fdcId: number;
  description: string;
  isCookable: boolean;
  baseName: string;
  baseSlug: string;
  specificName: string;
  specificSlug: string;
}

interface MatchResult {
  ingredientName: string;
  ingredientSlug: string;
  frequency: number;
  fdcIds: number[];
  matchMethod: string;
  matchConfidence: number;
}

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

function loadRecipeIngredients(topN?: number): RecipeIngredient[] {
  const path = "data/recipe-ingredients.json";
  if (!fs.existsSync(path)) {
    throw new Error(`${path} not found. Run: npx tsx scripts/extract-recipe-ingredients.ts`);
  }
  const raw: RecipeIngredient[] = JSON.parse(fs.readFileSync(path, "utf-8"));
  // Sanitize CSV artifacts (trailing quotes/commas from bad CSV parsing),
  // then merge entries that collapse to the same name after cleanup.
  const merged = new Map<string, number>();
  for (const ing of raw) {
    const clean = ing.name.replace(/["]+,?$/g, "").replace(/^["]+/g, "").trim();
    if (!clean) continue;
    merged.set(clean, (merged.get(clean) || 0) + ing.frequency);
  }
  const all = [...merged.entries()]
    .map(([name, frequency]) => ({ name, frequency }))
    .sort((a, b) => b.frequency - a.frequency);
  return topN ? all.slice(0, topN) : all;
}

function loadFdcFoods(): FdcFood[] {
  const foods: FdcFood[] = [];

  // SR Legacy
  const srPath = "fdc/FoodData_Central_sr_legacy_food_json_2018-04.json";
  if (fs.existsSync(srPath)) {
    const sr = JSON.parse(fs.readFileSync(srPath, "utf-8"));
    for (const f of sr.SRLegacyFoods) {
      if (!f.description || !f.fdcId) continue;
      const canonical = canonicalizeDescription(f.description);
      foods.push({
        fdcId: f.fdcId,
        description: f.description,
        isCookable: true,
        baseName: canonical.baseName,
        baseSlug: canonical.baseSlug,
        specificName: canonical.specificName,
        specificSlug: canonical.specificSlug,
      });
    }
  }

  // Foundation
  const fnPath = "fdc/FoodData_Central_foundation_food_json_2025-12-18.json";
  if (fs.existsSync(fnPath)) {
    const fn = JSON.parse(fs.readFileSync(fnPath, "utf-8"));
    for (const f of fn.FoundationFoods) {
      if (!f.description || !f.fdcId) continue;
      const canonical = canonicalizeDescription(f.description);
      foods.push({
        fdcId: f.fdcId,
        description: f.description,
        isCookable: true,
        baseName: canonical.baseName,
        baseSlug: canonical.baseSlug,
        specificName: canonical.specificName,
        specificSlug: canonical.specificSlug,
      });
    }
  }

  return foods;
}

// ---------------------------------------------------------------------------
// Build indexes over FDC foods for fast matching
// ---------------------------------------------------------------------------

interface FdcIndex {
  bySpecificName: Map<string, number[]>;
  bySpecificSlug: Map<string, number[]>;
  byBaseName: Map<string, number[]>;
  byBaseSlug: Map<string, number[]>;
  /** Parenthetical alternate names extracted from FDC descriptions → FDC IDs */
  byParenthetical: Map<string, number[]>;
  all: FdcFood[];
}

/** Extract parenthetical content from FDC descriptions as alternate names.
 *  "Coriander (cilantro) leaves, raw" → ["cilantro"]
 *  "Acerola, (west indian cherry), raw" → ["west indian cherry"]
 */
function extractParentheticals(description: string): string[] {
  const matches = description.match(/\(([^)]+)\)/g);
  if (!matches) return [];
  return matches
    .map((m) => m.slice(1, -1).trim().toLowerCase())
    .filter((s) => s.length >= 3);
}

function buildFdcIndex(foods: FdcFood[]): FdcIndex {
  const bySpecificSlug = new Map<string, number[]>();
  const bySpecificName = new Map<string, number[]>();
  const byBaseName = new Map<string, number[]>();
  const byBaseSlug = new Map<string, number[]>();
  const byParenthetical = new Map<string, number[]>();

  for (const food of foods) {
    if (!food.specificName || !food.baseName) continue;

    const addTo = (map: Map<string, number[]>, key: string) => {
      const ids = map.get(key) || [];
      ids.push(food.fdcId);
      map.set(key, ids);
    };

    addTo(bySpecificSlug, food.specificSlug);
    addTo(bySpecificName, food.specificName.toLowerCase());
    addTo(byBaseName, food.baseName.toLowerCase());
    addTo(byBaseSlug, food.baseSlug);

    // Index parenthetical content as alternate names
    // This catches common names like "cilantro", "west indian cherry"
    for (const paren of extractParentheticals(food.description)) {
      addTo(byParenthetical, paren);
      addTo(byParenthetical, slugify(paren));
    }
  }

  return { bySpecificName, bySpecificSlug, byBaseName, byBaseSlug, byParenthetical, all: foods };
}

// ---------------------------------------------------------------------------
// Pre-normalization: fix format oddities before matching
// ---------------------------------------------------------------------------

/** Normalize recipe ingredient format oddities:
 *  "lemon, juice of" → "lemon juice"
 *  "lemon, zest of"  → "lemon zest"
 *  "lime, juice of"  → "lime juice"
 *  "of fresh mint"   → "fresh mint"
 */
function preNormalize(name: string): string {
  let n = name;

  // Strip CSV artifacts: trailing quotes and commas (e.g. sugar"",)
  n = n.replace(/["]+,?$/g, "").replace(/^["]+/g, "");

  // "X, juice of" → "X juice"
  n = n.replace(/^(.+),\s*juice of$/i, "$1 juice");
  // "X, zest of" → "X zest"
  n = n.replace(/^(.+),\s*zest of$/i, "$1 zest");
  // Leading "of " (e.g. "of fresh mint")
  n = n.replace(/^of\s+/i, "");

  return n.trim();
}

// ---------------------------------------------------------------------------
// State tokens to strip from recipe ingredients for fuzzy matching
// ---------------------------------------------------------------------------

const RECIPE_STATE_PREFIXES = [
  // Preparation state
  "fresh", "frozen", "canned", "dried", "ground",
  "minced", "chopped", "diced", "sliced", "shredded",
  "crushed", "grated", "melted", "softened", "chilled",
  "cooked", "uncooked", "raw",
  // Physical state
  "boneless", "skinless", "boneless skinless",
  "cold", "warm", "hot", "cool", "room temperature",
  "hard-boiled", "hard boiled", "soft-boiled",
  // Quality/grade
  "extra virgin", "extra-virgin",
  "unsweetened", "sweetened", "unsalted",
  "coarse", "fine", "sifted",
  // Size
  "light", "dark", "sweet", "dry",
  "large", "small", "medium", "thin", "thick",
  "slivered", "toasted", "roasted",
];

function stripStatePrefix(name: string): string | null {
  const sorted = [...RECIPE_STATE_PREFIXES].sort((a, b) => b.length - a.length);
  let result = name;
  let changed = false;
  let passes = 0;
  while (passes < 3) {
    let passChanged = false;
    for (const prefix of sorted) {
      if (result.startsWith(prefix + " ")) {
        result = result.slice(prefix.length).trim();
        passChanged = true;
        changed = true;
        break;
      }
    }
    if (!passChanged) break;
    passes++;
  }
  return changed ? result : null;
}

const RECIPE_FORM_SUFFIXES = [
  "cloves", "clove", "stalks", "stalk", "leaves", "leaf",
  "pieces", "piece", "halves", "half",
  "fillets", "fillet", "breasts", "breast",
  "ribs", "rib", "sticks", "stick",
  "strips", "strip", "cubes", "cube",
  "crumbs", "crumb",
];

function stripFormSuffix(name: string): string | null {
  for (const suffix of RECIPE_FORM_SUFFIXES) {
    if (name.endsWith(" " + suffix)) {
      return name.slice(0, -(suffix.length + 1)).trim();
    }
  }
  return null;
}

// Recipe→FDC aliases: recipe name → FDC canonical base or specific name.
// Targets MUST exist as baseName or specificName in the FDC canonical index.
// These will also be inserted into canonical_ingredient_alias when --write is used.
const RECIPE_ALIASES = new Map<string, string>([
  // Flour — FDC base "wheat flour" (from "Wheat flour, white, all-purpose")
  ["flour", "wheat flour"],
  ["all-purpose flour", "wheat flour"],
  ["whole wheat flour", "wheat flour"],
  // Butter — FDC base "butter"
  ["unsalted butter", "butter"],
  ["salted butter", "butter"],
  // Oils — FDC base for "Oil, olive" is "olive"
  ["extra virgin olive oil", "olive"],
  ["extra-virgin olive oil", "olive"],
  ["oil", "vegetable"],              // FDC base for "Oil, vegetable" is "vegetable"
  ["sesame oil", "sesame"],
  ["peanut oil", "peanut"],
  ["canola oil", "canola"],
  // Salt — FDC base "salt"
  ["kosher salt", "salt"],
  ["sea salt", "salt"],
  ["table salt", "salt"],
  ["garlic salt", "salt"],
  ["seasoning salt", "salt"],
  // Sugar — FDC base "sugar"
  ["white sugar", "sugar"],
  ["granulated sugar", "sugar"],
  ["powdered sugar", "sugar"],
  ["confectioners sugar", "sugar"],
  // Cream — FDC base "cream"
  ["heavy cream", "cream"],
  ["whipping cream", "cream"],
  ["heavy whipping cream", "cream"],
  ["half-and-half", "cream"],
  // Beef — FDC specific "ground beef"
  ["lean ground beef", "ground beef"],
  ["ground chuck", "ground beef"],
  // Poultry — FDC base "soup" (chicken broth is under soup)
  ["chicken stock", "soup"],
  // Eggs — FDC base "egg"
  ["egg whites", "egg"],
  ["egg yolks", "egg"],
  // Onion/pepper variants
  ["green onions", "green onion"],
  ["red onion", "red onions"],
  ["red bell pepper", "bell peppers"],
  ["green bell pepper", "bell peppers"],
  ["cayenne pepper", "red or cayenne pepper"],
  ["jalapenos", "jalapeno peppers"],
  ["jalapeno", "jalapeno peppers"],
  // Bread
  ["breadcrumbs", "bread crumbs"],
  // Herbs
  ["bay leaves", "bay leaf"],
  // Cumin — FDC base "cumin seed" (under Spices)
  ["ground cumin", "cumin seed"],
  ["ground coriander", "coriander seed"],
  // Milk — FDC base "milk"
  ["whole milk", "milk"],
  ["skim milk", "milk"],
  ["sweetened condensed milk", "condensed milk"],
  // Cocoa — FDC base "cocoa"
  ["cocoa powder", "cocoa"],
  // Vinegar — FDC base "vinegar"
  ["white vinegar", "vinegar"],
  ["rice vinegar", "vinegar"],
  ["white wine vinegar", "vinegar"],
  // Sauces — FDC base "hot chile" (from "Sauce, hot chile, sriracha")
  ["hot sauce", "hot chile"],
  ["hot pepper sauce", "hot chile"],
  ["tabasco sauce", "pepper"],        // "Sauce, ready-to-serve, pepper, TABASCO" → base "pepper"
  ["spaghetti sauce", "pasta"],       // "Sauce, pasta, spaghetti/marinara" → base "pasta"
  ["hoisin sauce", "hoisin"],         // "Sauce, hoisin" → base "hoisin"
  // Misc
  ["worcestershire sauce", "worcestershire"],
  ["dijon mustard", "mustard"],
  ["tomato paste", "tomato products"],
  ["white wine", "wine"],
  ["dry white wine", "wine"],
  ["italian seasoning", "oregano"],
  // Zest — FDC base is plural ("oranges", "lemons")
  ["orange zest", "oranges"],
  ["lemon zest", "lemons"],
  ["orange rind", "oranges"],
  ["lemon rind", "lemons"],
  // Oats — FDC base "oats"
  ["rolled oats", "oats"],
  // Yeast
  ["active dry yeast", "yeast"],
  // Olives — FDC base "olives"
  ["black olives", "olives"],
  // (lemon zest, orange zest, rind aliases are above in Zest section)
  // Ginger — FDC base "ginger"
  ["gingerroot", "ginger"],
  // Cilantro is handled via parenthetical matching:
  // FDC "Coriander (cilantro) leaves" → parenthetical index "cilantro"
  // Pepper flakes — FDC specific "hot chili peppers"
  ["red pepper flakes", "hot chili peppers"],
  ["crushed red pepper flakes", "hot chili peppers"],
  // Potato — FDC base "potatoes"
  ["potato", "potatoes"],
  // UK/AU variants
  ["plain flour", "wheat flour"],
  ["caster sugar", "sugar"],
  ["icing sugar", "sugar"],
  // Sherry — not in SR Legacy data, skip
  // (removed: dry sherry alias pointed to nonexistent FDC food)
  // Fish sauce — FDC has "fish sauce" in descriptions
  ["fish sauce", "fish"],
  // Apple cider vinegar — FDC specific "cider vinegar"
  ["apple cider vinegar", "cider vinegar"],
  // Cooking oil → vegetable oil
  ["cooking oil", "vegetable"],
  // Almond extract — FDC base "almond extract" might not exist, use "extract"
  ["almond extract", "almond"],
  // Cherry tomatoes → FDC base "tomatoes"
  ["cherry tomatoes", "tomatoes"],
  ["plum tomatoes", "tomatoes"],
  // Parsley variants
  ["flat leaf parsley", "parsley"],
  // Dill — FDC base is "dill weed" (from "Spices, dill weed")
  ["dill", "dill weed"],
  ["fresh dill", "dill weed"],
  // Vanilla extract variants
  ["pure vanilla extract", "vanilla extract"],
  // Chicken broth variants
  ["low sodium chicken broth", "soup"],
  ["vegetable stock", "soup"],
  // Nuts generic — FDC base "mixed nuts" (under Nuts container)
  ["nuts", "mixed nuts"],
  // Chocolate
  ["semi-sweet chocolate chips", "chocolate"],
  ["dark chocolate chips", "chocolate"],
  // Cheese modifiers
  ["sharp cheddar cheese", "cheddar cheese"],
  ["mild cheddar cheese", "cheddar cheese"],
  // Bread
  ["french bread", "bread"],
  ["dry breadcrumbs", "bread crumbs"],
  // Tortillas — FDC base "tortillas"
  ["corn tortillas", "tortillas"],
  ["flour tortillas", "tortillas"],
  // Macaroni — FDC base "pasta"
  ["elbow macaroni", "pasta"],
  // Crackers
  ["graham cracker crumbs", "graham"],
  ["graham crackers", "graham"],
  // Coarse salt
  ["coarse salt", "salt"],
  // Red pepper — FDC base "peppers"
  ["red pepper", "peppers"],
  // Red bell peppers — FDC specific "bell peppers"
  ["red bell peppers", "bell peppers"],
  ["green bell peppers", "bell peppers"],
  ["yellow bell pepper", "bell peppers"],
  // Mint — FDC base "mint" (from "Spices, mint, fresh")
  ["fresh mint", "mint"],
  // Broccoli
  ["broccoli florets", "broccoli"],
  // Rice wine vinegar
  ["rice wine vinegar", "vinegar"],
  // Coriander (fresh herb name vs spice name)
  ["fresh coriander", "coriander seed"],
  // Cornflour (UK term for cornstarch)
  ["cornflour", "cornstarch"],
  // Soy sauce variants
  ["low sodium soy sauce", "soy sauce"],
  // Flour variants
  ["unbleached all-purpose flour", "wheat flour"],
  ["self-rising flour", "wheat flour"],
  // Tomato
  ["tomato puree", "tomato products"],
  // Apple
  ["apple cider", "apple"],
]);

function pluralVariant(name: string): string | null {
  if (name.endsWith("s")) return name.slice(0, -1);
  if (name.endsWith("es")) return name.slice(0, -2);
  return name + "s";
}

// ---------------------------------------------------------------------------
// Matching strategies
// ---------------------------------------------------------------------------

function matchIngredient(ingredient: RecipeIngredient, index: FdcIndex): MatchResult {
  // Use pre-normalized form for matching, but preserve original name as the
  // canonical identity. This avoids slug collisions when both "lemon juice" and
  // "lemon, juice of" exist in the corpus — they should remain separate entries.
  const name = preNormalize(ingredient.name);
  const slug = slugify(name);
  const originalName = ingredient.name;
  const originalSlug = slugify(originalName);

  const result = (fdcIds: number[], method: string, confidence: number): MatchResult => ({
    ingredientName: originalName,
    ingredientSlug: originalSlug,
    frequency: ingredient.frequency,
    fdcIds,
    matchMethod: method,
    matchConfidence: confidence,
  });

  // Strategy 1: Canonical bridge — recipe name matches FDC specificName exactly
  const specNameMatch = index.bySpecificName.get(name) || [];
  if (specNameMatch.length > 0) {
    return result(specNameMatch, "canonical_bridge", 1.0);
  }

  // Strategy 1b: Canonical bridge by slug
  const specSlugMatch = index.bySpecificSlug.get(slug) || [];
  if (specSlugMatch.length > 0) {
    return result(specSlugMatch, "canonical_bridge", 0.95);
  }

  // Strategy 2: Base name bridge
  const baseNameMatch = index.byBaseName.get(name) || [];
  if (baseNameMatch.length > 0) {
    return result(baseNameMatch, "base_bridge", 0.85);
  }

  // Strategy 2b: Base name bridge by slug
  const baseSlugMatch = index.byBaseSlug.get(slug) || [];
  if (baseSlugMatch.length > 0) {
    return result(baseSlugMatch, "base_bridge", 0.8);
  }

  // Strategy 2c: Parenthetical match — recipe name matches alternate name
  // extracted from FDC parentheticals: "Coriander (cilantro) leaves" → "cilantro"
  const parenMatch = index.byParenthetical.get(name) || index.byParenthetical.get(slug) || [];
  if (parenMatch.length > 0) {
    return result(parenMatch, "parenthetical", 0.9);
  }

  // Strategy 3: Plural/singular tolerance
  const plural = pluralVariant(name);
  if (plural) {
    const pSlug = slugify(plural);
    const pSpecMatch = index.bySpecificName.get(plural) || index.bySpecificSlug.get(pSlug) || [];
    if (pSpecMatch.length > 0) {
      return result(pSpecMatch, "plural_bridge", 0.85);
    }
    const pBaseMatch = index.byBaseName.get(plural) || index.byBaseSlug.get(pSlug) || [];
    if (pBaseMatch.length > 0) {
      return result(pBaseMatch, "plural_bridge", 0.8);
    }
  }

  // Strategy 4: Strip state prefixes and retry
  const stripped = stripStatePrefix(name);
  if (stripped && stripped.length >= 3) {
    const strippedSlug = slugify(stripped);
    const sSpecMatch = index.bySpecificName.get(stripped) || index.bySpecificSlug.get(strippedSlug) || [];
    if (sSpecMatch.length > 0) {
      return result(sSpecMatch, "state_stripped", 0.75);
    }
    const sBaseMatch = index.byBaseName.get(stripped) || index.byBaseSlug.get(strippedSlug) || [];
    if (sBaseMatch.length > 0) {
      return result(sBaseMatch, "state_stripped", 0.7);
    }
    // Also try parenthetical match on stripped name
    // "fresh cilantro" → strip "fresh" → "cilantro" → parenthetical match
    const sParenMatch = index.byParenthetical.get(stripped) || index.byParenthetical.get(strippedSlug) || [];
    if (sParenMatch.length > 0) {
      return result(sParenMatch, "state_stripped", 0.7);
    }
    const strippedPlural = pluralVariant(stripped);
    if (strippedPlural) {
      const spSlug = slugify(strippedPlural);
      const spMatch = index.bySpecificName.get(strippedPlural)
        || index.bySpecificSlug.get(spSlug)
        || index.byBaseName.get(strippedPlural)
        || index.byBaseSlug.get(spSlug)
        || [];
      if (spMatch.length > 0) {
        return result(spMatch, "state_stripped", 0.65);
      }
    }
  }

  // Strategy 5: Form suffix stripping
  const formStripped = stripFormSuffix(name);
  if (formStripped && formStripped.length >= 3) {
    const fsSlug = slugify(formStripped);
    const fsMatch = index.bySpecificName.get(formStripped)
      || index.bySpecificSlug.get(fsSlug)
      || index.byBaseName.get(formStripped)
      || index.byBaseSlug.get(fsSlug)
      || [];
    if (fsMatch.length > 0) {
      return result(fsMatch, "form_stripped", 0.75);
    }
  }

  // Strategy 6: Recipe aliases
  const alias = RECIPE_ALIASES.get(name);
  if (alias) {
    const aliasSlug = slugify(alias);
    const aliasMatch = index.bySpecificName.get(alias)
      || index.bySpecificSlug.get(aliasSlug)
      || index.byBaseName.get(alias)
      || index.byBaseSlug.get(aliasSlug)
      || [];
    if (aliasMatch.length > 0) {
      return result(aliasMatch, "alias", 0.7);
    }
    // Alias fallback: substring search with alias target
    if (alias.length >= 4) {
      const aliasSubMatch: number[] = [];
      for (const food of index.all) {
        if (food.description.toLowerCase().includes(alias)) {
          aliasSubMatch.push(food.fdcId);
        }
      }
      if (aliasSubMatch.length > 0 && aliasSubMatch.length <= 50) {
        return result(aliasSubMatch, "alias", 0.6);
      }
    }
  }

  // Strategy 7: Combined state strip + form suffix + alias
  if (stripped) {
    const sf = stripFormSuffix(stripped);
    if (sf && sf.length >= 3) {
      const sfSlug = slugify(sf);
      const sfMatch = index.bySpecificName.get(sf)
        || index.bySpecificSlug.get(sfSlug)
        || index.byBaseName.get(sf)
        || index.byBaseSlug.get(sfSlug)
        || [];
      if (sfMatch.length > 0) {
        return result(sfMatch, "combined_strip", 0.6);
      }
    }
    const strippedAlias = RECIPE_ALIASES.get(stripped);
    if (strippedAlias) {
      const saSlug = slugify(strippedAlias);
      const saMatch = index.bySpecificName.get(strippedAlias)
        || index.bySpecificSlug.get(saSlug)
        || index.byBaseName.get(strippedAlias)
        || index.byBaseSlug.get(saSlug)
        || [];
      if (saMatch.length > 0) {
        return result(saMatch, "combined_strip", 0.6);
      }
    }
  }

  // Strategy 7b: Leading-word strip — drop first word, retry all indexes
  // Catches: "sharp cheddar cheese" → "cheddar cheese", "yellow cake mix" → "cake mix"
  const words = name.split(" ");
  if (words.length >= 2) {
    const remainder = words.slice(1).join(" ");
    if (remainder.length >= 3) {
      const remSlug = slugify(remainder);
      const remMatch = index.bySpecificName.get(remainder)
        || index.bySpecificSlug.get(remSlug)
        || index.byBaseName.get(remainder)
        || index.byBaseSlug.get(remSlug)
        || index.byParenthetical.get(remainder)
        || [];
      if (remMatch.length > 0) {
        return result(remMatch, "leading_strip", 0.55);
      }
      // Also try plural of remainder
      const remPlural = pluralVariant(remainder);
      if (remPlural) {
        const rpSlug = slugify(remPlural);
        const rpMatch = index.bySpecificName.get(remPlural)
          || index.bySpecificSlug.get(rpSlug)
          || index.byBaseName.get(remPlural)
          || index.byBaseSlug.get(rpSlug)
          || [];
        if (rpMatch.length > 0) {
          return result(rpMatch, "leading_strip", 0.5);
        }
      }
    }
  }

  // Strategy 8: Direct substring fallback (>= 5 chars, <= 50 matches)
  if (name.length >= 5) {
    const descMatches: number[] = [];
    for (const food of index.all) {
      if (food.description.toLowerCase().includes(name)) {
        descMatches.push(food.fdcId);
      }
    }
    if (descMatches.length > 0 && descMatches.length <= 50) {
      return result(descMatches, "substring", 0.6);
    }
  }

  return result([], "none", 0);
}

// ---------------------------------------------------------------------------
// Database write (normalized schema)
// ---------------------------------------------------------------------------

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 5 });
}

async function writeMappings(
  allIngredients: RecipeIngredient[],
  matchedResults: MatchResult[],
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // -----------------------------------------------------------------------
    // 1. Populate recipe_ingredient_vocab (all ingredients, matched or not)
    // -----------------------------------------------------------------------
    console.log("  Writing recipe_ingredient_vocab...");
    const VOCAB_BATCH = 500;
    for (let i = 0; i < allIngredients.length; i += VOCAB_BATCH) {
      const batch = allIngredients.slice(i, i + VOCAB_BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      for (let j = 0; j < batch.length; j++) {
        const ing = batch[j];
        const offset = j * 4;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`
        );
        values.push(ing.name, ing.name.toLowerCase().trim(), ing.frequency, "food-com");
      }

      await client.query(
        `INSERT INTO recipe_ingredient_vocab
           (ingredient_text, ingredient_norm, count, source)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (source, ingredient_norm) DO UPDATE SET
           count = EXCLUDED.count,
           updated_at = now()`,
        values
      );
    }
    console.log(`    ${allIngredients.length} vocab entries`);

    // -----------------------------------------------------------------------
    // 2. Insert canonical_ingredient rows (one per matched ingredient)
    // -----------------------------------------------------------------------
    console.log("  Writing canonical_ingredient...");

    // Sort by frequency to assign ranks
    const sorted = [...matchedResults].sort((a, b) => b.frequency - a.frequency);
    const canonicalIds = new Map<string, string>(); // slug → canonical_id

    // Detect slug collisions — these indicate canonicalization problems
    const slugCounts = new Map<string, string[]>();
    for (const r of sorted) {
      const names = slugCounts.get(r.ingredientSlug) || [];
      names.push(r.ingredientName);
      slugCounts.set(r.ingredientSlug, names);
    }
    const collisions = [...slugCounts.entries()].filter(([, names]) => names.length > 1);
    if (collisions.length > 0) {
      console.log(`\n  ⚠ ${collisions.length} slug collisions detected:`);
      for (const [slug, names] of collisions) {
        console.log(`    ${slug}: ${names.join(" | ")}`);
      }
      console.log("  Fix these before writing — each recipe ingredient needs a unique slug.\n");
      throw new Error("Slug collisions detected — aborting write");
    }

    const CANON_BATCH = 200;
    for (let i = 0; i < sorted.length; i += CANON_BATCH) {
      const batch = sorted.slice(i, i + CANON_BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      for (let j = 0; j < batch.length; j++) {
        const r = batch[j];
        const rank = i + j + 1;
        const offset = j * 4;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`
        );
        values.push(r.ingredientName, r.ingredientSlug, rank, r.frequency);
      }

      const res = await client.query(
        `INSERT INTO canonical_ingredient
           (canonical_name, canonical_slug, canonical_rank, total_count)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (canonical_slug) DO UPDATE SET
           canonical_name = EXCLUDED.canonical_name,
           canonical_rank = EXCLUDED.canonical_rank,
           total_count = EXCLUDED.total_count,
           updated_at = now()
         RETURNING canonical_id, canonical_slug`,
        values
      );

      for (const row of res.rows) {
        canonicalIds.set(row.canonical_slug, row.canonical_id);
      }
    }
    console.log(`    ${sorted.length} canonical ingredients`);

    // -----------------------------------------------------------------------
    // 3. Insert canonical_ingredient_alias rows (from RECIPE_ALIASES)
    // -----------------------------------------------------------------------
    console.log("  Writing canonical_ingredient_alias...");
    let aliasCount = 0;

    for (const [aliasName, targetName] of RECIPE_ALIASES.entries()) {
      const targetSlug = slugify(targetName);
      // Find the canonical that the alias target maps to
      // The target might be a specific name or base name, so try the slug
      const canonId = canonicalIds.get(targetSlug);
      if (!canonId) continue;

      // Also look up the alias's own frequency from the ingredients list
      const aliasIng = allIngredients.find((ing) => ing.name === aliasName);
      const aliasFreq = aliasIng?.frequency ?? 0;

      await client.query(
        `INSERT INTO canonical_ingredient_alias
           (canonical_id, alias_norm, alias_count, alias_source)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (canonical_id, alias_norm) DO UPDATE SET
           alias_count = EXCLUDED.alias_count`,
        [canonId, aliasName, aliasFreq, "recipe-alias-map"]
      );
      aliasCount++;
    }
    console.log(`    ${aliasCount} aliases`);

    // -----------------------------------------------------------------------
    // 4. Insert canonical_fdc_membership rows (join table)
    // -----------------------------------------------------------------------
    console.log("  Writing canonical_fdc_membership...");
    let membershipCount = 0;

    const MEMBER_BATCH = 200;
    // Flatten: each (canonical, fdc_id) pair is a row, deduplicated by composite key
    const memberMap = new Map<string, { canonicalId: string; fdcId: number; reason: string }>();
    for (const r of sorted) {
      const canonId = canonicalIds.get(r.ingredientSlug);
      if (!canonId) continue;
      for (const fdcId of r.fdcIds) {
        const key = `${canonId}:${fdcId}`;
        if (!memberMap.has(key)) {
          memberMap.set(key, { canonicalId: canonId, fdcId, reason: r.matchMethod });
        }
      }
    }
    const memberRows = [...memberMap.values()];

    for (let i = 0; i < memberRows.length; i += MEMBER_BATCH) {
      const batch = memberRows.slice(i, i + MEMBER_BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const offset = j * 3;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
        values.push(row.canonicalId, row.fdcId, row.reason);
      }

      await client.query(
        `INSERT INTO canonical_fdc_membership
           (canonical_id, fdc_id, membership_reason)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (canonical_id, fdc_id) DO UPDATE SET
           membership_reason = EXCLUDED.membership_reason`,
        values
      );
      membershipCount += batch.length;
    }
    console.log(`    ${membershipCount} FDC memberships`);

    await client.query("COMMIT");
    console.log("\nAll tables populated successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const writeMode = args.includes("--write");
  const topIdx = args.indexOf("--top");
  const topN = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) : undefined;

  console.log("Loading recipe ingredients...");
  const ingredients = loadRecipeIngredients(topN);
  console.log(`  ${ingredients.length} ingredients${topN ? ` (top ${topN})` : ""}`);

  console.log("Loading FDC foods and building canonical index...");
  const foods = loadFdcFoods();
  console.log(`  ${foods.length} FDC foods canonicalized`);
  const index = buildFdcIndex(foods);
  console.log(`  ${index.bySpecificName.size} unique canonical specific names`);

  console.log("\nMatching recipe ingredients to FDC foods...\n");
  const results: MatchResult[] = [];
  for (const ing of ingredients) {
    results.push(matchIngredient(ing, index));
  }

  // Stats
  const matched = results.filter((r) => r.fdcIds.length > 0);
  const unmatched = results.filter((r) => r.fdcIds.length === 0);

  const byMethod = new Map<string, MatchResult[]>();
  for (const r of results) {
    const list = byMethod.get(r.matchMethod) || [];
    list.push(r);
    byMethod.set(r.matchMethod, list);
  }

  console.log("=".repeat(70));
  console.log("RECIPE INGREDIENT MAPPING REPORT");
  console.log("=".repeat(70));
  console.log(`Total recipe ingredients:  ${results.length}`);
  console.log(`Matched:                   ${matched.length} (${pct(matched.length, results.length)})`);
  for (const [method, items] of [...byMethod.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (method === "none") continue;
    console.log(`  ${method.padEnd(22)} ${String(items.length).padStart(4)} (${pct(items.length, results.length)})`);
  }
  console.log(`Unmatched:                 ${unmatched.length} (${pct(unmatched.length, results.length)})`);

  const totalFreq = results.reduce((s, r) => s + r.frequency, 0);
  const matchedFreq = matched.reduce((s, r) => s + r.frequency, 0);
  console.log(`\nFrequency coverage:        ${pct(matchedFreq, totalFreq)} of recipe usages have FDC matches`);

  // Top matches by method
  const methodOrder = ["canonical_bridge", "base_bridge", "plural_bridge", "state_stripped", "substring"];
  for (const method of methodOrder) {
    const items = byMethod.get(method);
    if (!items || items.length === 0) continue;
    console.log("\n" + "-".repeat(70));
    console.log(`TOP ${method.toUpperCase()} MATCHES (by recipe frequency)`);
    console.log("-".repeat(70));
    const top = items.sort((a, b) => b.frequency - a.frequency).slice(0, 20);
    for (const r of top) {
      console.log(`  ${String(r.frequency).padStart(7)}  ${r.ingredientName.padEnd(35)}  → ${r.fdcIds.length} FDC foods  (conf=${r.matchConfidence})`);
    }
  }

  // Top unmatched
  console.log("\n" + "-".repeat(70));
  console.log("TOP UNMATCHED (highest recipe frequency — most impactful gaps)");
  console.log("-".repeat(70));
  const topUnmatched = unmatched
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 40);
  for (const r of topUnmatched) {
    console.log(`  ${String(r.frequency).padStart(7)}  ${r.ingredientName}`);
  }

  if (writeMode) {
    console.log("\nWriting to database (normalized schema)...");
    await writeMappings(ingredients, matched);
  } else {
    console.log("\nDry run (use --write to insert into database)");
  }
}

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${((n / total) * 100).toFixed(1)}%`;
}

main().catch(console.error);
