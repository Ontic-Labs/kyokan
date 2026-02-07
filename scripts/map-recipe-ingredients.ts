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
import * as readline from "readline";
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
  dataType: "sr_legacy" | "foundation" | "branded";
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

function loadRecipeIngredients(topN?: number, minFreq?: number): RecipeIngredient[] {
  const path = "data/recipe-ingredients.json";
  if (!fs.existsSync(path)) {
    throw new Error(`${path} not found. Run: npx tsx scripts/extract-recipe-ingredients.ts`);
  }
  const raw: RecipeIngredient[] = JSON.parse(fs.readFileSync(path, "utf-8"));
  // Sanitize CSV artifacts (trailing quotes/commas from bad CSV parsing),
  // then merge entries that collapse to the same name after cleanup.
  const cleaned = new Map<string, number>();
  for (const ing of raw) {
    const clean = ing.name.replace(/["]+,?$/g, "").replace(/^["]+/g, "").trim();
    if (!clean || clean === "," || clean.length < 2) continue;
    cleaned.set(clean, (cleaned.get(clean) || 0) + ing.frequency);
  }
  // Apply preNormalize and merge again — "lemon, juice of" and "lemon juice"
  // collapse to the same canonical identity, summing their frequencies.
  const merged = new Map<string, number>();
  for (const [name, freq] of cleaned.entries()) {
    const norm = preNormalize(name);
    if (!norm || norm.length < 2) continue;
    merged.set(norm, (merged.get(norm) || 0) + freq);
  }
  // Detect and merge slug collisions early — e.g. "jalapeño peppers" and "jalapeno peppers"
  // both slugify to "jalapeno-peppers". Pick the higher-frequency name as canonical.
  const bySlug = new Map<string, { name: string; frequency: number }>();
  const slugCollisions: string[] = [];
  for (const [name, freq] of merged.entries()) {
    const s = slugify(name);
    const existing = bySlug.get(s);
    if (existing) {
      slugCollisions.push(`  ${s}: "${existing.name}" (${existing.frequency}) + "${name}" (${freq}) → merged`);
      if (freq > existing.frequency) existing.name = name;
      existing.frequency += freq;
    } else {
      bySlug.set(s, { name, frequency: freq });
    }
  }
  if (slugCollisions.length > 0) {
    console.log(`  ${slugCollisions.length} slug collisions merged at load time:`);
    for (const line of slugCollisions) console.log(line);
  }
  let all = [...bySlug.values()]
    .sort((a, b) => b.frequency - a.frequency);
  if (minFreq) all = all.filter((x) => x.frequency >= minFreq);
  return topN ? all.slice(0, topN) : all;
}

