# Multi-FDC Aggregation Gap

**Status:** Critical Gap
**Created:** 2026-02-06
**Priority:** P0

---

## Problem Statement

Kyokan's synthetic ingredients currently use **ONE FDC food per canonical** instead of aggregating **ALL matching FDC foods** into nutrition ranges. This defeats the purpose of synthetic ingredients, which should represent the natural variation across a food category.

### Example: Olive Oil

USDA FDC contains ~10 olive oil entries:
- Oil, olive, salad or cooking
- Oil, olive, extra virgin
- Oil, olive, refined
- Oil, olive, light
- (+ branded variants)

**Current behavior:** Canonical "olive-oil" maps to ONE of these (the "winner").

**Expected behavior:** Canonical "olive-oil" should aggregate ALL of them, producing:
- Calories: median 884 kcal [P10: 880, P90: 890]
- Fat: median 100g [P10: 99.5, P90: 100]
- etc.

---

## Architecture (Exists But Unused)

Kyokan has complete aggregation infrastructure:

| Component | Purpose | Status |
|-----------|---------|--------|
| `canonical_ingredient` | Canonical ingredient entries | ✅ Populated |
| `canonical_fdc_membership` | Links canonical → multiple FDC foods | ❌ Only 1 per canonical |
| `canonical_ingredient_nutrients` | Aggregated stats (median, P10-P90, min-max) | ❌ Empty (nothing to aggregate) |
| `aggregate-recipe-nutrients.ts` | Computes percentiles across members | ✅ Works, but no data |

### The Gap

```
map-recipe-ingredients-v2.ts
    ↓ picks ONE winner per ingredient
sync-staging-to-canonical.ts
    ↓ writes ONE row to canonical_fdc_membership
aggregate-recipe-nutrients.ts
    ↓ computes stats across 1 member = no range
```

---

## Data Sources for Multi-FDC Membership

### 1. Foundation + SR Legacy (~8K foods)

Primary high-quality source. Use `canonicalizeDescription()` to group:

```
"Oil, olive, salad or cooking"     → baseSlug: "olive-oil"
"Oil, olive, extra virgin"         → baseSlug: "olive-oil"
"Eggs, whole, raw"                 → baseSlug: "eggs"
"Eggs, whole, cooked, scrambled"   → baseSlug: "eggs"
```

**Script exists:** `backfill-canonical-names.ts` + `backfill-canonical-aggregates.ts`

### 2. Branded Foods (~194K cookable) — PARTIALLY PROCESSED

**Current state:**
- Source: `fdc/FoodData_Central_branded_food_json_2025-12-18.json` (3.1 GB)
- Filtered: `fdc/branded_cookable.jsonl` (1.3 GB, **194,199 foods**) ✅
- Script: `scripts/filter-branded-cookable.ts` ✅

**Sample entries:**
```json
{"description": "SUPREME BASMATI RICE", "brandOwner": "VEETEE", "brandedFoodCategory": "Rice"}
{"description": "EXTRA VIRGIN OLIVE OIL", "brandOwner": "KROGER", "brandedFoodCategory": "Vegetable & Cooking Oils"}
{"description": "ORGANIC FREE RANGE LARGE BROWN EGGS", "brandOwner": "VITAL FARMS", "brandedFoodCategory": "Eggs"}
```

**Value:**
- Expands synonym coverage (brand names, regional terms)
- Increases match probability for recipe ingredients
- Provides more data points for nutrition ranges

**Next step:** Parse branded descriptions to:
1. Strip brand prefix (all-caps segment)
2. Strip size/UPC tokens
3. Canonicalize remaining description → slug
4. Add as aliases to `canonical_ingredient_alias`
5. Optionally include in `canonical_fdc_membership` for nutrition ranges

---

## Proposed Solution

### Phase 1: Populate Multi-FDC Membership from Foundation + SR Legacy

Use the existing `food_canonical_names` grouping:

```sql
-- Each food already has a canonical_slug from backfill-canonical-names.ts
INSERT INTO canonical_fdc_membership (canonical_id, fdc_id, membership_reason, weight)
SELECT
  ci.canonical_id,
  fcn.fdc_id,
  'canonical_slug_match',
  1.0
FROM food_canonical_names fcn
JOIN canonical_ingredient ci ON ci.canonical_slug = fcn.canonical_slug
WHERE fcn.level = 'base'  -- or 'specific' depending on granularity
ON CONFLICT (canonical_id, fdc_id) DO NOTHING;
```

Then run: `npx tsx scripts/aggregate-recipe-nutrients.ts --force`

