/**
 * Lexical Entity-Mapping Scorer
 *
 * Pure, deterministic scoring functions for matching recipe ingredient names
 * to USDA FDC food descriptions using hybrid lexical similarity.
 *
 * Architecture:
 *   - Tokenizer-driven boundary correctness (no inner-loop regex)
 *   - Two-channel tokens: core (identity) + state (cooking/preservation)
 *   - IDF-weighted directional token overlap
 *   - Jaro-Winkler gated by token evidence
 *   - Segment-level matching (USDA comma structure)
 *   - Category affinity (versioned lexicon)
 *   - Synonym confirmation (gated)
 *
 * No AI. No database access. Fully testable.
 *
 * CHANGELOG:
 * 2026-02-03 — Red team fixes:
 *   - P0: resolveInvertedName now returns "olive oil" not just "olive" for container categories
 *   - P0: SYNONYM_TABLE lookup now uses slug (normalized) instead of raw ingredient.normalized
 *   - P1: Added irregular plurals (fish, sheep, teeth, mice, geese, dice)
 *   - P3: Added design rationale comment for STATE_TOKEN_SET excluding "cooking"
 */

import {
  slugify,
  CONTAINER_CATEGORIES,
  POULTRY_TYPE_CLASSIFIERS as POULTRY_CLASSIFIERS,
  PROTEIN_BASES,
  PRODUCT_FORMS,
} from "./canonicalize";

// Re-export for convenience
export { slugify };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessedFdcFood {
  fdcId: number;
  description: string;
  dataType: "sr_legacy" | "foundation";
  categoryName: string | null;

  // Pre-computed at load time:
  descLower: string;
  segments: string[];             // comma-split segments, trimmed, lowercase
  coreTokens: string[];           // identity tokens (state removed)
  coreTokenSet: Set<string>;
  stateTokens: string[];          // cooking/preservation tokens found
  segmentTokenSets: Set<string>[]; // per-segment core token sets
  invertedName: string;           // human-readable form ("olive oil")
  plainWords: string;             // core tokens joined with spaces
  parentheticals: string[];       // alternate names from (...)
  slug: string;
}

export interface ProcessedIngredient {
  raw: string;
  normalized: string;
  coreTokens: string[];
  coreTokenSet: Set<string>;
  stateTokens: string[];
  slug: string;
  totalWeight: number;            // W_I = Σ w(t) for t in coreTokens
  matchableWeight: number;        // W_M = Σ w(t) for matchable tokens (df>0 or plural variant df>0)
}

export interface ScoredMatch {
  fdcId: number;
  score: number;
  reason: string;
  breakdown: {
    overlap: number;
    jwGated: number;
    segment: number;
    affinity: number;
    synonym: number;
  };
}

// ---------------------------------------------------------------------------
// State token classifier σ()
// ---------------------------------------------------------------------------

/**
 * Deterministic set of tokens that represent cooking/preservation/processing
 * state rather than food identity. Used to split tokens into two channels.
 *
 * DESIGN NOTE: "cooking" is intentionally NOT in this set. While it describes
 * a process, it also appears as identity in FDC descriptions like "cooking oil",
 * "cooking spray", "cooking wine". Removing it would break those matches.
 * Similarly, "baking" is not included because of "baking powder", "baking soda".
 */
const STATE_TOKEN_SET = new Set([
  // Cooking states
  "raw", "cooked",
  // Cooking methods (past tense)
  "baked", "blanched", "boiled", "braised", "broiled", "fried", "grilled",
  "microwaved", "poached", "roasted", "sauteed", "scrambled", "simmered",
  "smoked", "steamed", "stewed", "toasted",
  // Cooking methods (present participle) — safe to strip from BOTH sides;
  // identity tokens like "chicken" survive. "roasting" appears in
  // POULTRY_TYPE_CLASSIFIERS but that operates on raw segments before
  // tokenization, so no conflict.
  "boiling", "frying", "grilling", "braising", "broiling", "poaching",
  "simmering", "steaming", "stewing", "toasting", "roasting", "smoking",
  "blanching", "scrambling",
  // Preservation
  "fresh", "frozen", "canned", "dried", "cured",
  "pickled", "fermented",
  // Processing
  "whole", "sliced", "diced", "shredded", "pureed",
  "minced", "chopped", "grated", "crushed", "ground",
  "melted", "softened", "chilled", "slivered", "halved", "quartered",
  "zest", "rind",
  // Form descriptors (recipe tells you the form, not the food identity)
  "florets", "leaves", "stems", "tips", "buds",
  // Preparation
  "prepared", "unprepared", "dry",
  // Physical
  "boneless", "skinless",
  // Temperature (recipe tells you the temperature, not the food)
  "warm", "hot", "cold", "cool", "lukewarm", "iced",
  // Size/quality (recipe noise)
  "large", "small", "medium", "thin", "thick",
  "extra", "virgin",
  "unsweetened", "sweetened", "unsalted", "salted",
  "plain", "regular", "organic", "natural", "kosher",
  // Size/age descriptors
  "baby", "stale",
]);

// ---------------------------------------------------------------------------
// Stop words (removed from both channels during tokenization)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "or", "and", "with", "without", "not", "in", "of", "the", "a", "an",
  "from", "by", "to", "for", "on", "at", "as", "per", "about",
  "all", "also", "may", "contain", "contains",
]);

// ---------------------------------------------------------------------------
// Tokenizer τ()
// ---------------------------------------------------------------------------

/**
 * Tokenize text into lowercase word tokens.
 * Splits on non-alphanumeric boundaries.
 * Removes stop words.
 * Returns tokens in order (duplicates removed).
 */
export function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of raw) {
    if (!seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }
  return result;
}

/**
 * Split tokens into two channels: core (identity) and state (cooking/preservation).
 */
export function classifyTokens(tokens: string[]): {
  core: string[];
  state: string[];
} {
  const core: string[] = [];
  const state: string[] = [];
  for (const t of tokens) {
    if (STATE_TOKEN_SET.has(t)) {
      state.push(t);
    } else {
      core.push(t);
    }
  }
  return { core, state };
}

// ---------------------------------------------------------------------------
// IDF weights
// ---------------------------------------------------------------------------

export interface IdfWeights {
  /** w(t) = 1 / log(2 + df(t)) */
  weight: (token: string) => number;
  /** df(t) = number of FDC foods containing token t */
  df: (token: string) => number;
}