async function loadFdcFoods(): Promise<FdcFood[]> {
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
        dataType: "sr_legacy",
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
        dataType: "foundation",
        baseName: canonical.baseName,
        baseSlug: canonical.baseSlug,
        specificName: canonical.specificName,
        specificSlug: canonical.specificSlug,
      });
    }
  }

  // Branded (cookable only, pre-filtered by filter-branded-cookable.ts)
  const brandedPath = "fdc/branded_cookable.jsonl";
  if (fs.existsSync(brandedPath)) {
    let brandedCount = 0;
    const rl = readline.createInterface({
      input: fs.createReadStream(brandedPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const f = JSON.parse(line);
        if (!f.description || !f.fdcId) continue;
        const canonical = canonicalizeDescription(f.description);
        foods.push({
          fdcId: f.fdcId,
          description: f.description,
          isCookable: true,
          dataType: "branded",
          baseName: canonical.baseName,
          baseSlug: canonical.baseSlug,
          specificName: canonical.specificName,
          specificSlug: canonical.specificSlug,
        });
        brandedCount++;
        if (brandedCount % 50000 === 0) {
          process.stdout.write(`\r  ${brandedCount.toLocaleString()} branded foods loaded...`);
        }
      } catch {
        // Skip malformed lines
      }
    }
    console.log(`\r  ${brandedCount.toLocaleString()} branded foods loaded    `);
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
/** Parenthetical content that is NOT an alternate food name. */
const PAREN_NOISE_PATTERNS = [
  /\bincludes?\b/i,    // "includes yellow and white"
  /\bformerly\b/i,     // "formerly vitamin A"
  /\bUSDA\b/i,         // "USDA commodity"
  /\bpreviously\b/i,   // "previously called ..."
  /\bsee\b/i,          // "see footnote"
  /\bNFS\b/,           // "NFS" = not further specified
  /\bnot\b/i,          // "not packed in oil"
  /^\d/,               // starts with number (e.g. "2% milkfat")
  /\d+\s*(mg|g|mcg|iu|%)/i,  // measurement/nutrient values
];

function extractParentheticals(description: string): string[] {
  const matches = description.match(/\(([^)]+)\)/g);
  if (!matches) return [];
  return matches
    .map((m) => m.slice(1, -1).trim().toLowerCase())
    .filter((s) => {
      if (s.length < 3) return false;
      for (const pattern of PAREN_NOISE_PATTERNS) {
        if (pattern.test(s)) return false;
      }
      return true;
    });
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
  // "X, rind of" → "X rind"
  n = n.replace(/^(.+),\s*rind of$/i, "$1 rind");
  // "X, juice and zest of" → "X juice" (primary component)
  n = n.replace(/^(.+),\s*juice and zest of$/i, "$1 juice");
  // Leading "of " (e.g. "of fresh mint")
  n = n.replace(/^of\s+/i, "");
  // "&" → "and" for consistency
  n = n.replace(/\s*&\s*/g, " and ");
  // Strip leading percentage (e.g. "2% low-fat milk" → "low-fat milk", "100% whole wheat" → "whole wheat")
  // Only strip when % is present to avoid breaking "3 musketeers" style brand names
  n = n.replace(/^\d+%\s+/, "");

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
  // Marketing/preparation modifiers (no nutritional change)
  "plain", "seasoned", "italian", "freshly ground",
  "old fashioned", "old-fashioned", "instant", "quick",
  "reduced-sodium", "low-sodium", "low sodium",
  "low-fat", "low fat", "nonfat", "non-fat",
  "self raising", "self-raising", "self rising", "self-rising",
  "pure", "organic", "natural", "regular",
  "refrigerated", "flaked", "whole",
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
  "flakes", "flake",
  "wedges", "wedge",
  "sprigs", "sprig",
  "rings", "ring",
  "slices", "slice",
  "chunks", "chunk",
  "segments", "segment",
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
  // "oil" alias removed — target "vegetable" is ambiguous (matches vegetables too)
  ["sesame oil", "sesame"],
  ["peanut oil", "peanut"],
  ["canola oil", "canola"],
  // Salt — FDC base "salt"
  ["kosher salt", "salt"],
  ["sea salt", "salt"],
  ["table salt", "salt"],
  // "garlic salt" and "seasoning salt" removed — these are blends with
  // different nutrient profiles (sodium + garlic powder, sodium + spices).
  // They should resolve to their own canonicals, not alias to pure salt.
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
  // "lean ground beef" removed — should be its own canonical with ≥90% lean
  // FDC entries only (USDA definition of "lean"). Post-match filter handles this.
  ["ground chuck", "ground beef"],
  // Chicken stock — FDC "Soup, stock, chicken" → base "soup" (too broad); let substring find it
  // (removed: "chicken stock"→"soup" maps stock to all soups)
  // Eggs — FDC base "egg"
  ["egg whites", "egg"],
  ["egg yolks", "egg"],
  // Onion/pepper variants — pluralVariants() handles singular↔plural automatically
  // (removed: "green onions"→"green onion" and "red onion"→"red onions" — handled by pluralVariants)
  ["red bell pepper", "bell peppers"],
  ["green bell pepper", "bell peppers"],
  ["cayenne pepper", "red or cayenne pepper"],
  ["jalapenos", "jalapeno peppers"],
  ["jalapeno", "jalapeno peppers"],
  // Bread
  ["breadcrumbs", "bread crumbs"],
  // (removed: "bay leaves"→"bay leaf" — handled by pluralVariants -ves→-f)
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
  // Hot sauce — FDC "Sauce, hot chile, sriracha" → base "hot chile"; let substring find sauces
  // (removed: "hot sauce"→"hot chile" maps hot sauce to chile pepper, wrong nutrients)
  // (removed: "tabasco sauce"→"pepper" matches generic peppers, not the sauce)
  // (removed: "spaghetti sauce"→"pasta" maps sauce to dry pasta, wrong nutrients)
  ["hoisin sauce", "hoisin"],         // "Sauce, hoisin" → base "hoisin"
  // Misc
  ["worcestershire sauce", "worcestershire"],
  ["dijon mustard", "mustard"],
  ["tomato paste", "tomato products"],
  ["white wine", "wine"],
  ["dry white wine", "wine"],
  // "italian seasoning" alias removed — spice blend ≠ single herb; let substring match
  // Zest — FDC base is plural ("oranges", "lemons")
  ["orange zest", "oranges"],
  ["lemon zest", "lemons"],
  ["orange rind", "oranges"],
  ["lemon rind", "lemons"],
  // Oats — FDC base "oats"
  ["rolled oats", "oats"],
  // Yeast → FDC "Leavening agents, yeast, baker's" → base "leavening agents"
  ["active dry yeast", "leavening agents"],
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
  // (removed: "potato"→"potatoes" — handled by pluralVariants)
  // UK/AU variants
  ["plain flour", "wheat flour"],
  ["caster sugar", "sugar"],
  ["icing sugar", "sugar"],
  // Sherry — not in SR Legacy data, skip
  // (removed: dry sherry alias pointed to nonexistent FDC food)
  // "fish sauce" alias removed — fish sauce ≠ fish nutritionally; let substring match FDC "Fish sauce"
  // Apple cider vinegar — FDC specific "cider vinegar"
  ["apple cider vinegar", "cider vinegar"],
  // "cooking oil" alias removed — "vegetable" is ambiguous; let substring match FDC "Oil, vegetable"
  // Almond extract — FDC "Extract, almond" → specific "almond extract"
  // (removed: "almond extract" not in FDC index; substring finds it)
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
  // (removed: "chicken broth"/"vegetable stock"→"soup" maps broth to all soups; let substring find them)
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
  // Graham crackers — target "crackers" so substring finds "Crackers, graham"
  ["graham cracker crumbs", "crackers"],
  ["graham crackers", "crackers"],
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
  // (removed: "fresh coriander" → "coriander seed" — fresh herb ≠ dried seed nutritionally; let substring find "coriander leaves")
  // Cornflour (UK term for cornstarch)
  ["cornflour", "cornstarch"],
  // Soy sauce variants
  ["low sodium soy sauce", "soy sauce"],
  // Flour variants
  ["unbleached all-purpose flour", "wheat flour"],
  ["self-rising flour", "wheat flour"],
  // Tomato
  ["tomato puree", "tomato products"],
  // Apple cider — FDC "Apple cider, unsweetened" → base "apple cider"
  // (removed: "apple cider" not in FDC index; substring finds it)
  // Olive oil — FDC "Oil, olive, salad or cooking" → base "olive"
  ["olive oil", "olive"],
  // (removed: "zucchini" → "squash" too generic; substring finds "Squash, summer, zucchini" directly)
  // Cayenne — FDC "Spices, pepper, red or cayenne"
  ["cayenne", "red or cayenne pepper"],
  // Coriander — FDC "Spices, coriander seed"
  ["coriander", "coriander seed"],
  // Cooking spray — FDC "Cooking spray, original"
  ["cooking spray", "cooking spray"],
  ["nonstick cooking spray", "cooking spray"],
  // Strawberry → FDC "Strawberries, raw"
  ["strawberry", "strawberries"],
  // Long grain rice → FDC "Rice, white, long-grain, regular"
  ["long grain rice", "rice"],
  // Dry yeast → FDC "Leavening agents, yeast, baker's" → base "leavening agents"
  ["dry yeast", "leavening agents"],
  // (removed: "crabmeat"/"crab meat" → "crustaceans" too generic; substring finds "Crustaceans, crab" directly)
  // Linguine → FDC pasta
  ["linguine", "pasta"],
  ["fettuccine", "pasta"],
  ["penne", "pasta"],
  ["rotini", "pasta"],
  // Prosciutto → FDC "Pork, cured, ham, prosciutto" → base "pork"; let substring find it
  // (removed: "prosciutto" is not an FDC base/specific name)
  // Artichoke hearts → FDC "Artichokes"
  ["artichoke hearts", "artichokes"],
  ["artichoke", "artichokes"],
  // Dry sherry → FDC "Alcoholic beverage, wine, table, white"
  ["dry sherry", "wine"],
  ["sherry", "wine"],
  // Cooking wine
  ["cooking wine", "wine"],
  ["red cooking wine", "wine"],
  // Corn — FDC "Corn, sweet"
  ["corn", "corn"],
  // Pumpkin — FDC "Pumpkin, canned" or "Pumpkin, raw"
  ["pumpkin puree", "pumpkin"],
  ["canned pumpkin", "pumpkin"],
  // Coconut — FDC base "coconut"
  ["shredded coconut", "coconut"],
  ["coconut flakes", "coconut"],
  // Raisins — FDC "Raisins"
  ["golden raisins", "raisins"],
  // (removed: "cream of mushroom/chicken soup" → "soup" too generic; substring finds specific cream soups)
  // Evaporated milk — FDC "Milk, canned, evaporated" → specific "evaporated milk"; substring finds it
  // (removed: "evaporated milk" may not be in FDC index as specific name)
  // (removed: "cool whip"→"cream" maps non-dairy product to cream)
  // "bean sprouts" alias removed — sprouts ≠ beans nutritionally; let substring match FDC "Mung beans, mature seeds, sprouted"
  // (removed: ["capers", "capers"] was a no-op alias)
  // Water chestnuts — FDC "Waterchestnuts, chinese, canned" → let substring find it
  // (removed: "water chestnuts" is not an FDC base/specific name)
  // Balsamic vinegar
  ["balsamic vinegar", "vinegar"],
  // Mozzarella
  ["fresh mozzarella", "mozzarella cheese"],
  // Ranch dressing → FDC "Salad dressing" base is "mayonnaise"; let substring find it
  // (removed: "salad dressing" is not an FDC base/specific name)
]);

