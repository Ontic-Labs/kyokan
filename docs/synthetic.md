# Synthetic Ingredient Invariants Spec (Nutrition Boundaries)

## 1) Definitions

### 1.1 "Synthetic ingredient"

A synthetic ingredient is **not** an FDC food. It's a **derived artifact**:

* Identity: a recipe ingredient name (e.g., "ground beef", "salt", "olive oil")
* Membership: set of FDC foods that map to that recipe ingredient
* Nutrition surface:

  * point estimate (median)
  * boundaries (p10/p90 and/or p25/p75)
  * sample counts, missing counts

### 1.2 Why boundaries

FDC has multiple entries for "the same thing." A single number is misleading. Boundaries preserve reality without hallucination.

### 1.3 Recipe-First Canonical Naming (Key Insight)

**The canonical vocabulary comes from recipe ingredients, NOT from FDC descriptions.**

Previous approach (wrong):
```
FDC description → regex extraction → canonical name
"Beef, ground, 80% lean meat / 20% fat, raw" → "beef ground"
```

Correct approach:
```
Recipe ingredient name → fuzzy match → FDC foods
"ground beef" (from 5,820 recipes) → [FDC 171077, 174036, ...]
```

**Why this matters:**
- Recipe ingredients represent how humans actually think about cooking
- FDC descriptions are scientific/regulatory, not culinary
- "ground beef 80/20" and "ribeye steak" are DIFFERENT ingredients (not both "beef")
- Aggregating at the wrong level produces useless averages

**Source of truth:** `scripts/extract-recipe-ingredients.ts` extracts 14,915 unique ingredient names from real recipes, with frequency counts.

---

## 2) Preconditions (must exist)

* `foods`, `nutrients`, `food_nutrients` imported
* `recipe_ingredient_mapping` populated (maps recipe names → FDC IDs)
* `fdc_cookability_assessment` populated (so you can exclude non-cooking items)
* Optional: `food_state` populated (axes extraction)

---

## 3) Data model

**Migration 009: `009_recipe_ingredient_mapping.sql`**

> **Environment notes:**
> - Use `gen_random_uuid()` for UUID generation (built into Postgres 13+)
> - Use `dbInt`/`dbNum` coercion in Zod schemas for API responses
> - Verify percentile functions work over Supabase pooler before full implementation

## 3.0 `recipe_ingredient_mapping` (Recipe-First Foundation)

This is the **source of truth** for canonical ingredient names. Recipe ingredients become synthetic ingredients.

```sql
create table if not exists recipe_ingredient_mapping (
  -- Recipe ingredient name IS the canonical name
  ingredient_name text primary key,           -- "ground beef", "salt", "olive oil"
  ingredient_slug text not null unique,       -- "ground-beef", "salt", "olive-oil"
  
  -- Usage frequency from recipe corpus
  frequency int not null,                     -- 5820 (how many recipes use this)
  
  -- FDC mappings (many-to-many via array)
  fdc_ids bigint[] not null default '{}',     -- [171077, 174036, ...]
  
  -- Mapping metadata
  match_method text,                          -- 'exact', 'fuzzy', 'semantic', 'manual'
  match_confidence numeric,                   -- 0.0 to 1.0
  verified boolean not null default false,    -- human-reviewed?
  
  -- Synthetic FDC ID (9,200,000+ range)
  synthetic_fdc_id bigint unique,             -- auto-assigned when creating synthetic food
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for finding mappings by FDC ID
create index if not exists idx_recipe_ingredient_fdc_ids 
  on recipe_ingredient_mapping using gin (fdc_ids);

-- Sequence for synthetic FDC IDs
create sequence if not exists recipe_ingredient_synthetic_seq
  start with 9200000 increment by 1;
```

**Key design decisions:**
- `ingredient_name` is the PRIMARY KEY — recipe names ARE the identities
- `fdc_ids` is an array, not a join table — simpler for typical queries
- `synthetic_fdc_id` allows these to appear in the `foods` table with a stable ID
- `frequency` enables prioritization (focus on top 500 = ~90% of recipe coverage)

## 3.1 `synthetic_ingredient`

```sql
create table if not exists synthetic_ingredient (
  synthetic_id uuid primary key default gen_random_uuid(),
  ingredient_name text not null references recipe_ingredient_mapping(ingredient_name),
  canonical_slug text not null,
  canonical_name text not null,
  axes jsonb not null default '{}'::jsonb,     -- optional; can be {} for pure identity
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  version text not null default '1.0.0',
  unique (canonical_slug, axes)
);
```

## 3.2 `synthetic_ingredient_members`

```sql
create table if not exists synthetic_ingredient_members (
  synthetic_id uuid references synthetic_ingredient(synthetic_id) on delete cascade,
  fdc_id bigint references foods(fdc_id) on delete cascade,
  inclusion_reason text null,
  weight double precision not null default 1.0,
  primary key (synthetic_id, fdc_id)
);
```

## 3.3 `synthetic_ingredient_nutrients`

One row per synthetic × nutrient:

```sql
create table if not exists synthetic_ingredient_nutrients (
  synthetic_id uuid references synthetic_ingredient(synthetic_id) on delete cascade,
  nutrient_id bigint not null references nutrients(nutrient_id),
  unit_name text not null,

  -- central tendency
  median double precision not null,

  -- boundaries
  p10 double precision null,
  p90 double precision null,
  p25 double precision null,
  p75 double precision null,

  -- optional raw extremes
  min double precision null,
  max double precision null,

  n_samples int not null,
  n_total int not null,

  primary key (synthetic_id, nutrient_id)
);

create index if not exists idx_syn_nutrients_nutrient on synthetic_ingredient_nutrients (nutrient_id);
```

