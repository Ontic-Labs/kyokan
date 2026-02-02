# Bug Report: `aggregate-recipe-nutrients.ts` & `fdc.ts`

**Version:** 2.0  
**Date:** 2026-02-02  
**Files:**
- `scripts/aggregate-recipe-nutrients.ts`
- `src/types/fdc.ts`
- `src/lib/data/ingredients.ts` (NEW)
- `src/app/api/ingredients/route.ts` (NEW)
- `src/app/api/ingredients/[slug]/route.ts` (NEW)
- `public/openapi.json` (UPDATED)

---

## Summary

| File | Health | Critical | Medium | Low | Fixed Since v1 |
|------|--------|----------|--------|-----|----------------|
| `aggregate-recipe-nutrients.ts` | ✅ Good | 0 | 0 | 2 | 4 ✅ |
| `fdc.ts` | ✅ Good | 0 | 1 | 3 | 1 ✅ |
| `ingredients.ts` (data layer) | ✅ Good | 0 | 1 | 2 | — |
| `ingredients/route.ts` | ✅ Good | 0 | 0 | 1 | — |
| `ingredients/[slug]/route.ts` | ✅ Good | 0 | 0 | 0 | — |
| `openapi.json` | ✅ Good | 0 | 0 | 0 | 1 ✅ |

---

## Fixed Since v1 ✅

### `aggregate-recipe-nutrients.ts`
- ✅ **Issue 1:** Per-ingredient try/catch added (lines 170-289)
- ✅ **Issue 2:** ANSI escape `\x1b[K` added for progress (line 286)
- ✅ **Issue 3:** `computeStats` now throws on empty amounts (lines 75-77)
- ✅ **Issue 6:** Comment added for batch size rationale (line 223)

### `fdc.ts`
- ✅ **Issue 3:** OpenAPI spec now includes `shelf_stable` in preservation enum

---

## `scripts/aggregate-recipe-nutrients.ts`

### Remaining Issue 4: `nTotal` vs `nSamples` semantics unclear 🟢 Low

**Location:** Line 199

`nTotal` is `ci.memberCount` (total member foods), while `nSamples` is count of foods with that nutrient. Correct but confusing—consider renaming or adding comments.

---

### Remaining Issue 5: Unused `paramIndex` increment 🟢 Low

**Location:** Line 121

```typescript
conditions.push(`ci.canonical_slug = $${paramIndex}`);
values.push(slugFilter);
paramIndex++;  // never used again
```

Dead code. Remove or comment for future extensibility.

---

## `src/types/fdc.ts`

### Issue 1: `IngredientNutrientSchema` has nullable min/max but DB always has values 🟡 Medium

**Location:** Lines 185-197

The schema declares `min` and `max` as nullable:
```typescript
min: dbNum.nullable(),
max: dbNum.nullable(),
```

But `aggregate-recipe-nutrients.ts` always computes non-null values for these fields (lines 88-89):
```typescript
min: sorted[0],
max: sorted[n - 1],
```

**Impact:** Schema is more permissive than the data guarantees. Could mask bugs if null ever appears.

**Fix:** Either make schema non-nullable, or add a comment explaining the discrepancy.

---

### Issue 2: `CookingMethodSchema` naming convention undocumented 🟢 Low

**Location:** Lines 67-70

Single words (`baked`) vs snake_case (`stir_fried`). Add a comment explaining: "Single words when possible, snake_case for multi-word methods."

---

### Issue 4: Database row types vs API types divergence undocumented 🟢 Low

**Location:** Lines 13-62

The `*Row` interfaces use snake_case, API schemas use camelCase. Add a comment explaining this.

---

### Issue 5: `SRLegacyFood` reused for Foundation Foods 🟢 Low

**Location:** Lines 295-297

Consider a type alias for clarity:
```typescript
export type FoundationFood = SRLegacyFood;
```

---

## `src/lib/data/ingredients.ts` (NEW)

### Issue 1: Two sequential queries in `getIngredientBySlug` 🟡 Medium

**Location:** Lines 17-73

The function makes two queries: one for the ingredient, one for nutrients. These could be combined into a single query with a JOIN or use `Promise.all` for parallel execution.