/**
 * Generate plausible singular/plural variants of a name.
 * Returns an array of candidates (may be empty if no rules apply).
 * Handles common English inflection patterns that the naive "slice -s" misses:
 *   tomatoes → tomato, cheese (no change), leaves → leaf, berries → berry
 */
function pluralVariants(name: string): string[] {
  const variants: string[] = [];

  // --- Plural → singular ---
  if (name.endsWith("ies") && name.length > 4) {
    // berries → berry, cherries → cherry
    variants.push(name.slice(0, -3) + "y");
  } else if (name.endsWith("ves")) {
    // loaves → loaf, halves → half, leaves → leaf
    variants.push(name.slice(0, -3) + "f");
    variants.push(name.slice(0, -3) + "fe");
  } else if (name.endsWith("oes") && name.length > 4) {
    // tomatoes → tomato, potatoes → potato
    variants.push(name.slice(0, -2));
  } else if (
    name.endsWith("ches") || name.endsWith("shes") ||
    name.endsWith("sses") || name.endsWith("xes") || name.endsWith("zes")
  ) {
    // peaches → peach, dishes → dish, boxes → box
    variants.push(name.slice(0, -2));
  } else if (name.endsWith("s") && !name.endsWith("ss") && !name.endsWith("us")) {
    // carrots → carrot, lemons → lemon
    // But NOT "cheese" (ends in 'e', not 's' as last char — wait it does end in 'e')
    // "cheese" ends in 'e' not 's', so this branch won't fire for it. Correct.
    variants.push(name.slice(0, -1));
  }

  // --- Singular → plural ---
  if (!name.endsWith("s")) {
    variants.push(name + "s");
    if (name.endsWith("ch") || name.endsWith("sh") || name.endsWith("x") || name.endsWith("z")) {
      variants.push(name + "es");
    }
    if (name.endsWith("y") && name.length > 2) {
      variants.push(name.slice(0, -1) + "ies");
    }
    if (name.endsWith("f")) {
      variants.push(name.slice(0, -1) + "ves");
    }
    if (name.endsWith("fe")) {
      variants.push(name.slice(0, -2) + "ves");
    }
    if (name.endsWith("o") && name.length > 2) {
      variants.push(name + "es");
    }
  }

  return variants.filter((v) => v !== name && v.length >= 3);
}

