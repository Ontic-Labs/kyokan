# Multi-Resolution Canonicalization Spec (Base + Specific) with Nutrition-Assisted Validation

> **Objective:** For every SR Legacy `foods` row, produce **two canonical names**:
>
> * **Base canonical**: the broad identity (e.g., `beer`)
> * **Specific canonical**: a more specific identity when the description clearly indicates a meaningful subtype (e.g., `light beer`)
>
> And optionally compute a **nutrition signature** used **only to validate + select representatives**, not to generate identity.

This spec is written to be implemented **step-by-step**, in order.

---

## Step 0 — Preconditions (must exist)

You already have:

* `foods(fdc_id, description, category_id, …)`
* `food_categories(category_id, name)`
* `nutrients(nutrient_id, name, unit_name, …)`
* `food_nutrients(fdc_id, nutrient_id, amount, …)`
* `fdc_cookability_assessment(fdc_id, is_cookable, …)` (optional but recommended)

You have or will have:

* `food_state` (axes extraction) — but canonicalization must **not depend** on it at runtime.

---

## Step 1 — Data model: store canonical names at multiple levels

### 1.1 Create canonical names table

**Migration 006: `006_canonical_names.sql`**

> **Environment notes:**
> - Applies to both SR Legacy (7,793) and Foundation Foods (365)
> - `data_type` does not affect canonicalization rules
> - `pg_trgm` extension already enabled in `001_init.sql`

```sql
CREATE TABLE IF NOT EXISTS food_canonical_names (
  fdc_id BIGINT NOT NULL REFERENCES foods(fdc_id) ON DELETE CASCADE,

  -- multi-resolution identity
  level TEXT NOT NULL CHECK (level IN ('base','specific')),

  canonical_name TEXT NOT NULL,
  canonical_slug TEXT NOT NULL,

  -- debugging / auditability
  removed_tokens TEXT[] NOT NULL DEFAULT '{}',
  kept_tokens TEXT[] NOT NULL DEFAULT '{}',

  canonical_version TEXT NOT NULL DEFAULT '1.0.0',
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (fdc_id, level)
);

CREATE INDEX IF NOT EXISTS idx_food_canonical_slug
  ON food_canonical_names (level, canonical_slug);

CREATE INDEX IF NOT EXISTS idx_food_canonical_name_trgm
  ON food_canonical_names USING GIN (canonical_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_food_canonical_removed_tokens_gin
  ON food_canonical_names USING GIN (removed_tokens);
```

**Invariant:** every `fdc_id` must have exactly:

* one `level='base'`
* one `level='specific'` (it can equal base)

---

## Step 2 — Define what counts as “base” vs “specific”

### 2.1 Canonical **Base**

Base is the **broad identity noun phrase** that would appear in a recipe ingredient line without explanation.

Examples:

* `beer`, `wine`, `whiskey`
* `acerola`, `black pepper`, `chicken breast`
* `agave`

### 2.2 Canonical **Specific**

Specific is the identity **plus one major subtype** when the description encodes it clearly and it plausibly impacts nutrition or usage.

Examples:

* `light beer` (vs `beer`)
* `red wine` (vs `wine`)
* `acerola juice` (distinct from `acerola`)
* `ground black pepper` if you decide form belongs in specific (recommended: keep form as state, not specific; see below)

**Default rule:** `specific = base` unless a specific subtype rule fires.

---

## Step 3 — Deterministic parsing: extract tokens and strip boilerplate

### 3.1 Normalization pre-pass

Given `foods.description`:

1. trim
2. collapse whitespace
3. normalize punctuation
4. lower-case (for parsing; you can store canonical in lowercase)

### 3.2 Remove parentheticals

Remove all `( … )` segments entirely.

Examples:

* `acerola, (west indian cherry), raw` → `acerola, , raw` → cleaned later
* `agutuk … (Alaska Native)` → remove region tag

### 3.3 Remove leading boilerplate prefixes (domain-specific)

If description starts with:

* `alcoholic beverage,` → remove this prefix for both base + specific derivation

You may add other boilerplates later (e.g., “fast foods,”), but v1 only needs alcohol.

### 3.4 Remove brand tokens

Remove all-uppercase “brand” fragments at end or after commas:

* `bud light`, `budweiser` style tokens
* heuristic: tokens containing 2+ consecutive uppercase letters in the **original** string OR all-caps “words”
  (Do this using the original description before lowercasing, or store an uppercased copy.)