### Phase 2: Parse Branded for Synonyms

Create `scripts/parse-branded-synonyms.ts`:

```typescript
// For each branded food:
// 1. Strip brand prefix (all-caps segment before comma)
// 2. Strip UPC/size tokens
// 3. Canonicalize remaining description
// 4. Add to canonical_ingredient_alias

"KROGER, EXTRA VIRGIN OLIVE OIL, 16 FL OZ"
  → strip brand: "EXTRA VIRGIN OLIVE OIL, 16 FL OZ"
  → strip size: "EXTRA VIRGIN OLIVE OIL"
  → canonicalize: baseSlug = "olive-oil", specificSlug = "extra-virgin-olive-oil"
  → add alias: "kroger olive oil" → canonical "olive-oil"
```

### Phase 3: Include Branded in Nutrition Ranges (Optional)

For common staples where branded nutrition is representative:
- Eggs, butter, milk, flour, sugar, oil, salt

Exclude branded for processed/formulated foods where nutrition varies wildly:
- Sauces, dressings, prepared meals

---

## Implementation Checklist

### Phase 1: Multi-FDC Membership (Foundation + SR Legacy)
- [ ] Run `backfill-canonical-names.ts` on full FDC corpus (if not done)
- [ ] Modify `sync-staging-to-canonical.ts` OR create new script to populate multi-FDC membership
- [ ] Run `aggregate-recipe-nutrients.ts --force` to compute ranges
- [ ] Verify `canonical_ingredient_nutrients` has P10/P90 ranges

### Phase 2: Branded Synonym Extraction
- [x] Filter branded to cookable categories → `fdc/branded_cookable.jsonl` (194K foods) ✅
- [ ] Create `scripts/parse-branded-synonyms.ts` for description → canonical parsing
- [ ] Import branded synonyms to `canonical_ingredient_alias`
- [ ] (Optional) Include branded staples in `canonical_fdc_membership` for nutrition ranges

### Phase 3: API Integration
- [x] API responses include nutrition ranges (already done in `ingredients.ts`) ✅
- [ ] Recipe Alchemy consumes Kyokan API for aggregated ingredients

---

## Verification Queries

```sql
-- Check membership counts per canonical
SELECT
  ci.canonical_name,
  COUNT(cfm.fdc_id) as member_count
FROM canonical_ingredient ci
LEFT JOIN canonical_fdc_membership cfm ON cfm.canonical_id = ci.canonical_id
GROUP BY ci.canonical_id
ORDER BY member_count DESC
LIMIT 20;

-- Expected: "olive oil" should have 5-10 members, not 1

-- Check nutrition ranges exist
SELECT
  ci.canonical_name,
  cin.median,
  cin.p10,
  cin.p90,
  cin.n_samples
FROM canonical_ingredient ci
JOIN canonical_ingredient_nutrients cin ON cin.canonical_id = ci.canonical_id
JOIN nutrients n ON n.nutrient_id = cin.nutrient_id
WHERE n.name = 'Energy'
ORDER BY cin.n_samples DESC
LIMIT 20;

-- Expected: n_samples > 1, P10 ≠ P90
```

---

## Impact

| Metric | Before | After |
|--------|--------|-------|
| FDC members per canonical | 1 | 5-15 (Foundation/SR) |
| Nutrition ranges | None (point estimate) | P10-P90 bounds |
| Alias coverage | Recipe-derived only | + 400K branded variants |
| Match probability | ~70% | ~90%+ |

---

## Related Files

**Kyokan — Aggregation:**
- `scripts/backfill-canonical-names.ts` — assigns canonical slugs to FDC foods
- `scripts/backfill-canonical-aggregates.ts` — groups by slug (old system)
- `scripts/aggregate-recipe-nutrients.ts` — computes percentile stats
- `scripts/sync-staging-to-canonical.ts` — promotes staging → membership
- `src/lib/canonicalize.ts` — deterministic description → slug function

**Kyokan — Branded:**
- `scripts/filter-branded-cookable.ts` — filters 3.1GB → 194K cookable foods ✅
- `fdc/FoodData_Central_branded_food_json_2025-12-18.json` — source (3.1 GB)
- `fdc/branded_cookable.jsonl` — filtered output (1.3 GB, 194K foods) ✅
- `scripts/parse-branded-synonyms.ts` — (TODO) extract synonyms from descriptions

**Recipe Alchemy:**
- Will consume Kyokan API to get aggregated ingredients with ranges
- Currently bypassing Kyokan, doing single-FDC lookups directly
