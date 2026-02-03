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

/** Deterministic set of tokens that represent cooking/preservation/processing
 *  state rather than food identity. Used to split tokens into two channels. */
const STATE_TOKEN_SET = new Set([
  // Cooking states
  "raw", "cooked",
  // Cooking methods
  "baked", "blanched", "boiled", "braised", "broiled", "fried", "grilled",
  "microwaved", "poached", "roasted", "sauteed", "scrambled", "simmered",
  "smoked", "steamed", "stewed", "toasted",
  // Preservation
  "fresh", "frozen", "canned", "dried", "cured",
  "pickled", "fermented",
  // Processing
  "whole", "sliced", "diced", "shredded", "pureed",
  "minced", "chopped", "grated", "crushed", "ground",
  "melted", "softened", "chilled",
  // Preparation
  "prepared", "unprepared",
  // Physical
  "boneless", "skinless",
  // Size/quality (recipe noise)
  "large", "small", "medium", "thin", "thick",
  "extra", "virgin",
  "unsweetened", "sweetened", "unsalted", "salted",
  "plain", "regular", "organic", "natural",
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
  /\bNFS\b/,
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
    return second;  // "Oil, olive" → "olive" (will get "oil" from product form below)
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

export function pluralVariants(name: string): string[] {
  const variants: string[] = [];

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
  ["butter", ["Dairy and Egg Products", "Fats and Oils"]],
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
  // Vegetables
  ["onion", ["Vegetables and Vegetable Products"]],
  ["tomato", ["Vegetables and Vegetable Products"]],
  ["potato", ["Vegetables and Vegetable Products"]],
  ["carrot", ["Vegetables and Vegetable Products"]],
  ["celery", ["Vegetables and Vegetable Products"]],
  ["broccoli", ["Vegetables and Vegetable Products"]],
  ["spinach", ["Vegetables and Vegetable Products"]],
  ["lettuce", ["Vegetables and Vegetable Products"]],
  ["olive", ["Fruits and Fruit Juices", "Vegetables and Vegetable Products"]],
  ["olives", ["Fruits and Fruit Juices", "Vegetables and Vegetable Products"]],
  // Fruits
  ["lemon", ["Fruits and Fruit Juices"]],
  ["lime", ["Fruits and Fruit Juices"]],
  ["orange", ["Fruits and Fruit Juices"]],
  ["apple", ["Fruits and Fruit Juices"]],
  ["banana", ["Fruits and Fruit Juices"]],
  // Legumes
  ["beans", ["Legumes and Legume Products"]],
  ["lentils", ["Legumes and Legume Products"]],
  // Nuts
  ["almonds", ["Nut and Seed Products"]],
  ["walnuts", ["Nut and Seed Products"]],
  ["pecans", ["Nut and Seed Products"]],
  ["peanut", ["Legumes and Legume Products"]],
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
  ["flour", [["wheat", "flour"]]],
  ["all purpose flour", [["wheat", "flour"]]],
  ["olive oil", [["oil", "olive"]]],
  ["vegetable oil", [["oil", "vegetable"]]],
  ["canola oil", [["oil", "canola"]]],
  ["sesame oil", [["oil", "sesame"]]],
  ["peanut oil", [["oil", "peanut"]]],
  ["coconut oil", [["oil", "coconut"]]],
  ["kosher salt", [["salt", "table"]]],
  ["sea salt", [["salt", "table"]]],
  ["table salt", [["salt", "table"]]],
  ["cilantro", [["coriander", "leaves"]]],
  ["powdered sugar", [["sugar"]]],
  ["confectioners sugar", [["sugar"]]],
  ["brown sugar", [["sugar", "brown"]]],
  ["baking soda", [["leavening", "baking", "soda"]]],
  ["baking powder", [["leavening", "baking", "powder"]]],
  ["soy sauce", [["soy", "sauce"]]],
  ["worcestershire sauce", [["worcestershire"]]],
  ["heavy cream", [["cream", "heavy"]]],
  ["sour cream", [["cream", "sour"]]],
  ["cream cheese", [["cheese", "cream"]]],
  ["parmesan cheese", [["cheese", "parmesan"]]],
  ["cheddar cheese", [["cheese", "cheddar"]]],
  ["mozzarella cheese", [["cheese", "mozzarella"]]],
  ["dijon mustard", [["mustard"]]],
  ["vanilla extract", [["extract", "vanilla"]]],
  ["almond extract", [["extract", "almond"]]],
  ["cornstarch", [["cornstarch"]]],
  ["breadcrumbs", [["bread", "crumbs"]]],
  ["dry breadcrumbs", [["bread", "crumbs"]]],
]);

// ---------------------------------------------------------------------------
// Core scoring function
// ---------------------------------------------------------------------------

/**
 * Score a single (ingredient, candidate) pair.
 *
 * Signal weights (sum to 1.0):
 *   overlap:  0.35
 *   jw:       0.25
 *   segment:  0.20
 *   affinity: 0.10
 *   synonym:  0.10
 */
export function scoreCandidate(
  ingredient: ProcessedIngredient,
  candidate: ProcessedFdcFood,
  idf: IdfWeights,
): ScoredMatch {
  const W_O = 0.35;
  const W_JW = 0.25;
  const W_SEG = 0.20;
  const W_AFF = 0.10;
  const W_SYN = 0.10;

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
  const overlap = ingredient.totalWeight > 0
    ? matchedWeight / ingredient.totalWeight
    : 0;

  // --- Signal 2: Jaro-Winkler (gated by token evidence) ---
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

  // Gate: if token overlap < 0.40, cap JW at 0.20
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
    const o0 = ingredient.totalWeight > 0 ? o0weight / ingredient.totalWeight : 0;

    // Overlap with secondary segments (s1+)
    let oRestWeight = 0;
    for (let j = 1; j < candidate.segmentTokenSets.length; j++) {
      const segSet = candidate.segmentTokenSets[j];
      for (const token of ingredient.coreTokens) {
        if (segSet?.has(token)) {
          oRestWeight += idf.weight(token);
        }
      }
    }
    const oRest = ingredient.totalWeight > 0 ? oRestWeight / ingredient.totalWeight : 0;

    if (o0 >= 0.60) segmentScore = 1.0;
    else if (o0 < 0.60 && oRest >= 0.60) segmentScore = 0.6;
    else if (o0 >= 0.30 || oRest >= 0.30) segmentScore = 0.3;
  }

  // --- Signal 4: Category affinity ---
  // Check ALL tokens with expectations; if ANY token's expected categories match
  // the candidate's category, score = 1.0. This prevents "olive oil" failing
  // category affinity against "Fats and Oils" just because "olive" is checked first.
  let affinityScore = 0;
  for (const token of ingredient.coreTokens) {
    const expected = CATEGORY_EXPECTATIONS.get(token);
    if (expected && candidate.categoryName && expected.includes(candidate.categoryName)) {
      affinityScore = 1.0;
      break;  // Found a match, no need to check more
    }
  }
  // If no expectation matches: neutral 0 (no penalty, just no bonus)

  // --- Signal 5: Synonym confirmation (gated) ---
  let synonymScore = 0;
  const synonymEntries = SYNONYM_TABLE.get(ingredient.normalized);
  if (synonymEntries && overlap > 0) {
    for (const synTokens of synonymEntries) {
      if (synTokens.every((t) => candidate.coreTokenSet.has(t))) {
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
  } else if (jwGated >= 0.90) {
    reason = "lexical:jw_high";
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
export function preNormalize(name: string): string {
  let n = name;
  n = n.replace(/["]+,?$/g, "").replace(/^["]+/g, "");
  n = n.replace(/^(.+),\s*juice of$/i, "$1 juice");
  n = n.replace(/^(.+),\s*zest of$/i, "$1 zest");
  n = n.replace(/^(.+),\s*rind of$/i, "$1 rind");
  n = n.replace(/^(.+),\s*juice and zest of$/i, "$1 juice");
  n = n.replace(/^of\s+/i, "");
  n = n.replace(/\s*&\s*/g, " and ");
  n = n.replace(/^\d+%\s+/, "");
  return n.trim();
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

  return {
    raw: name,
    normalized,
    coreTokens,
    coreTokenSet: new Set(coreTokens),
    stateTokens,
    slug: slugify(normalized),
    totalWeight: tw,
  };
}

// ---------------------------------------------------------------------------
// Decision thresholds
// ---------------------------------------------------------------------------

export const THRESHOLD_MAPPED = 0.80;
export const THRESHOLD_REVIEW = 0.40;
export const NEAR_TIE_DELTA = 0.05;

export type MappingStatus = "mapped" | "needs_review" | "no_match";

export function classifyScore(score: number): MappingStatus {
  if (score >= THRESHOLD_MAPPED) return "mapped";
  if (score >= THRESHOLD_REVIEW) return "needs_review";
  return "no_match";
}