/**
 * Build IDF weights from a corpus of FDC foods.
 * df(t) = number of foods whose coreTokenSet contains t.
 */
export function buildIdfWeights(foods: ProcessedFdcFood[]): IdfWeights {
  const df = new Map<string, number>();
  for (const food of foods) {
    for (const token of food.coreTokenSet) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }
  return {
    weight(token: string): number {
      return 1 / Math.log(2 + (df.get(token) || 0));
    },
    df(token: string): number {
      return df.get(token) || 0;
    },
  };
}

/**
 * Compute total IDF weight for a set of tokens.
 * W_I = Σ w(t) for t in tokens
 */
export function totalWeight(tokens: string[], idf: IdfWeights): number {
  let sum = 0;
  for (const t of tokens) {
    sum += idf.weight(t);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Parenthetical extraction
// ---------------------------------------------------------------------------

const PAREN_NOISE = [
  /\bincludes?\b/i,
  /\bformerly\b/i,
  /\bUSDA\b/i,
  /\bpreviously\b/i,
  /\bsee\b/i,
  /\bnfs\b/i,
  /\bnot\b/i,
  /^\d/,
  /\d+\s*(mg|g|mcg|iu|%)/i,
];

export function extractParentheticals(description: string): string[] {
  const matches = description.match(/\(([^)]+)\)/g);
  if (!matches) return [];
  return matches
    .map((m) => m.slice(1, -1).trim().toLowerCase())
    .filter((s) => {
      if (s.length < 3) return false;
      for (const pattern of PAREN_NOISE) {
        if (pattern.test(s)) return false;
      }
      return true;
    });
}

// ---------------------------------------------------------------------------
// USDA inverted name resolution
// ---------------------------------------------------------------------------

// Domain knowledge sets imported from canonicalize.ts (single source of truth)

/**
 * Resolve the USDA inverted naming convention.
 * "Oil, olive, salad or cooking" → "olive oil"
 * "Spices, pepper, black" → "black pepper"
 * "Chicken, broilers or fryers, breast" → "chicken breast"
 *
 * Returns a human-readable name for Jaro-Winkler scoring.
 */
export function resolveInvertedName(segments: string[]): string {
  if (segments.length === 0) return "";
  if (segments.length === 1) return segments[0];

  const first = segments[0].replace(/[,;:.!?]+$/, "").trim();
  const second = segments[1]?.replace(/[,;:.!?]+$/, "").trim() || "";

  // Container categories: "Oil, olive" → "olive oil"
  if (CONTAINER_CATEGORIES.has(first) && second) {
    if (segments.length >= 3) {
      const third = segments[2]?.replace(/[,;:.!?]+$/, "").trim() || "";
      // Only use third as a modifier if it's a short, single-word qualifier
      // (e.g. "black" in "Spices, pepper, black"), not a multi-word descriptor
      // (e.g. "salad or cooking" in "Oil, olive, salad or cooking")
      if (third && third !== second && !third.includes(" ")) {
        return `${third} ${second}`;  // "Spices, pepper, black" → "black pepper"
      }
    }
    return `${second} ${first}`;  // "Oil, olive" → "olive oil"
  }

  // Protein bases: "Chicken, breast" → "chicken breast"
  if (PROTEIN_BASES.has(first)) {
    let subtypeIdx = 1;
    if (POULTRY_CLASSIFIERS.has(second) && segments.length >= 3) {
      subtypeIdx = 2;
    }
    const subtype = segments[subtypeIdx]?.replace(/[,;:.!?]+$/, "").trim();
    if (subtype) {
      return `${first} ${subtype}`;
    }
  }

  // Product forms: second segment is a form → "wheat flour", "orange juice"
  if (PRODUCT_FORMS.has(second)) {
    return `${first} ${second}`;
  }

  // Default: just use first + second
  return segments.length >= 2 ? `${first} ${second}` : first;
}

// ---------------------------------------------------------------------------
// Jaro-Winkler similarity
// ---------------------------------------------------------------------------

/**
 * Standard Jaro similarity.
 */
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchWindow = Math.max(Math.floor(Math.max(s1.length, s2.length) / 2) - 1, 0);

  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (
    (matches / s1.length +
      matches / s2.length +
      (matches - transpositions / 2) / matches) /
    3
  );
}

/**
 * Jaro-Winkler similarity with prefix bonus.
 * Returns value in [0, 1].
 */
export function jaroWinkler(s1: string, s2: string, prefixScale = 0.1): number {
  const jaroSim = jaro(s1, s2);

  // Common prefix length (max 4)
  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaroSim + prefix * prefixScale * (1 - jaroSim);
}

// ---------------------------------------------------------------------------
// Plural variants (reused from existing logic)
// ---------------------------------------------------------------------------

// Irregular plural mappings (P1 fix: cover common food-related irregulars)
const IRREGULAR_PLURALS = new Map<string, string>([
  ["fish", "fish"],      // invariant
  ["sheep", "sheep"],    // invariant
  ["deer", "deer"],      // invariant
  ["mice", "mouse"],
  ["mouse", "mice"],
  ["teeth", "tooth"],
  ["tooth", "teeth"],
  ["geese", "goose"],
  ["goose", "geese"],
  ["dice", "die"],
  ["die", "dice"],
  ["loaves", "loaf"],
  ["loaf", "loaves"],
  ["halves", "half"],
  ["half", "halves"],
]);