// ---------------------------------------------------------------------------
// Matching strategies
// ---------------------------------------------------------------------------

/** Try all plural variants of `name` against the index maps. Returns first match or []. */
function tryPluralVariants(
  name: string,
  ...maps: Map<string, number[]>[]
): number[] {
  for (const variant of pluralVariants(name)) {
    const vSlug = slugify(variant);
    for (const map of maps) {
      const match = map.get(variant) || map.get(vSlug);
      if (match && match.length > 0) return match;
    }
  }
  return [];
}

/** Data source priority: SR Legacy (0) > Foundation (1) > Branded (2) */
const DATA_TYPE_PRIORITY: Record<string, number> = {
  sr_legacy: 0,
  foundation: 1,
  branded: 2,
};

/**
 * Sort FDC foods by data source priority, returning their IDs.
 * With many branded matches, prefer SR Legacy/Foundation results.
 * If more than `cap` total matches, keep only SR Legacy + Foundation.
 * If still over cap, keep only SR Legacy.
 * Final fallback: return up to `cap` items sorted by priority.
 */
function prioritizeFdcMatches(foods: FdcFood[], cap: number): number[] {
  if (foods.length === 0) return [];

  // Sort by priority
  const sorted = [...foods].sort(
    (a, b) => DATA_TYPE_PRIORITY[a.dataType] - DATA_TYPE_PRIORITY[b.dataType]
  );

  if (sorted.length <= cap) {
    return sorted.map((f) => f.fdcId);
  }

  // Over cap: try SR Legacy + Foundation only
  const srAndFn = sorted.filter((f) => f.dataType !== "branded");
  if (srAndFn.length > 0 && srAndFn.length <= cap) {
    return srAndFn.map((f) => f.fdcId);
  }

  // Still over cap: try SR Legacy only
  const srOnly = sorted.filter((f) => f.dataType === "sr_legacy");
  if (srOnly.length > 0 && srOnly.length <= cap) {
    return srOnly.map((f) => f.fdcId);
  }

  // Still over cap or no SR matches: return first `cap` items by priority
  if (srOnly.length > 0) return srOnly.slice(0, cap).map((f) => f.fdcId);
  if (srAndFn.length > 0) return srAndFn.slice(0, cap).map((f) => f.fdcId);
  return sorted.slice(0, cap).map((f) => f.fdcId);
}