### 3.5 Remove explicit state tokens (state ≠ identity)

Remove tokens that belong to `food_state` axes. Use the exact values from `src/types/fdc.ts`:

**CookingStateSchema:** `unknown`, `raw`, `cooked`

**CookingMethodSchema:** `baked`, `blanched`, `boiled`, `braised`, `broiled`, `fried`, `grilled`, `microwaved`, `poached`, `roasted`, `sauteed`, `scrambled`, `simmered`, `smoked`, `steamed`, `stewed`, `stir_fried`, `toasted`, `pan_fried`, `deep_fried`

**PreservationSchema:** `unknown`, `fresh`, `frozen`, `canned`, `dried`, `cured`, `pickled`, `fermented`, `smoked`, `shelf_stable`

**ProcessingSchema:** `unknown`, `whole`, `ground`, `sliced`, `diced`, `shredded`, `pureed`, `paste`, `powder`, `flour`, `juice`, `oil`, `broth`, `stock`

Also remove preparation phrases: `prepared-from-recipe`, `ready-to-serve`, `unprepared`

**Important:** only remove when explicit. If state is absent, do nothing.

---

## Step 4 — Base canonicalization rules (identity collapse)

### 4.1 Base canonical algorithm (generic)

After Step 3 cleaning:

1. Split by commas into segments
2. Discard empty segments
3. Choose the **first segment** as the base identity candidate

   * unless it is an umbrella tag like “distilled” / “liqueur” (handled by domain rules below)
4. Trim; remove trailing punctuation
5. Normalize pluralization minimally (optional; safe to skip v1)

### 4.2 Domain rules for Alcohol

For cleaned alcohol descriptions like:

* `beer, light`
* `wine, table, red`
* `distilled, rum, 80 proof`
* `liqueur, coffee, 53 proof`
* `whiskey sour, canned`

Apply:

* If any segment equals `beer` → base = `beer`
* Else if any segment equals `wine` → base = `wine`
* Else if first segment equals `distilled` → base = `distilled spirits`
* Else if first segment equals `liqueur` → base = `liqueur`
* Else base = first segment (e.g., `whiskey sour`)

This ensures “Alcoholic beverage, distilled, all (gin, rum…) …” collapses to `distilled spirits`.

---

## Step 5 — Specific canonicalization rules (subtype extraction)

### 5.1 Specific canonical algorithm

Start from:

* `base`
* cleaned segments (comma-separated)

Then apply subtype rules per domain:

#### Alcohol: beer

If base == `beer`:

* if segments contains `light` → specific = `light beer`
* else if segments contains `regular` → specific = `beer` (or `regular beer` if you prefer symmetry—choose one and freeze)
* else if segments contains `low carb` → specific = `low-carb beer`
* else specific = `beer`

#### Alcohol: wine

If base == `wine`:

* if segments contains `cooking` → specific = `cooking wine`
* else if segments contains `table` and `red` → specific = `red wine`
* else if segments contains `dessert` → specific = `dessert wine`
* else if segments contains `light` → specific = `light wine`
* else specific = `wine`

#### Alcohol: distilled spirits

If base == `distilled spirits`:

* if segments contains `vodka` → specific = `vodka`
* if contains `rum` → specific = `rum`
* if contains `whiskey` → specific = `whiskey`
* else specific = `distilled spirits`

#### Alcohol: liqueur

If base == `liqueur`:

* if contains `coffee with cream` → specific = `coffee liqueur with cream`
* else if contains `coffee` → specific = `coffee liqueur`
* else specific = `liqueur`

#### Non-alcohol: juice

If base ends with `juice` already (e.g., `acerola juice`) keep it.
If base is fruit name and segments contains `juice` (rare in SR legacy formatting), then specific = `${base} juice`.

### 5.2 Form belongs to state, not specific (default)

Do NOT build `ground black pepper` as specific unless you explicitly choose that as part of identity. In your architecture, “ground” is a **processing axis**.

So:

* base: `black pepper`
* specific: `black pepper`
* state.processing = `ground` (separate table)

---

## Step 6 — Slugification (stable keys)

### 6.1 Canonical slug rules

* lowercase
* replace non `[a-z0-9]` with `-`
* collapse multiple `-`
* trim `-`

Examples:

* `light beer` → `light-beer`
* `distilled spirits` → `distilled-spirits`