export function pluralVariants(name: string): string[] {
  const variants: string[] = [];

  // Check irregular plurals first - if found, skip regular rules
  const irregular = IRREGULAR_PLURALS.get(name);
  if (irregular !== undefined) {
    // For invariants (fish→fish), irregular === name, so nothing added
    // For others (mouse→mice), add the variant
    if (irregular !== name) {
      variants.push(irregular);
    }
    // Return early - don't apply regular plural rules to irregulars
    return variants.filter((v) => v !== name && v.length >= 3);
  }

  if (name.endsWith("ies") && name.length > 4) {
    variants.push(name.slice(0, -3) + "y");
  } else if (name.endsWith("ves")) {
    variants.push(name.slice(0, -3) + "f");
    variants.push(name.slice(0, -3) + "fe");
  } else if (name.endsWith("oes") && name.length > 4) {
    variants.push(name.slice(0, -2));
  } else if (
    name.endsWith("ches") || name.endsWith("shes") ||
    name.endsWith("sses") || name.endsWith("xes") || name.endsWith("zes")
  ) {
    variants.push(name.slice(0, -2));
  } else if (name.endsWith("s") && !name.endsWith("ss") && !name.endsWith("us")) {
    variants.push(name.slice(0, -1));
  }

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
// Category expectations (versioned lexicon v1.0)
// ---------------------------------------------------------------------------

/**
 * Deterministic, versioned map: ingredient token → expected FDC categories.
 * When no expectation exists, category affinity is neutral (0), not a penalty.
 */
export const CATEGORY_EXPECTATIONS = new Map<string, string[]>([
  // Fats and oils
  ["oil", ["Fats and Oils"]],
  // Dairy
  ["butter", ["Dairy and Egg Products"]],
  ["cream", ["Dairy and Egg Products"]],
  ["cheese", ["Dairy and Egg Products"]],
  ["milk", ["Dairy and Egg Products"]],
  ["yogurt", ["Dairy and Egg Products"]],
  ["egg", ["Dairy and Egg Products"]],
  ["eggs", ["Dairy and Egg Products"]],
  // Grains
  ["flour", ["Cereal Grains and Pasta"]],
  ["rice", ["Cereal Grains and Pasta"]],
  ["pasta", ["Cereal Grains and Pasta"]],
  ["oats", ["Cereal Grains and Pasta"]],
  ["wheat", ["Cereal Grains and Pasta"]],
  ["cornstarch", ["Cereal Grains and Pasta"]],
  // Spices and herbs
  ["salt", ["Spices and Herbs"]],
  ["pepper", ["Spices and Herbs", "Vegetables and Vegetable Products"]],
  ["cinnamon", ["Spices and Herbs"]],
  ["cumin", ["Spices and Herbs"]],
  ["oregano", ["Spices and Herbs"]],
  ["basil", ["Spices and Herbs"]],
  ["thyme", ["Spices and Herbs"]],
  ["paprika", ["Spices and Herbs"]],
  ["nutmeg", ["Spices and Herbs"]],
  ["ginger", ["Spices and Herbs", "Vegetables and Vegetable Products"]],
  ["garlic", ["Spices and Herbs", "Vegetables and Vegetable Products"]],
  ["parsley", ["Spices and Herbs"]],
  ["rosemary", ["Spices and Herbs"]],
  ["cloves", ["Spices and Herbs"]],
  ["turmeric", ["Spices and Herbs"]],
  // Meats
  ["chicken", ["Poultry Products"]],
  ["turkey", ["Poultry Products"]],
  ["beef", ["Beef Products"]],
  ["pork", ["Pork Products"]],
  ["lamb", ["Lamb, Veal, and Game Products"]],
  ["veal", ["Lamb, Veal, and Game Products"]],
  // Seafood
  ["salmon", ["Finfish and Shellfish Products"]],
  ["shrimp", ["Finfish and Shellfish Products"]],
  ["tuna", ["Finfish and Shellfish Products"]],
  ["cod", ["Finfish and Shellfish Products"]],
  ["crab", ["Finfish and Shellfish Products"]],
  // Sweets
  ["sugar", ["Sweets"]],
  ["honey", ["Sweets"]],
  ["molasses", ["Sweets"]],
  ["chocolate", ["Sweets"]],
  // Vegetables (singular + plural forms — the tokenizer doesn't stem)
  ["onion", ["Vegetables and Vegetable Products"]],
  ["onions", ["Vegetables and Vegetable Products"]],
  ["tomato", ["Vegetables and Vegetable Products"]],
  ["tomatoes", ["Vegetables and Vegetable Products"]],
  ["potato", ["Vegetables and Vegetable Products"]],
  ["potatoes", ["Vegetables and Vegetable Products"]],
  ["carrot", ["Vegetables and Vegetable Products"]],
  ["carrots", ["Vegetables and Vegetable Products"]],
  ["celery", ["Vegetables and Vegetable Products"]],
  ["broccoli", ["Vegetables and Vegetable Products"]],
  ["spinach", ["Vegetables and Vegetable Products"]],
  ["lettuce", ["Vegetables and Vegetable Products"]],
  ["peppers", ["Vegetables and Vegetable Products", "Spices and Herbs"]],
  ["olive", ["Fruits and Fruit Juices", "Vegetables and Vegetable Products"]],
  ["olives", ["Fruits and Fruit Juices", "Vegetables and Vegetable Products"]],
  // Fruits (singular + plural)
  ["lemon", ["Fruits and Fruit Juices"]],
  ["lemons", ["Fruits and Fruit Juices"]],
  ["lime", ["Fruits and Fruit Juices"]],
  ["limes", ["Fruits and Fruit Juices"]],
  ["orange", ["Fruits and Fruit Juices"]],
  ["oranges", ["Fruits and Fruit Juices"]],
  ["apple", ["Fruits and Fruit Juices"]],
  ["apples", ["Fruits and Fruit Juices"]],
  ["banana", ["Fruits and Fruit Juices"]],
  ["bananas", ["Fruits and Fruit Juices"]],
  ["cherries", ["Fruits and Fruit Juices"]],
  // Legumes
  ["beans", ["Legumes and Legume Products"]],
  ["lentils", ["Legumes and Legume Products"]],
  ["zucchini", ["Vegetables and Vegetable Products"]],
  ["squash", ["Vegetables and Vegetable Products"]],
  ["corn", ["Vegetables and Vegetable Products", "Cereal Grains and Pasta"]],
  // Nuts
  ["almonds", ["Nut and Seed Products"]],
  ["walnuts", ["Nut and Seed Products"]],
  ["pecans", ["Nut and Seed Products"]],
  ["peanut", ["Legumes and Legume Products"]],
  // Beverages
  ["water", ["Beverages"]],
  ["wine", ["Beverages"]],
  ["brandy", ["Beverages"]],
  ["sherry", ["Beverages"]],
  // Meat products — bacon is pork, not turkey
  ["bacon", ["Pork Products"]],
  // Condiments
  ["mayonnaise", ["Fats and Oils"]],
  ["mustard", ["Spices and Herbs"]],
  ["ketchup", ["Soups, Sauces, and Gravies"]],
  // Soups, sauces, gravies
  ["sauce", ["Soups, Sauces, and Gravies"]],
  ["broth", ["Soups, Sauces, and Gravies"]],
  ["stock", ["Soups, Sauces, and Gravies"]],
  // Spices (USDA categorizes vinegar and extracts here)
  ["extract", ["Spices and Herbs"]],
  ["vinegar", ["Spices and Herbs"]],
  ["seasoning", ["Spices and Herbs"]],
  // Sweets
  ["syrup", ["Sweets"]],
  ["cocoa", ["Sweets", "Beverages"]],
  // Meat products
  ["sausage", ["Sausages and Luncheon Meats"]],
  ["ham", ["Pork Products"]],
  ["steak", ["Beef Products"]],
  // Baked goods
  ["bread", ["Baked Products"]],
  ["tortilla", ["Baked Products"]],
  ["tortillas", ["Baked Products"]],
  // Grains and pasta
  ["noodles", ["Cereal Grains and Pasta"]],
  ["noodle", ["Cereal Grains and Pasta"]],
  ["spaghetti", ["Cereal Grains and Pasta"]],
  ["oatmeal", ["Cereal Grains and Pasta"]],
  // Beverages
  ["coffee", ["Beverages"]],
  ["tea", ["Beverages"]],
  ["rum", ["Beverages"]],
  ["beer", ["Beverages"]],
  ["whiskey", ["Beverages"]],
  ["ice", ["Beverages"]],
  // Vegetables
  ["mushroom", ["Vegetables and Vegetable Products"]],
  ["mushrooms", ["Vegetables and Vegetable Products"]],
  ["peas", ["Vegetables and Vegetable Products"]],
  ["cucumber", ["Vegetables and Vegetable Products"]],
  // Fruits
  ["avocado", ["Fruits and Fruit Juices"]],
  ["pineapple", ["Fruits and Fruit Juices"]],
  ["cherry", ["Fruits and Fruit Juices"]],
  ["strawberry", ["Fruits and Fruit Juices"]],
  ["strawberries", ["Fruits and Fruit Juices"]],
  ["mango", ["Fruits and Fruit Juices"]],
  ["peach", ["Fruits and Fruit Juices"]],
  ["peaches", ["Fruits and Fruit Juices"]],
  // Nuts
  ["coconut", ["Nut and Seed Products"]],
]);

// ---------------------------------------------------------------------------
// Synonym table (versioned v1.0)
// ---------------------------------------------------------------------------

/**
 * Maps recipe ingredient names to sets of FDC description tokens that
 * confirm a match. Each entry: [recipe_name, [...fdc_tokens]].
 * Synonyms only add a bonus; they never substitute for missing token overlap.
 */
export const SYNONYM_TABLE = new Map<string, string[][]>([
  // --- Single-word staples that need disambiguation ---
  // A chef reaching for "onion" grabs a yellow onion, not onion rings
  ["onion", [["onions"]]],
  ["eggs", [["egg", "whole"]]],
  ["milk", [["milk", "milkfat"]]],
  ["pepper", [["pepper", "black"]]],
  ["water", [["water", "tap"]]],
  ["boiling water", [["water", "tap"]]],
  ["warm water", [["water", "tap"]]],
  ["hot water", [["water", "tap"]]],
  ["cold water", [["water", "tap"]]],
  ["vanilla", [["vanilla", "extract"]]],
  ["pure vanilla extract", [["vanilla", "extract"]]],
  ["butter", [["butter", "salted"]]],
  ["unsalted butter", [["butter", "without"]]],
  ["bacon", [["pork"]]],
  ["potatoes", [["potatoes"]]],
  ["mayonnaise", [["mayonnaise"]]],
  ["margarine", [["margarine"]]],

  // --- Oils: a chef grabs a bottle off the shelf ---
  ["flour", [["wheat", "flour"]]],
  ["all purpose flour", [["wheat", "flour"]]],
  ["self raising flour", [["wheat", "flour"]]],
  ["bread flour", [["flour", "bread"]]],
  ["cake flour", [["flour", "cake"]]],
  ["whole wheat flour", [["flour", "whole", "wheat"]]],
  ["olive oil", [["oil", "olive"]]],
  ["extra virgin olive oil", [["oil", "olive"]]],
  ["vegetable oil", [["oil", "canola"], ["oil", "soybean"]]],
  ["canola oil", [["oil", "canola"]]],
  ["sesame oil", [["oil", "sesame"]]],
  ["peanut oil", [["oil", "peanut"]]],
  ["coconut oil", [["oil", "coconut"]]],

  // --- Salts: it's all sodium chloride ---
  ["kosher salt", [["salt", "table"]]],
  ["sea salt", [["salt", "table"]]],
  ["table salt", [["salt", "table"]]],

  // --- Herbs, spices, and their fresh/dried forms ---
  ["cilantro", [["coriander", "leaves"]]],
  ["fresh cilantro", [["coriander", "leaves"]]],
  ["fresh parsley", [["parsley"]]],
  ["fresh basil", [["basil"]]],
  ["fresh thyme", [["thyme"]]],
  ["fresh rosemary", [["rosemary"]]],
  ["fresh mint", [["spearmint"]]],
  ["fresh dill", [["dill"]]],
  ["black pepper", [["pepper", "black"]]],
  ["fresh ground black pepper", [["pepper", "black"]]],
  ["ground black pepper", [["pepper", "black"]]],
  ["fresh ground pepper", [["pepper", "black"]]],
  ["cayenne pepper", [["pepper", "cayenne"]]],
  ["cayenne", [["pepper", "cayenne"]]],
  ["chili powder", [["chili", "powder"]]],
  ["cumin", [["cumin", "seed"]]],
  ["ground cumin", [["cumin", "seed"]]],
  ["ground cinnamon", [["cinnamon"]]],
  ["cinnamon", [["cinnamon"]]],
  ["ground nutmeg", [["nutmeg"]]],
  ["nutmeg", [["nutmeg"]]],
  ["garlic cloves", [["garlic"]]],
  ["garlic clove", [["garlic"]]],
  ["fresh garlic", [["garlic"]]],
  ["fresh garlic cloves", [["garlic"]]],
  ["garlic salt", [["salt", "seasoned"]]],
  ["ginger powder", [["ginger", "ground"]]],
  ["ground ginger", [["ginger", "ground"]]],
  ["celery seed", [["celery", "seed"]]],
  ["gingerroot", [["ginger"]]],
  ["fresh gingerroot", [["ginger"]]],
  ["fresh ginger", [["ginger"]]],
  ["sage", [["sage", "ground"]]],
  ["allspice", [["allspice", "ground"]]],
  ["bay leaf", [["bay", "leaf"]]],
  ["bay leaves", [["bay", "leaf"]]],
  ["onion powder", [["onion", "powder"]]],
  ["garlic powder", [["garlic", "powder"]]],
  ["paprika", [["paprika"]]],
  ["poppy seeds", [["poppy", "seed"]]],
  ["caraway seeds", [["caraway", "seed"]]],
  ["dried oregano", [["oregano", "dried"]]],
  ["oregano", [["oregano"]]],

  // --- Sugars: the baking aisle ---
  ["powdered sugar", [["sugars", "powdered"]]],
  ["confectioners sugar", [["sugars", "powdered"]]],
  ["brown sugar", [["sugars", "brown"]]],
  ["granulated sugar", [["sugars", "granulated"]]],
  ["caster sugar", [["sugars", "granulated"]]],
  ["white sugar", [["sugars", "granulated"]]],

  // --- Leavening ---
  ["baking soda", [["leavening", "baking", "soda"]]],
  ["baking powder", [["leavening", "baking", "powder"]]],
  ["yeast", [["yeast"]]],
  ["dry yeast", [["yeast", "dry"]]],
  ["active dry yeast", [["yeast", "dry"]]],
  ["instant yeast", [["yeast", "dry"]]],

  // --- Sauces and condiments ---
  ["soy sauce", [["soy", "sauce"]]],
  ["worcestershire sauce", [["worcestershire"]]],
  ["dijon mustard", [["mustard", "prepared"]]],
  ["yellow mustard", [["mustard", "prepared"]]],
  ["vinegar", [["vinegar", "cider"]]],
  ["white vinegar", [["vinegar", "distilled"]]],
  ["apple cider vinegar", [["vinegar", "cider"]]],
  ["balsamic vinegar", [["vinegar", "balsamic"]]],
  ["picante sauce", [["salsa"]]],
  ["salsa", [["salsa"]]],
  ["salsa verde", [["salsa", "verde"]]],
  ["enchilada sauce", [["sauce", "enchilada"]]],
  ["taco seasoning", [["seasoning", "taco"]]],
  ["taco seasoning mix", [["seasoning", "taco"]]],
  ["fish sauce", [["fish", "sauce"]]],
  ["hot sauce", [["sauce", "hot"]]],
  ["louisiana hot sauce", [["sauce", "hot"]]],
  ["maple syrup", [["syrup", "maple"]]],
  ["honey", [["honey"]]],

  // --- Dairy ---
  ["heavy cream", [["cream", "heavy"]]],
  ["heavy whipping cream", [["cream", "heavy", "whipping"]]],
  ["half and half", [["cream", "half"]]],
  ["half-and-half", [["cream", "half"]]],
  ["half-and-half cream", [["cream", "half"]]],
  ["sour cream", [["cream", "sour"]]],
  ["cream cheese", [["cheese", "cream"]]],
  ["parmesan cheese", [["cheese", "parmesan", "hard"]]],
  ["cheddar cheese", [["cheese", "cheddar"]]],
  ["shredded cheddar cheese", [["cheese", "cheddar"]]],
  ["sharp cheddar cheese", [["cheese", "cheddar"]]],
  ["low fat cheddar cheese", [["cheese", "cheddar"]]],
  ["mozzarella cheese", [["cheese", "mozzarella"]]],
  ["american cheese", [["cheese", "american"]]],
  ["feta cheese", [["cheese", "feta"]]],
  ["blue cheese", [["cheese", "blue"]]],
  ["bleu cheese", [["cheese", "blue"]]],
  ["buttermilk", [["buttermilk"]]],
  ["skim milk", [["milk", "skim"]]],

  // --- Extracts ---
  ["vanilla extract", [["extract", "vanilla"]]],
  ["almond extract", [["extract", "almond"]]],

  // --- Tomatoes ---
  ["diced tomatoes", [["tomatoes", "diced"]]],
  ["crushed tomatoes", [["tomatoes", "crushed"]]],
  ["roma tomatoes", [["tomato", "roma"]]],
  ["cherry tomatoes", [["tomatoes", "cherry"]]],
  ["tomato paste", [["tomato", "paste"]]],
  ["tomato sauce", [["tomato", "sauce"]]],
  ["sun dried tomatoes", [["tomatoes", "sun", "dried"]]],

  // --- Vegetables: what you see in the produce section ---
  ["green onions", [["onion", "scallion"]]],
  ["red onion", [["onions", "red"]]],
  ["green pepper", [["peppers", "bell", "green"]]],
  ["red pepper", [["peppers", "bell", "red"]]],
  ["green bell pepper", [["peppers", "bell", "green"]]],
  ["red bell pepper", [["peppers", "bell", "red"]]],
  ["jalapeno pepper", [["peppers", "jalapeno"]]],
  ["jalapeno", [["peppers", "jalapeno"]]],
  ["poblano pepper", [["peppers", "poblano"]]],
  ["poblano", [["peppers", "poblano"]]],
  ["zucchini", [["squash", "zucchini"]]],
  ["broccoli florets", [["broccoli"]]],
  ["avocado", [["avocado"]]],
  ["avocados", [["avocado"]]],
  ["romaine lettuce", [["lettuce", "romaine"]]],
  ["head romaine lettuce", [["lettuce", "romaine"]]],
  ["sweet potatoes", [["sweet", "potato"]]],
  ["sweet potato", [["sweet", "potato"]]],
  ["russet potato", [["potatoes", "russet"]]],
  ["russet potatoes", [["potatoes", "russet"]]],

  // --- Beans and legumes ---
  ["black beans", [["beans", "black"]]],
  ["canned black beans", [["beans", "black"]]],
  ["garbanzo beans", [["chickpeas"]]],
  ["chickpeas", [["chickpeas"]]],
  ["pinto beans", [["beans", "pinto"]]],
  ["kidney beans", [["beans", "kidney"]]],
  ["cannellini beans", [["beans", "white"]]],

  // --- Pasta and grains ---
  ["elbow macaroni", [["macaroni"]]],
  ["penne pasta", [["pasta"]]],
  ["cornstarch", [["cornstarch"]]],
  ["long grain rice", [["rice", "long", "grain"]]],
  ["long grain brown rice", [["rice", "brown", "long"]]],
  ["brown rice", [["rice", "brown"]]],
  ["white rice", [["rice", "white"]]],

  // --- Fruits ---
  ["apples", [["apples"]]],
  ["apple", [["apples"]]],
  ["raisins", [["raisins"]]],
  ["strawberry", [["strawberries"]]],
  ["strawberries", [["strawberries"]]],
  ["pineapple juice", [["pineapple", "juice"]]],
  ["orange juice", [["orange", "juice"]]],
  ["lemon juice", [["lemon", "juice"]]],
  ["lime juice", [["lime", "juice"]]],

  // --- Breadcrumbs ---
  ["breadcrumbs", [["bread", "crumbs"]]],
  ["dry breadcrumbs", [["bread", "crumbs"]]],
  ["panko breadcrumbs", [["bread", "crumbs"]]],
  ["plain breadcrumbs", [["bread", "crumbs"]]],
  ["fresh breadcrumb", [["bread", "crumbs"]]],
  ["italian breadcrumbs", [["bread", "crumbs"]]],

  // --- Citrus zest: it's the peel ---
  ["lemon zest", [["lemon", "peel"]]],
  ["orange zest", [["orange", "peel"]]],
  ["lime zest", [["lime", "peel"]]],

  // --- Nuts ---
  ["slivered almonds", [["almonds"]]],
  ["sliced almonds", [["almonds"]]],
  ["chopped walnuts", [["walnuts"]]],
  ["chopped pecans", [["pecans"]]],
  ["peanut butter", [["peanut", "butter"]]],
  ["chunky peanut butter", [["peanut", "butter", "chunky"]]],
  ["creamy peanut butter", [["peanut", "butter"]]],
  ["tahini", [["sesame", "tahini"]]],
  ["coconut", [["coconut"]]],
  ["shredded coconut", [["coconut", "shredded"]]],
  ["coconut flakes", [["coconut", "flakes"]]],

  // --- Cooking spray ---
  ["cooking spray", [["cooking", "spray"]]],
  ["nonstick cooking spray", [["cooking", "spray"]]],

  // --- Cocoa and chocolate ---
  ["cocoa", [["cocoa", "powder"]]],
  ["cocoa powder", [["cocoa", "powder"]]],
  ["unsweetened cocoa", [["cocoa", "powder"]]],

  // --- Chocolate ---
  ["bittersweet chocolate", [["baking", "chocolate"]]],
  ["semisweet chocolate", [["baking", "chocolate"]]],
  ["unsweetened chocolate", [["baking", "chocolate"]]],

  // --- Seafood ---
  ["prawns", [["shrimp"]]],
  ["shrimp", [["shrimp"]]],
  ["large shrimp", [["shrimp"]]],

  // --- Snacks ---
  ["tortilla chips", [["tortilla", "chips"]]],
  ["pretzels", [["pretzels"]]],
  ["crackers", [["crackers"]]],

  // --- Baked goods ---
  ["pie crusts", [["pie", "crust"]]],
  ["pie crust", [["pie", "crust"]]],
  ["refrigerated pie crusts", [["pie", "crust"]]],
  ["corn tortillas", [["tortillas", "corn"]]],
  ["flour tortillas", [["tortillas", "flour"]]],
  ["tortilla", [["tortillas"]]],

  // --- Canned/frozen ---
  ["corn kernel", [["corn", "kernel"]]],
  ["corn kernels", [["corn", "kernel"]]],
  ["frozen corn", [["corn", "frozen"]]],
  ["frozen whole kernel corn", [["corn", "kernel", "frozen"]]],
  ["kalamata olive", [["olives"]]],
  ["kalamata olives", [["olives"]]],

  // --- Broths and soups ---
  ["chicken broth", [["broth", "chicken"]]],
  ["beef broth", [["broth", "beef"]]],
  ["vegetable broth", [["broth", "vegetable"]]],
  ["cream of chicken soup", [["soup", "cream", "chicken"]]],
  ["cream of mushroom soup", [["soup", "cream", "mushroom"]]],
  ["chicken stock", [["stock", "chicken"]]],
  ["beef stock", [["stock", "beef"]]],
  ["bouillon", [["bouillon"]]],
  ["beef bouillon", [["bouillon", "beef"]]],
  ["chicken bouillon", [["bouillon", "chicken"]]],

  // --- Alcohol ---
  ["brandy", [["brandy"]]],
  ["dry sherry", [["sherry"]]],
  ["sherry wine", [["sherry"]]],
  ["cooking wine", [["wine", "cooking"]]],
  ["red wine", [["wine"]]],
  ["white wine", [["wine"]]],
]);

// ---------------------------------------------------------------------------
// Core scoring function
// ---------------------------------------------------------------------------

/**
 * Score a single (ingredient, candidate) pair.
 *
 * Signal weights (sum to 1.0):
 *   overlap:  0.50
 *   jw:       0.00 (disabled — kept for recalibration from production distributions)
 *   segment:  0.25
 *   affinity: 0.10
 *   synonym:  0.15
 */
export function scoreCandidate(
  ingredient: ProcessedIngredient,
  candidate: ProcessedFdcFood,
  idf: IdfWeights,
): ScoredMatch {
  const W_O = 0.50;
  const W_JW = 0.00; // disabled — kept for recalibration from production distributions
  const W_SEG = 0.25;
  const W_AFF = 0.10;
  const W_SYN = 0.15;

  // --- Signal 1: Directional token overlap (IDF-weighted) ---
  let matchedWeight = 0;
  for (const token of ingredient.coreTokens) {
    if (candidate.coreTokenSet.has(token)) {
      matchedWeight += idf.weight(token);
    } else {
      // Try plural/singular variants (0.9 weight penalty for inexact form)
      for (const variant of pluralVariants(token)) {
        if (candidate.coreTokenSet.has(variant)) {
          matchedWeight += idf.weight(token) * 0.9;
          break;
        }
      }
    }
  }
  const overlap = ingredient.matchableWeight > 0
    ? matchedWeight / ingredient.matchableWeight
    : 0;

  // --- Signal 2: Jaro-Winkler (weight=0, kept for recalibration) ---
  const jwScores: number[] = [];
  if (candidate.invertedName) {
    jwScores.push(jaroWinkler(ingredient.normalized, candidate.invertedName));
  }
  if (candidate.plainWords) {
    jwScores.push(jaroWinkler(ingredient.normalized, candidate.plainWords));
  }
  if (candidate.segments.length >= 2) {
    jwScores.push(jaroWinkler(ingredient.normalized, candidate.segments[1]));
  }
  for (const paren of candidate.parentheticals) {
    jwScores.push(jaroWinkler(ingredient.normalized, paren));
  }
  const jwRaw = jwScores.length > 0 ? Math.max(...jwScores) : 0;
  const jwGated = overlap < 0.40 ? Math.min(jwRaw, 0.20) : jwRaw;

  // --- Signal 3: Segment match ---
  let segmentScore = 0;
  if (candidate.segmentTokenSets.length > 0) {
    // Overlap with primary segment (s0)
    let o0weight = 0;
    const primarySet = candidate.segmentTokenSets[0];
    for (const token of ingredient.coreTokens) {
      if (primarySet?.has(token)) {
        o0weight += idf.weight(token);
      } else {
        for (const variant of pluralVariants(token)) {
          if (primarySet?.has(variant)) {
            o0weight += idf.weight(token) * 0.9;
            break;
          }
        }
      }
    }
    const o0 = ingredient.matchableWeight > 0 ? o0weight / ingredient.matchableWeight : 0;

    // Overlap with secondary segments (s1+)
    let oRestWeight = 0;
    for (let j = 1; j < candidate.segmentTokenSets.length; j++) {
      const segSet = candidate.segmentTokenSets[j];
      for (const token of ingredient.coreTokens) {
        if (segSet?.has(token)) {
          oRestWeight += idf.weight(token);
        } else {
          for (const variant of pluralVariants(token)) {
            if (segSet?.has(variant)) {
              oRestWeight += idf.weight(token) * 0.9;
              break;
            }
          }
        }
      }
    }
    const oRest = ingredient.matchableWeight > 0 ? oRestWeight / ingredient.matchableWeight : 0;

    if (o0 >= 0.60) segmentScore = 1.0;
    else if (o0 < 0.60 && oRest >= 0.60) segmentScore = 0.6;
    else if (o0 >= 0.30 || oRest >= 0.30) segmentScore = 0.3;
  }

  // --- Signal 4: Category affinity (three-state) ---
  // State 1:  1.0 if ANY token's expected category matches candidate (bonus)
  // State 2:  0.0 if NO tokens have category expectations (neutral)
  // State 3: -2.0 if tokens HAVE expectations but NONE match (penalty)
  //
  // With weight 0.10 the effective range is:
  //   match:    +0.10
  //   neutral:   0.00
  //   mismatch: -0.20
  // Total swing: 0.30. A wrong-category candidate with perfect other signals
  // scores max ~0.70 (needs_review), not 0.90 (auto-accept).
  let affinityScore = 0;
  let hasAnyExpectation = false;
  let anyExpectationMatches = false;

  for (const token of ingredient.coreTokens) {
    const expected = CATEGORY_EXPECTATIONS.get(token);
    if (expected) {
      hasAnyExpectation = true;
      if (candidate.categoryName && expected.includes(candidate.categoryName)) {
        anyExpectationMatches = true;
        break;  // Found a match, no need to check more
      }
    }
  }

  if (anyExpectationMatches) {
    affinityScore = 1.0;
  } else if (hasAnyExpectation && candidate.categoryName !== null) {
    // Penalty: ingredient has expectations, candidate has a known category,
    // but they don't align. Guard: skip penalty when candidate category is
    // unknown (null) — missing metadata ≠ wrong category.
    affinityScore = -2.0;
  }
  // else: no expectations → neutral 0 (no bonus, no penalty)

  // --- Signal 5: Synonym confirmation (gated) ---
  // P0 fix: lookup by slug to handle inverted ingredient names like "oil, olive"
  // which normalize differently than SYNONYM_TABLE keys like "olive oil"
  let synonymScore = 0;
  const synonymEntries = SYNONYM_TABLE.get(ingredient.normalized) ||
                         SYNONYM_TABLE.get(ingredient.slug.replace(/-/g, " "));
  if (synonymEntries && overlap > 0) {
    // Check against both core and state tokens — synonym entries may reference
    // state words (e.g., "whole" in {egg, whole}) for disambiguation.
    const allCandidateTokens = new Set([
      ...candidate.coreTokenSet,
      ...candidate.stateTokens,
    ]);
    for (const synTokens of synonymEntries) {
      if (synTokens.every((t) => allCandidateTokens.has(t))) {
        synonymScore = 1.0;
        break;
      }
    }
  }

  // --- Composite ---
  const score =
    W_O * overlap +
    W_JW * jwGated +
    W_SEG * segmentScore +
    W_AFF * affinityScore +
    W_SYN * synonymScore;

  // Determine dominant signal for reason
  const signals = [
    { name: "overlap", value: W_O * overlap },
    { name: "jw", value: W_JW * jwGated },
    { name: "segment", value: W_SEG * segmentScore },
    { name: "affinity", value: W_AFF * affinityScore },
    { name: "synonym", value: W_SYN * synonymScore },
  ];
  signals.sort((a, b) => b.value - a.value);

  let reason: string;
  if (segmentScore === 1.0 && overlap >= 0.60) {
    reason = "lexical:segment_primary";
  } else if (synonymScore === 1.0) {
    reason = "lexical:synonym_confirmed";
  } else if (overlap >= 0.90) {
    reason = "lexical:token_overlap_high";
  } else {
    reason = `lexical:${signals[0].name}`;
  }

  return {
    fdcId: candidate.fdcId,
    score,
    reason,
    breakdown: {
      overlap,
      jwGated,
      segment: segmentScore,
      affinity: affinityScore,
      synonym: synonymScore,
    },
  };
}

// ---------------------------------------------------------------------------
// Food pre-processing
// ---------------------------------------------------------------------------

/**
 * Pre-process a raw FDC food into a ProcessedFdcFood.
 * Called once per food at startup.
 */
export function processFdcFood(
  fdcId: number,
  description: string,
  dataType: "sr_legacy" | "foundation",
  categoryName: string | null,
): ProcessedFdcFood {
  const descLower = description.toLowerCase();

  // Remove parentheticals before segmenting
  const parentheticals = extractParentheticals(description);
  const descNoParens = descLower.replace(/\([^)]*\)/g, "").trim();

  // Comma segments
  const segments = descNoParens
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Tokenize full description (without parentheticals)
  const allTokens = tokenize(descNoParens);
  const { core: coreTokens, state: stateTokens } = classifyTokens(allTokens);

  // Also include parenthetical tokens in the core set so that
  // alternate names like "(cilantro)" in "Coriander (cilantro) leaves, raw"
  // participate in token overlap scoring
  for (const paren of parentheticals) {
    const parenTokens = tokenize(paren);
    const { core: parenCore } = classifyTokens(parenTokens);
    for (const t of parenCore) {
      if (!coreTokens.includes(t)) {
        coreTokens.push(t);
      }
    }
  }

  // Per-segment token sets
  const segmentTokenSets: Set<string>[] = segments.map((seg) => {
    const segTokens = tokenize(seg);
    const { core } = classifyTokens(segTokens);
    return new Set(core);
  });

  // Inverted name
  const invertedName = resolveInvertedName(segments);

  return {
    fdcId,
    description,
    dataType,
    categoryName,
    descLower,
    segments,
    coreTokens,
    coreTokenSet: new Set(coreTokens),
    stateTokens,
    segmentTokenSets,
    invertedName,
    plainWords: coreTokens.join(" "),
    parentheticals,
    slug: slugify(invertedName || description),
  };
}