function matchIngredient(ingredient: RecipeIngredient, index: FdcIndex): MatchResult {
  // ingredient.name is already preNormalized during loading (loadRecipeIngredients
  // applies preNormalize and merges colliding forms like "lemon, juice of" + "lemon juice").
  const name = ingredient.name;
  const slug = slugify(name);

  const result = (fdcIds: number[], method: string, confidence: number): MatchResult => ({
    ingredientName: name,
    ingredientSlug: slug,
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
  const pSpecMatch = tryPluralVariants(name, index.bySpecificName, index.bySpecificSlug);
  if (pSpecMatch.length > 0) {
    return result(pSpecMatch, "plural_bridge", 0.85);
  }
  const pBaseMatch = tryPluralVariants(name, index.byBaseName, index.byBaseSlug);
  if (pBaseMatch.length > 0) {
    return result(pBaseMatch, "plural_bridge", 0.8);
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
    const spMatch = tryPluralVariants(
      stripped, index.bySpecificName, index.bySpecificSlug, index.byBaseName, index.byBaseSlug
    );
    if (spMatch.length > 0) {
      return result(spMatch, "state_stripped", 0.65);
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
    // Alias fallback: substring search with alias target, prioritized by data source
    if (alias.length >= 4) {
      const aliasSubFoods: FdcFood[] = [];
      for (const food of index.all) {
        if (food.description.toLowerCase().includes(alias)) {
          aliasSubFoods.push(food);
        }
      }
      const aliasPrioritized = prioritizeFdcMatches(aliasSubFoods, 200);
      if (aliasPrioritized.length > 0) {
        return result(aliasPrioritized, "alias", 0.6);
      }
    }
  }

  // Strategy 7: Combined state strip + form suffix + alias + plural + parenthetical
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
      // Also try plural of state+form stripped result
      const sfpMatch = tryPluralVariants(
        sf, index.bySpecificName, index.bySpecificSlug, index.byBaseName, index.byBaseSlug
      );
      if (sfpMatch.length > 0) {
        return result(sfpMatch, "combined_strip", 0.55);
      }
      // Also try parenthetical match on state+form stripped result
      // "fresh cilantro leaves" → "cilantro" → parenthetical match
      const sfParenMatch = index.byParenthetical.get(sf)
        || index.byParenthetical.get(sfSlug)
        || [];
      if (sfParenMatch.length > 0) {
        return result(sfParenMatch, "combined_strip", 0.55);
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
    // State-stripped + leading-word strip
    // "italian seasoned breadcrumbs" → strip "italian","seasoned" → "breadcrumbs" → match
    // "reduced-sodium chicken broth" → strip "reduced-sodium" → "chicken broth" → substring
    const strippedWords = stripped.split(" ");
    if (strippedWords.length >= 2) {
      const strippedRemainder = strippedWords.slice(1).join(" ");
      if (strippedRemainder.length >= 3) {
        const srSlug = slugify(strippedRemainder);
        const srMatch = index.bySpecificName.get(strippedRemainder)
          || index.bySpecificSlug.get(srSlug)
          || index.byBaseName.get(strippedRemainder)
          || index.byBaseSlug.get(srSlug)
          || index.byParenthetical.get(strippedRemainder)
          || [];
        if (srMatch.length > 0) {
          return result(srMatch, "combined_strip", 0.5);
        }
        const srpMatch = tryPluralVariants(
          strippedRemainder, index.bySpecificName, index.bySpecificSlug, index.byBaseName, index.byBaseSlug
        );
        if (srpMatch.length > 0) {
          return result(srpMatch, "combined_strip", 0.45);
        }
      }
    }
  }

  // Strategy 7b: Leading-word strip — drop first word, retry all indexes
  // Catches: "sharp cheddar cheese" → "cheddar cheese", "yellow cake mix" → "cake mix"
  // Skip if the first word is a meaningful modifier that changes the nutrient profile.
  const MEANINGFUL_MODIFIERS = new Set([
    "brown", "dark", "sweet", "white", "black", "red", "green", "yellow",
    "wild", "whole", "coconut", "almond", "rice", "soy", "oat",
  ]);
  const words = name.split(" ");
  if (words.length >= 2 && !MEANINGFUL_MODIFIERS.has(words[0])) {
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
      const rpMatch = tryPluralVariants(
        remainder, index.bySpecificName, index.bySpecificSlug, index.byBaseName, index.byBaseSlug
      );
      if (rpMatch.length > 0) {
        return result(rpMatch, "leading_strip", 0.5);
      }
    }
  }

  // Strategy 8: Direct substring fallback (>= 3 chars, prioritized by data source)
  if (name.length >= 3) {
    const descMatchFoods: FdcFood[] = [];
    for (const food of index.all) {
      if (food.description.toLowerCase().includes(name)) {
        descMatchFoods.push(food);
      }
    }
    const prioritized = prioritizeFdcMatches(descMatchFoods, 200);
    if (prioritized.length > 0) {
      return result(prioritized, "substring", 0.6);
    }
  }

  return result([], "none", 0);
}

// ---------------------------------------------------------------------------
// Post-match FDC membership filters
//
// Certain canonical ingredients need their FDC membership narrowed based on
// description content. This runs AFTER matching to avoid complicating the
// matching strategies. The filter returns the subset of FDC IDs that are
// appropriate for the canonical identity.
// ---------------------------------------------------------------------------

type FdcFilter = (fdcIds: number[], foodsById: Map<number, FdcFood>) => number[];

/**
 * Filter ground beef by lean percentage in FDC description.
 * USDA fat ratio patterns: "80% lean meat / 20% fat", "95% lean meat / 5% fat"
 */
function filterByLeanPercentage(minLean: number): FdcFilter {
  return (fdcIds, foodsById) => {
    const leanPattern = /(\d+)%\s*lean/i;
    const filtered = fdcIds.filter((id) => {
      const food = foodsById.get(id);
      if (!food) return false;
      const match = food.description.match(leanPattern);
      if (!match) {
        // No lean percentage in description — include only if description
        // doesn't mention a fat ratio at all (e.g. "Beef, ground, unspecified")
        return !food.description.includes("% lean") && !food.description.includes("% fat");
      }
      return parseInt(match[1], 10) >= minLean;
    });
    return filtered.length > 0 ? filtered : fdcIds; // fallback to all if filter eliminates everything
  };
}

/** Map of canonical slug → FDC membership filter function */
const POST_MATCH_FILTERS = new Map<string, FdcFilter>([
  // "lean ground beef" should only include ≥90% lean entries (USDA definition)
  ["lean-ground-beef", filterByLeanPercentage(90)],
  // "extra lean ground beef" should only include ≥95% lean entries
  ["extra-lean-ground-beef", filterByLeanPercentage(95)],
]);

function applyPostMatchFilters(
  results: MatchResult[],
  foods: FdcFood[],
): void {
  const foodsById = new Map<number, FdcFood>();
  for (const f of foods) foodsById.set(f.fdcId, f);

  for (const r of results) {
    const filter = POST_MATCH_FILTERS.get(r.ingredientSlug);
    if (filter && r.fdcIds.length > 0) {
      const before = r.fdcIds.length;
      r.fdcIds = filter(r.fdcIds, foodsById);
      if (r.fdcIds.length !== before) {
        console.log(`  POST-FILTER: ${r.ingredientName}: ${before} → ${r.fdcIds.length} FDC foods`);
      }
    }
  }
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
        // ingredient_norm stores human-readable normalized form (lowercase, trimmed).
        // JOINs to canonical_ingredient go through canonical_ingredient_alias, not direct slug match.
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

    // Slug collisions are now detected and merged at load time in loadRecipeIngredients().
    // Any remaining collisions here would be a bug in the load phase.

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

    // Pre-build memberMap so alias section can add to it before the membership write phase
    const memberMap = new Map<string, { canonicalId: string; fdcId: number; reason: string }>();
    for (const r of sorted) {
      const cid = canonicalIds.get(r.ingredientSlug);
      if (!cid) continue;
      for (const fdcId of r.fdcIds) {
        const key = `${cid}:${fdcId}`;
        if (!memberMap.has(key)) {
          memberMap.set(key, { canonicalId: cid, fdcId, reason: r.matchMethod });
        }
      }
    }

    // -----------------------------------------------------------------------
    // 3. Insert canonical_ingredient_alias rows (from RECIPE_ALIASES)
    // -----------------------------------------------------------------------
    console.log("  Writing canonical_ingredient_alias...");
    let aliasCount = 0;

    let aliasSkipped = 0;
    for (const [aliasName, targetName] of RECIPE_ALIASES.entries()) {
      const targetSlug = slugify(targetName);
      let canonId = canonicalIds.get(targetSlug);

      // If target canonical doesn't exist (target isn't a recipe ingredient itself),
      // create it on-demand so the alias has somewhere to point.
      if (!canonId) {
        // Only create if the alias itself was a matched recipe ingredient
        const aliasResult = matchedResults.find((r) => r.ingredientName === aliasName);
        if (!aliasResult) {
          aliasSkipped++;
          continue;
        }
        // Create canonical for the alias target with the alias's frequency
        const res = await client.query(
          `INSERT INTO canonical_ingredient
             (canonical_name, canonical_slug, canonical_rank, total_count)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (canonical_slug) DO UPDATE SET
             total_count = canonical_ingredient.total_count + EXCLUDED.total_count,
             updated_at = now()
           RETURNING canonical_id, canonical_slug`,
          [targetName, targetSlug, sorted.length + aliasCount + 1, aliasResult.frequency]
        );
        const newCanonId: string = res.rows[0].canonical_id;
        canonId = newCanonId;
        canonicalIds.set(targetSlug, newCanonId);

        // Also register FDC memberships for this new canonical
        for (const fdcId of aliasResult.fdcIds) {
          const key = `${newCanonId}:${fdcId}`;
          if (!memberMap.has(key)) {
            memberMap.set(key, { canonicalId: newCanonId, fdcId, reason: aliasResult.matchMethod });
          }
        }
      }

      if (!canonId) continue; // shouldn't happen — guard for TypeScript

      // Look up the alias's own frequency from the ingredients list
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
    if (aliasSkipped > 0) {
      console.log(`    ${aliasSkipped} aliases skipped (neither alias nor target is a matched ingredient)`);
    }
    console.log(`    ${aliasCount} aliases`);

    // -----------------------------------------------------------------------
    // 4. Insert canonical_fdc_membership rows (join table)
    // -----------------------------------------------------------------------
    console.log("  Writing canonical_fdc_membership...");
    let membershipCount = 0;

    // Validate FDC IDs against the remote DB — branded foods may not be loaded yet
    const validFdcRes = await client.query("SELECT fdc_id FROM foods");
    const validFdcIds = new Set(validFdcRes.rows.map((r: { fdc_id: number }) => Number(r.fdc_id)));
    console.log(`    ${validFdcIds.size} valid FDC IDs in remote DB`);
    const allMemberRows = [...memberMap.values()];
    const memberRows = allMemberRows.filter((r) => validFdcIds.has(r.fdcId));
    const skippedMembers = allMemberRows.length - memberRows.length;
    if (skippedMembers > 0) {
      console.log(`    ${skippedMembers} memberships skipped (FDC IDs not in remote DB, e.g. branded foods)`);
    }

    const MEMBER_BATCH = 200;

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
  const minFreqIdx = args.indexOf("--min-freq");
  const DEFAULT_MIN_FREQ = 25; // per spec: count >= 25 filters noise while keeping 98%+ real ingredients
  const minFreq = minFreqIdx >= 0 ? parseInt(args[minFreqIdx + 1], 10) : DEFAULT_MIN_FREQ;

  console.log("Loading recipe ingredients...");
  const ingredients = loadRecipeIngredients(topN, minFreq);
  const filters = [topN && `top ${topN}`, minFreq && `freq >= ${minFreq}`].filter(Boolean).join(", ");
  console.log(`  ${ingredients.length} ingredients${filters ? ` (${filters})` : ""}`);

  console.log("Loading FDC foods and building canonical index...");
  const foods = await loadFdcFoods();
  console.log(`  ${foods.length} FDC foods canonicalized`);
  const index = buildFdcIndex(foods);
  console.log(`  ${index.bySpecificName.size} unique canonical specific names`);

  // Validate alias targets against FDC index — warn on orphaned aliases
  const orphanedAliases: string[] = [];
  for (const [aliasName, targetName] of RECIPE_ALIASES.entries()) {
    const targetSlug = slugify(targetName);
    const found =
      index.bySpecificName.has(targetName) || index.bySpecificSlug.has(targetSlug) ||
      index.byBaseName.has(targetName) || index.byBaseSlug.has(targetSlug);
    if (!found) {
      orphanedAliases.push(`  ${aliasName} -> ${targetName} (slug: ${targetSlug})`);
    }
  }
  if (orphanedAliases.length > 0) {
    console.log(`\nWARNING: ${orphanedAliases.length} alias targets not found in FDC index:`);
    for (const line of orphanedAliases) console.log(line);
    console.log("  These aliases will fall back to substring search.\n");
  }

  console.log("\nMatching recipe ingredients to FDC foods...");
  const results: MatchResult[] = [];
  for (let i = 0; i < ingredients.length; i++) {
    results.push(matchIngredient(ingredients[i], index));
    if ((i + 1) % 500 === 0 || i === ingredients.length - 1) {
      const matched = results.filter((r) => r.fdcIds.length > 0).length;
      process.stdout.write(`\r  ${i + 1}/${ingredients.length} processed, ${matched} matched...`);
    }
  }
  console.log("");

  // Apply post-match filters (e.g. lean ground beef → ≥90% lean only)
  applyPostMatchFilters(results, foods);

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