**Current:**
```typescript
const ingredientResult = await db.query(...);
// ...
const nutrientResult = await db.query(...);
```

**Fix:** Either combine into one query or parallelize:
```typescript
const [ingredientResult, nutrientResult] = await Promise.all([
  db.query(..., [slug]),
  db.query(`... WHERE ci.canonical_slug = $1`, [slug])  // Note: need to adjust
]);
```

However, the second query depends on `canonical_id` from the first, so a single CTE-based query would be better:
```sql
WITH ing AS (
  SELECT canonical_id, canonical_name, canonical_slug, synthetic_fdc_id, total_count
  FROM canonical_ingredient WHERE canonical_slug = $1
)
SELECT ...
```

---

### Issue 2: `paramIndex` incremented but potentially unused 🟢 Low

**Location:** Lines 119-122

Same pattern as aggregate script—increment even when no more params added. Harmless but inconsistent.

---

### Issue 3: Correlated subqueries in list query 🟢 Low

**Location:** Lines 157-164

Two correlated subqueries per row:
```sql
(SELECT COUNT(*) FROM canonical_fdc_membership cfm WHERE cfm.canonical_id = ci.canonical_id) AS fdc_count,
EXISTS (SELECT 1 FROM canonical_ingredient_nutrients cin WHERE cin.canonical_id = ci.canonical_id) AS has_nutrients
```

For large result sets, this could be slow. Consider LEFT JOIN with aggregation instead:
```sql
LEFT JOIN (
  SELECT canonical_id, COUNT(*) as fdc_count
  FROM canonical_fdc_membership GROUP BY canonical_id
) m ON m.canonical_id = ci.canonical_id
```

---

## `src/app/api/ingredients/route.ts` (NEW)

### Issue 1: `hasNutrients` transform could be cleaner 🟢 Low

**Location:** Lines 16-24

The transform handles both string booleans and numeric booleans. Consider using a dedicated boolean parser:

```typescript
hasNutrients: z.coerce.boolean().optional(),
```

Or if you need strict parsing:
```typescript
const boolParam = z
  .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((v) => v === "true" || v === "1");
```

---

## Recommendations

### Priority 1 (Fix Now):
1. ✅ ~~Add per-ingredient try/catch~~ DONE
2. ✅ ~~Use ANSI clear-line escape~~ DONE
3. ✅ ~~Update OpenAPI with `shelf_stable`~~ DONE
4. Consider combining queries in `getIngredientBySlug`

### Priority 2 (Technical Debt):
1. Add comments explaining naming conventions in `fdc.ts`
2. Remove dead `paramIndex++` increments
3. Consider optimizing correlated subqueries in list query

### Priority 3 (Nice to Have):
1. Type alias for FoundationFood
2. Sync `min`/`max` nullability with actual data guarantees

---

## What's Done Well ✅

### `aggregate-recipe-nutrients.ts`:
- ✅ Per-ingredient transaction safety with try/catch
- ✅ ANSI escape for clean progress output
- ✅ Defensive `computeStats` with early throw
- Batched inserts respecting PostgreSQL limits
- Idempotent UPSERT with ON CONFLICT
- Percentile computation in JS (avoids pooler issues)
- Good CLI ergonomics (--force, --slug)
- Verification query at end
- Failed count tracking and reporting

### `fdc.ts`:
- Zod schemas provide runtime validation
- Coercive number schemas handle pg string returns
- Clear separation of DB row types vs API types
- Comprehensive coverage of FDC data structures
- New Ingredient schemas well-structured

### `ingredients.ts` (data layer):
- Clean separation of concerns
- Proper pagination support
- Zod validation on results
- Type-safe query results

### `ingredients/route.ts`:
- Proper Zod schema for query params
- Uses shared pagination schema
- Clean error handling

### `ingredients/[slug]/route.ts`:
- Proper 404 handling
- Validates response with Zod schema

### `openapi.json`:
- New `/ingredients` and `/ingredients/{slug}` endpoints documented
- Added `shelf_stable` to preservation enum
- "Canonicals" marked as legacy
- New Ingredient schemas match TypeScript types