// ---------------------------------------------------------------------------
// Ingredient pre-processing
// ---------------------------------------------------------------------------

/**
 * Normalize recipe ingredient format oddities.
 * Reused from existing pipeline.
 */
// Compound words that should be split for tokenization.
// "gingerroot" → "ginger root", "breadcrumbs" → "bread crumbs"
const COMPOUND_WORD_SPLITS = new Map<string, string>([
  ["gingerroot", "ginger root"],
  ["breadcrumbs", "bread crumbs"],
  ["breadcrumb", "bread crumb"],
  ["crabmeat", "crab meat"],
  ["cornflour", "corn flour"],
]);

// Words that are recipe measurement units, not food identity tokens.
// "garlic cloves" means garlic measured in cloves, not the spice "cloves".
const UNIT_NOISE_WORDS = new Set([
  "cloves", "clove", "stalks", "stalk", "heads", "head",
  "sprigs", "sprig", "bunches", "bunch", "slices", "slice",
  "pieces", "piece", "strips", "strip", "cubes", "cube",
  "ears", "ear",
]);

export function preNormalize(name: string): string {
  let n = name;
  n = n.replace(/["]+,?$/g, "").replace(/^["]+/g, "");
  n = n.replace(/^(.+),\s*juice of$/i, "$1 juice");
  n = n.replace(/^(.+),\s*zest of$/i, "$1 zest");
  n = n.replace(/^(.+),\s*rind of$/i, "$1 rind");
  n = n.replace(/^(.+),\s*juice and zest of$/i, "$1 juice and $1 zest");
  n = n.replace(/^of\s+/i, "");
  n = n.replace(/\s*&\s*/g, " and ");
  n = n.replace(/^\d+%\s+/, "");
  // Split compound words per-word (e.g., "dry breadcrumbs" → "dry bread crumbs")
  const compoundWords = n.trim().split(/\s+/);
  const expandedWords: string[] = [];
  for (const word of compoundWords) {
    const split = COMPOUND_WORD_SPLITS.get(word.toLowerCase());
    if (split) {
      expandedWords.push(split);
    } else {
      expandedWords.push(word);
    }
  }
  n = expandedWords.join(" ");
  // Strip measurement unit words that collide with food names
  // Only strip if there are other words remaining (don't strip "cloves" if that's the whole ingredient)
  const words = n.trim().split(/\s+/);
  if (words.length > 1) {
    const filtered = words.filter((w) => !UNIT_NOISE_WORDS.has(w.toLowerCase()));
    const hasNonState = filtered.some((w) => !STATE_TOKEN_SET.has(w.toLowerCase()));
    if (filtered.length > 0 && hasNonState) {
      n = filtered.join(" ");
    }
  }
  return n.trim();
}

