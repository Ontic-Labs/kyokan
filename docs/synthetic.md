
# Synthetic Ingredient Invariants Spec (Nutrition Boundaries)

## 1) Definitions

### 1.1 “Synthetic ingredient”

A synthetic ingredient is **not** an FDC food. It’s a **derived artifact**:

* Identity: canonical base (and optionally specific)
* Membership: set of FDC foods that map into that identity+axes bucket
* Nutrition surface:

  * point estimate (median)
  * boundaries (p10/p90 and/or p25/p75)
  * sample counts, missing counts

### 1.2 Why boundaries

FDC has multiple entries for “the same thing.” A single number is misleading. Boundaries preserve reality without hallucination.

---

## 2) Preconditions (must exist)

* `foods`, `nutrients`, `food_nutrients` imported
* `food_canonical_names` populated at `level='base'` (and optionally `'specific'`)
* `fdc_cookability_assessment` populated (so you can exclude non-cooking items)
* Optional: `food_state` populated (axes extraction)

---

## 3) Data model

**Migration 007: `007_synthetic_ingredients.sql`**

> **Environment notes:**
> - Use `gen_random_uuid()` for UUID generation (built into Postgres 13+)
> - Use `dbInt`/`dbNum` coercion in Zod schemas for API responses
> - Verify percentile functions work over Supabase pooler before full implementation

## 3.1 `synthetic_ingredient`

```sql
create table if not exists synthetic_ingredient (
  synthetic_id uuid primary key default gen_random_uuid(),
  canonical_slug text not null,
  canonical_name text not null,
  canonical_level text not null check (canonical_level in ('base','specific')),
  axes jsonb not null default '{}'::jsonb,     -- optional; can be {} for pure identity
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  version text not null default '1.0.0',
  unique (canonical_level, canonical_slug, axes)
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

## 4) Membership construction (deterministic)

You need a deterministic way to choose which foods belong to “black pepper.”

### 4.1 Base membership rule (default)

For each `fdc_id`:

* include if `food_canonical_names.level='base'` and `canonical_slug = :slug`
* and `is_cookable = true`

Example:

* slug = `black-pepper`

### 4.2 Optional axis refinement (recommended once `food_state` exists)

If you want “ground black pepper” as a synthetic variant:

* base slug still `black-pepper`
* axes filter: `processing='powder'` or `processing='ground'`

Do **not** average peppercorns + powders unless you explicitly want that.

### 4.3 Store membership explicitly

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

* Store **median** + **p10/p90** for “consumer-friendly range”
* Store **p25/p75** for “tight range”
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

`GET /api/synthetic-ingredients?canonical=black-pepper`

### 8.2 Nutrients for a synthetic ingredient

`GET /api/synthetic-ingredients/:canonical_slug`

Response:

```json
{
  "canonicalName": "black pepper",
  "canonicalSlug": "black-pepper",
  "nTotal": 7,
  "nutrients": [
    {
      "nutrientId": 1008,
      "name": "Energy",
      "unit": "kcal",
      "median": 251,
      "p10": 240,
      "p90": 265,
      "nSamples": 7
    }
  ]
}
```

---

## 9) The key invariant (your “goal statement” in system form)

> **A synthetic ingredient is a deterministic aggregation over a fixed membership set, producing a nutrition surface that includes uncertainty boundaries.**

It’s “one ingredient” but honest about variance.

---

## 10) Full implementation order (Kyokon environment)

**Canonicalization (prerequisite):**
1. `006_canonical_names.sql` migration
2. `canonicalizeDescription()` pure function + unit tests
3. `scripts/backfill-canonical-names.ts`
4. Update `/api/foods` responses with canonical fields

**Synthetic ingredients:**
5. `007_synthetic_ingredients.sql` migration (this spec)
6. `scripts/build-synthetic-membership.ts` — start with single identity (black pepper)
7. `scripts/aggregate-synthetic-nutrients.ts` — compute boundaries
8. `/api/synthetic-ingredients/:slug` endpoint
9. Expand to all identities once validated

**Validation checkpoint before step 9:**
```sql
-- Test percentile functions over Supabase pooler
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) as median
FROM food_nutrients WHERE nutrient_id = 1008 LIMIT 1;
```