---

## Step 7 — Persist canonical names (idempotent)

### 7.1 Backfill script: `scripts/backfill-canonical-names.ts`

For each `foods` row:

* compute base + slug
* compute specific + slug
* collect removed/kept tokens (for audit)
* UPSERT into `food_canonical_names` for both levels

UPSERT behavior:

* update canonical fields if `canonical_version` changes or `--force`

Transaction:

* batch size: 1000
* one transaction per batch

---

## Step 8 — Nutrition signature (optional, secondary)

> This is **not** used to generate canonical names. It is only used to validate buckets and choose representatives.

### 8.1 Table: `food_nutrition_signature` (optional)

```sql
CREATE TABLE IF NOT EXISTS food_nutrition_signature (
  fdc_id BIGINT PRIMARY KEY REFERENCES foods(fdc_id) ON DELETE CASCADE,
  kcal_per_100g DOUBLE PRECISION NULL,
  protein_g DOUBLE PRECISION NULL,
  carbs_g DOUBLE PRECISION NULL,
  fat_g DOUBLE PRECISION NULL,
  sodium_mg DOUBLE PRECISION NULL,
  signature_version TEXT NOT NULL DEFAULT '1.0.0',
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signature_kcal ON food_nutrition_signature (kcal_per_100g);
```

### 8.2 Signature extraction

Compute from known nutrient IDs (preferred) or names (fallback), with unit checks.

### 8.3 How signature is used (allowed uses)

* Flag outliers within a canonical bucket (base or specific)
* Select representative FDC item for invariant aggregation
* Help decide whether a “specific” subtype should exist (in future versions), but only via deterministic thresholds and explicit rules

**Forbidden use:** moving an item from `beer` to non-beer because macros look odd.

---

## Step 9 — API updates (Kyokan)

### 9.1 `/api/foods` response

Add:

* `canonicalBaseName`, `canonicalBaseSlug`
* `canonicalSpecificName`, `canonicalSpecificSlug`

### 9.2 `/api/foods/:fdcId` response

Include same canonical fields.

### 9.3 Add query support (optional)

* `canonical=base|specific` plus `q=` searches canonical_name instead of description
* `canonicalSlug=` exact match

---

## Step 10 — Matching usage (recipe alignment)

When matching a recipe ingredient to SR Legacy:

1. Filter: `is_cookable = true`
2. Match identity:

   * compare recipe canonical name to `canonical_base` (primary)
   * optionally fallback to `canonical_specific`
3. Rank within candidates using `food_state` axes (Phase 2 only)

Beer example:

* Recipe says “beer” → match base `beer`
* Recipe says “light beer” → match specific `light beer` preferentially

---

## Step 11 — Acceptance tests (must pass)

### 11.1 Canonicalization invariants

* deterministic: same description → same base/specific slugs
* `specific` is either equal to base or a predictable subtype
* parentheses removed
* brands removed
* state tokens removed (raw/cooked/dried/canned/etc.)

### 11.2 Beer rules

From your sample set:

* “Alcoholic beverage, beer, light, BUD LIGHT”
  → base `beer`, specific `light beer`
* “Alcoholic beverage, beer, regular, all”
  → base `beer`, specific `beer`

### 11.3 Agave rules

* “Agave, cooked (Southwest)” / “Agave, raw (Southwest)”
  → base `agave`, specific `agave`

---

## Step 12 — Versioning and drift prevention

* `canonical_version` is a semantic version string
* Any rule change requires bumping `canonical_version`
* You never silently overwrite canonical outputs without version change
* Keep old canonical outputs only if you need historical debugging; otherwise latest version is fine because raw descriptions are immutable

---

## Deliverables checklist

1. `migrations/006_canonical_names.sql`
2. `src/lib/canonicalize.ts` — pure `canonicalizeDescription()` function (base + specific)
3. `scripts/backfill-canonical-names.ts` — batch UPSERT all foods
4. API responses updated to include base+specific canonical names (use `dbInt`/`dbNum` coercion)
5. Unit tests for canonicalization (beer, wine, agave, juice cases)

---

## Next: Synthetic Ingredients

After completing canonicalization, proceed to `docs/synthetic.md` for:
- `007_synthetic_ingredients.sql` migration
- Membership + nutrient aggregation scripts
- `/api/synthetic-ingredients/:slug` endpoint