/**
 * Split compound ingredients ("salt and pepper", "oil and vinegar") into
 * individual parts. Returns an array of 1+ normalized strings.
 * Each part is run through preNormalize independently.
 */
export function splitCompounds(name: string): string[] {
  const normalized = preNormalize(name);
  // Only split on " and " when both sides are at least 2 chars
  // and the result looks like two separate ingredients
  if (/ and /i.test(normalized)) {
    const parts = normalized
      .split(/ and /i)
      .map((p) => p.trim())
      .filter((p) => p.length >= 2);
    if (parts.length >= 2) {
      return parts;
    }
  }
  return [normalized];
}

/**
 * Pre-process a recipe ingredient into a ProcessedIngredient.
 */
export function processIngredient(
  name: string,
  idf: IdfWeights,
): ProcessedIngredient {
  const normalized = preNormalize(name).toLowerCase().trim();
  const allTokens = tokenize(normalized);
  const { core: coreTokens, state: stateTokens } = classifyTokens(allTokens);
  const tw = totalWeight(coreTokens, idf);

  // Compute matchable weight: exclude tokens with df=0 that can never match
  // any FDC food (even via plural variants). These tokens inflate W_I without
  // ever contributing to the numerator, penalizing all candidates equally.
  // Example: "dijon" in "dijon mustard" has df=0 → w=1.44. Including it
  // makes overlap = 0.18 instead of 1.0, cascading into JW gating + low segment.
  let mw = 0;
  for (const t of coreTokens) {
    if (idf.df(t) > 0) {
      mw += idf.weight(t);
    } else {
      // Check if any plural variant exists in the corpus
      let variantFound = false;
      for (const v of pluralVariants(t)) {
        if (idf.df(v) > 0) {
          variantFound = true;
          break;
        }
      }
      if (variantFound) {
        mw += idf.weight(t);
      }
    }
  }
  // Fall back to totalWeight if no tokens are matchable (prevents div-by-zero)
  const matchableW = mw > 0 ? mw : tw;

  return {
    raw: name,
    normalized,
    coreTokens,
    coreTokenSet: new Set(coreTokens),
    stateTokens,
    slug: slugify(normalized),
    totalWeight: tw,
    matchableWeight: matchableW,
  };
}

// ---------------------------------------------------------------------------
// Decision thresholds
// ---------------------------------------------------------------------------

export const THRESHOLD_MAPPED = 0.75;
export const THRESHOLD_REVIEW = 0.40;
export const NEAR_TIE_DELTA = 0.05;

export type MappingStatus = "mapped" | "needs_review" | "no_match";

export function classifyScore(score: number): MappingStatus {
  if (score >= THRESHOLD_MAPPED) return "mapped";
  if (score >= THRESHOLD_REVIEW) return "needs_review";
  return "no_match";
}