---

## 4) Membership construction (recipe-first)

Membership is determined by matching recipe ingredient names to FDC foods.

### 4.1 Recipe-First Membership Rule

For each recipe ingredient (e.g., "ground beef"):

1. Extract from recipe corpus: `scripts/extract-recipe-ingredients.ts`
2. Match to FDC foods using one of:
   - **Exact match**: FDC description contains exact phrase
   - **Fuzzy match**: Levenshtein distance / trigram similarity
   - **Semantic match**: Embedding similarity (future)
   - **Manual curation**: Human-verified mappings
3. Store matches in `recipe_ingredient_mapping.fdc_ids[]`

### 4.2 Matching Strategy (Priority Order)

```sql
-- 1. Exact phrase match (highest confidence)
SELECT fdc_id FROM foods 
WHERE lower(description) LIKE '%ground beef%' 
  AND is_cookable = true;

-- 2. Fuzzy match (medium confidence, requires pg_trgm)
SELECT fdc_id, similarity(description, 'ground beef') as sim
FROM foods WHERE is_cookable = true
ORDER BY sim DESC LIMIT 10;

-- 3. Component match (lower confidence)
-- "ground beef" → match foods with "ground" AND "beef"
```

### 4.3 Scope Matters: Specific vs Generic

Recipe ingredients have natural specificity:

| Recipe Ingredient | Specificity | Maps To |
|-------------------|-------------|---------|
| "ground beef 80/20" | Specific | ~3 FDC entries |
| "ground beef" | Generic | ~15 FDC entries (all fat ratios) |
| "beef" | Too broad | DO NOT CREATE (useless average) |

**Rule:** Only create synthetic ingredients for names that appear in recipes. Don't invent abstract categories.

### 4.4 Store membership explicitly

Even if membership can be recomputed, store it:

* auditability
* reproducibility
* stable aggregate boundaries

---

## 5) Nutrient aggregation

### 5.1 Data source

For each member `fdc_id`, pull all `food_nutrients.amount`.

Assumption: amounts are per 100g (SR Legacy typically is). If any portion normalization is required, do it before aggregation.

### 5.2 Computations per nutrient

For each synthetic_id + nutrient_id:

Compute:

* `median` = percentile_cont(0.5)
* `p10` / `p90` = percentile_cont(0.1/0.9)
* `p25` / `p75` optional
* `min`, `max` optional
* `n_samples` = count(amount)
* `n_total` = total member foods

### 5.3 Missing handling

If a nutrient is missing for some foods:

* it simply reduces `n_samples`
* do not impute in v1

---

## 6) Boundary choices (defaults)

Recommended defaults:

* Store **median** + **p10/p90** for "consumer-friendly range"
* Store **p25/p75** for "tight range"
* Store min/max for debugging only

If `n_samples < 3`:

* store median (which is the only value)
* leave percentiles null

---

## 7) Versioning + drift prevention

* Membership version: `synthetic_ingredient.version`
* Rebuilds:

  * bump version when membership rules change
  * rebuild nutrients for that synthetic_id/version
* Never silently overwrite without version bump

---

## 8) API surface (minimal)

### 8.1 List synthetic ingredients

`GET /api/synthetic-ingredients?ingredient=ground-beef`

### 8.2 Nutrients for a synthetic ingredient

`GET /api/synthetic-ingredients/:ingredient_slug`

Response:

```json
{
  "ingredientName": "ground beef",
  "ingredientSlug": "ground-beef",
  "syntheticFdcId": 9200042,
  "frequency": 5820,
  "fdcCount": 15,
  "nutrients": [
    {
      "nutrientId": 1008,
      "name": "Energy",
      "unit": "kcal",
      "median": 251,
      "p10": 240,
      "p90": 265,
      "nSamples": 15
    }
  ]
}
```

---

## 9) The key invariant (your "goal statement" in system form)

> **A synthetic ingredient is a recipe-driven aggregation over FDC foods, producing a nutrition surface that includes uncertainty boundaries.**

It's "one ingredient" as a cook thinks of it, but honest about variance.

---

## 10) Full implementation order (Kyokon environment)

**Recipe extraction (prerequisite):**
1. `scripts/extract-recipe-ingredients.ts` — extract unique ingredients with frequency
2. `009_recipe_ingredient_mapping.sql` migration
3. `scripts/map-recipe-ingredients.ts` — match recipe ingredients to FDC foods

**Synthetic ingredients:**
4. `010_synthetic_ingredients.sql` migration (this spec)
5. `scripts/build-synthetic-membership.ts` — populate from recipe_ingredient_mapping
6. `scripts/aggregate-synthetic-nutrients.ts` — compute boundaries
7. `/api/synthetic-ingredients/:slug` endpoint
8. Validate with top 100 recipe ingredients

**Priority order for matching:**
1. Top 500 ingredients by frequency (covers ~90% of recipe usage)
2. Review and verify matches for top 100
3. Expand to full 14,915 ingredient vocabulary

**Validation checkpoint before step 8:**
```sql
-- Test percentile functions over Supabase pooler
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) as median
FROM food_nutrients WHERE nutrient_id = 1008 LIMIT 1;
```

---

## Appendix: Synthetic FDC ID Ranges

| Range | Purpose |
|-------|---------|
| 9,000,000–9,099,999 | Recipe-derived ingredients (this spec) |
| 9,100,000–9,199,999 | Non-food items (tools, equipment) |
| 9,200,000–9,299,999 | Canonical aggregates (legacy, deprecated) |

**Note:** The original canonical_aggregates approach (9,200,000 range) has been superseded by the recipe-first approach. Recipe ingredient mappings should use the 9,000,000 range.
