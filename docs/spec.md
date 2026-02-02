# Kyokon — Project Specification

> **Kyokon** (巨根) — it means exactly what you think it means. 🍆
>
> Goal: A **Next.js App Router** project that imports the USDA **SR Legacy JSON (~8k–10k foods)** into PostgreSQL and serves it via API routes for **search**, **food detail**, **categories**, **nutrients**, and **nutrient/category filtering**.
> Scope: API-first. UI optional later.

---

## Status Report (2026-02-02)

### Summary

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Project Setup | ✅ Complete | Next.js 16.1.6, App Router, TypeScript |
| 2. Schema | ✅ Complete | 4 migrations applied |
| 3. SR Legacy Import | ✅ Complete | 7,793 foods imported |
| 4. API Routes | ✅ Complete | All endpoints functional |
| 5. Foundation Import | ✅ Complete | 365 foods (scope expanded) |
| 6. Cookability Assessment | ✅ Complete | 7,311 cookable ingredients |

### Database Counts

| Table | Rows |
|-------|------|
| foods | 8,158 (7,793 SR Legacy + 365 Foundation) |
| nutrients | 228 |
| food_nutrients | 659,489 |
| food_categories | 25+ |
| food_portions | 14,836 |
| food_atwater_factors | 333 (Foundation only) |
| food_protein_factors | 311 (Foundation only) |
| fdc_cookability_assessment | 8,158 |

### Cookability Assessment Results

| Metric | Count | % |
|--------|-------|---|
| Total foods | 8,158 | 100% |
| Cookable | 7,291 | 89.4% |
| Excluded | 867 | 10.6% |
| └ Hard-vetoed | 867 | |

### Scope Changes from Original Spec

1. **Foundation Foods added**: Original spec was SR Legacy only. Added Foundation Foods import with Atwater conversion factors.
2. **Cookability filtering added**: Deterministic veto system to identify recipe-appropriate ingredients.
3. **No Atwater backfill for SR Legacy**: Governance rule established — SR Legacy lacks source data for factors (see `ai/rules/no-backfill-atwater-sr-legacy.yaml`).

### Migrations Applied

1. `001_init.sql` — Base schema (foods, nutrients, food_nutrients, etc.)
2. `002_cookability.sql` — Cookability assessment table
3. `003_fix_veto_score_constraint.sql` — Fixed group-based scoring constraint
4. `004_atwater_factors.sql` — Atwater/protein conversion factors for Foundation
5. `005_food_state.sql` — Food state classification (raw/cooked, preservation, processing)
6. `006_canonical_names.sql` — Multi-resolution canonical names (base/specific)
7. `007_branded_foods.sql` — Branded foods columns (not yet applied)
8. `008_canonical_aggregates.sql` — Canonical aggregate tables with synthetic FDC IDs

### Pending / Future Work

- [x] Add `CATEGORY_INFANT` to hard vetoes (345 baby foods → now excluded)
- [x] Expose `is_cookable` filter on API endpoints
- [x] Review single-layer vetoes — `LEXICAL_SUPPLEMENT` and `NUTRIENT_PROTEIN_ISOLATE` promoted to hard vetoes (v1.4.0)
- [x] Canonical name extraction (migration 006)
- [x] Canonical aggregates with synthetic FDC IDs (9,200,000+ range)
- [ ] **Recipe-first canonical naming** — see `docs/synthetic.md` section 1.3
- [ ] Recipe ingredient mapping (map recipe names → FDC foods)
- [ ] Consider additional datasets (Branded Foods, FNDDS)

### Architecture Note: Recipe-First Canonical Naming

**Key insight (2026-02-02):** The canonical vocabulary should come from recipe ingredients, NOT from FDC descriptions.

- Recipe data (`recipes/RAW_recipes.csv`) contains 14,915 unique ingredient names with frequency counts
- These represent how humans actually think about cooking ingredients
- Instead of deriving names from FDC via regex, we map recipe ingredients TO FDC foods
- See `docs/synthetic.md` for full specification

---

## 0) Non-goals

* No LLM matching or “semantic” enrichment in v1.
* No attempt to normalize across multiple FDC datasets (Foundation/Branded/etc.) in v1.
* No background jobs required at runtime; import is offline.

---

## 1) Project Setup (first)

### 1.1 Create the project

```bash
npx create-next-app@latest fdc-sr-api \
  --typescript \
  --eslint \
  --app \
  --src-dir \
  --no-tailwind
cd fdc-sr-api
```

**Assumptions**

* Next.js App Router enabled (`/src/app`)
* API route handlers will live under `/src/app/api/*`

---

### 1.2 Dependencies

Install runtime + validation + tooling:

```bash
npm i pg zod
npm i -D tsx dotenv
```

**Notes**

* `pg`: node-postgres driver
* `zod`: request/response validation for API contracts
* `tsx`: run TypeScript scripts (`tsx scripts/import-sr-legacy.ts`)
* `dotenv`: load env vars for scripts (Next loads env automatically, scripts do not)

Optional but recommended for DB migrations:

* If you want SQL-only migrations: keep `migrations/*.sql` + a tiny runner.
* If you want a framework: `drizzle-orm drizzle-kit` or `knex`.
  (Keep v1 simple: SQL migrations.)

---

### 1.3 Environment variables

Create `.env.local`:

```env
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
```

If deploying to Vercel Postgres, you’ll use their injected vars, but **still support DATABASE_URL locally**.

---

### 1.4 Project structure

Create these folders/files:

```
src/
  app/
    api/
      foods/
        route.ts
      foods/[fdcId]/
        route.ts
      categories/
        route.ts
      nutrients/
        route.ts
  lib/
    db.ts
    sql.ts
    paging.ts
    z.ts
  types/
    fdc.ts
scripts/
  import-sr-legacy.ts
migrations/
  001_init.sql
```

---

### 1.5 Database utilities (lib/db)

Create `src/lib/db.ts`:

**Requirements**

* Single shared pool in dev (hot reload safe-ish)
* Uses `DATABASE_URL`
* Exposes `query(text, params)` and `tx(fn)` helper

Spec:

* `db.query<T>(sql, params?) -> Promise<{ rows: T[] }>`
* `db.tx(async (client) => ...)` begins/commits/rolls back

Also create `src/lib/sql.ts`:

* small helpers for building parameterized SQL safely
* no string interpolation for user input

---

### 1.6 API conventions (across all routes)

All API routes MUST:

* Validate query params with `zod`
* Return JSON with stable shape
* Use consistent pagination:

  * `page` (1-based)
  * `pageSize` (default 25, max 100)

All routes MUST return errors as:

```json
{
  "error": {
    "code": "BAD_REQUEST" | "NOT_FOUND" | "INTERNAL",
    "message": "human readable",
    "details": {}
  }
}
```

No HTML responses.

---

## 2) Postgres Schema (v1, SR Legacy)

> This schema is normalized enough to query cleanly, but not over-normalized.

### 2.1 Entities

* `foods` — one row per SR Legacy food (FDC ID)
* `food_categories` — category taxonomy (if provided)
* `nutrients` — nutrient definitions (ID, name, unit)
* `food_nutrients` — nutrient values per food
* `measure_units` — unit definitions for portions
* `food_portions` — household measures / portions (if provided)

### 2.2 Required columns

**foods**

* `fdc_id BIGINT PRIMARY KEY`
* `description TEXT NOT NULL`
* `description_tsv tsvector GENERATED ALWAYS AS (...) STORED` (for search)
* `data_type TEXT NOT NULL` (store `"sr_legacy"` or whatever source tag is present)
* `category_id BIGINT NULL REFERENCES food_categories(category_id)`
* `published_date DATE NULL` (if present)
* `raw_json JSONB NOT NULL` (provenance)

**nutrients**

* `nutrient_id BIGINT PRIMARY KEY`
* `name TEXT NOT NULL`
* `unit_name TEXT NOT NULL` (e.g., `g`, `mg`, `kcal`)
* `nutrient_rank INT NULL` (if present)
* `is_energy BOOLEAN DEFAULT FALSE` (optional convenience)
* `raw_json JSONB NOT NULL`

**food_nutrients**

* `fdc_id BIGINT REFERENCES foods(fdc_id) ON DELETE CASCADE`
* `nutrient_id BIGINT REFERENCES nutrients(nutrient_id)`
* `amount DOUBLE PRECISION NOT NULL`
* `data_points INT NULL` (if present)
* `derivation_id BIGINT NULL` (if present)
* `min DOUBLE PRECISION NULL`
* `max DOUBLE PRECISION NULL`
* `median DOUBLE PRECISION NULL`
* `footnote TEXT NULL`
* `raw_json JSONB NOT NULL`
* PRIMARY KEY `(fdc_id, nutrient_id)` (SR Legacy should be unique per nutrient)

**food_categories**

* `category_id BIGINT PRIMARY KEY`
* `name TEXT NOT NULL UNIQUE`
* `raw_json JSONB NOT NULL`

**measure_units**

* `measure_unit_id BIGINT PRIMARY KEY`
* `name TEXT NOT NULL` (e.g., `cup`, `tbsp`, `oz`)
* `abbreviation TEXT NULL`
* `raw_json JSONB NOT NULL`

**food_portions**

* `portion_id BIGSERIAL PRIMARY KEY`
* `fdc_id BIGINT REFERENCES foods(fdc_id) ON DELETE CASCADE`
* `measure_unit_id BIGINT NULL REFERENCES measure_units(measure_unit_id)`
* `amount DOUBLE PRECISION NULL` (e.g., 1)
* `gram_weight DOUBLE PRECISION NOT NULL`
* `modifier TEXT NULL` (e.g., "chopped", "sliced")
* `sequence_number INT NULL`
* `raw_json JSONB NOT NULL`

### 2.3 Indexes (must-have)

* Full-text search:

  * `GIN(description_tsv)`
* Filtering:

  * `foods(category_id)`
  * `food_nutrients(nutrient_id, amount)`
  * `food_nutrients(fdc_id)`
* Optional trigram for fuzzy search:

  * enable `pg_trgm` and `GIN(description gin_trgm_ops)` (optional)

---

## 3) Migration (migrations/001_init.sql)

Write SQL to:

* create tables
* enable extensions:

  * `CREATE EXTENSION IF NOT EXISTS pg_trgm;` (optional)
* create tsvector generated column:

  * `to_tsvector('english', description)` (or `simple`)

**Important:** SR Legacy has lots of proper nouns; `simple` may behave better than `english` stemming. Choose `simple` unless you have a reason otherwise.

---

## 4) Import Script (later steps — just constraints now)

You will create `scripts/import-sr-legacy.ts`, but don’t implement yet until schema is final.

**Import requirements**

* Must stream or chunk JSON processing (file is large)
* Must batch inserts:

  * foods: batch 500–2000
  * nutrients: batch 500–2000
  * food_nutrients: batch 5k–20k
  * portions: batch 5k–20k
* Must run inside transactions per batch
* Must be idempotent:

  * use `ON CONFLICT DO UPDATE` for dimension tables
  * `foods` update allowed (description/raw_json)
  * `food_nutrients` upsert by `(fdc_id,nutrient_id)`
* Must store raw_json for provenance for each inserted entity

---

## 5) API Routes (contract only for now)

### 5.1 `GET /api/foods`

Search + list.

Query params:

* `q` (optional string)
* `categoryId` (optional int)
* `nutrientId` (optional int) + `min`/`max` for range filter
* `page`, `pageSize`

Behavior:

* If `q` present:

  * `description_tsv @@ plainto_tsquery(...)`
* Nutrient filter:

  * join to `food_nutrients` and constrain `amount`
* Order:

  * if `q`: rank by `ts_rank`
  * else: order by `description ASC`

Response:

```json
{
  "page": 1,
  "pageSize": 25,
  "total": 1234,
  "items": [
    { "fdcId": 123, "description": "...", "categoryId": 10 }
  ]
}
```

### 5.2 `GET /api/foods/:fdcId`

Food detail.

Response:

* food row
* nutrients (joined)
* portions (joined)

```json
{
  "fdcId": 123,
  "description": "...",
  "category": { "categoryId": 10, "name": "..." },
  "nutrients": [
    { "nutrientId": 1008, "name": "Energy", "unit": "kcal", "amount": 250 }
  ],
  "portions": [
    { "gramWeight": 28, "amount": 1, "unit": "oz", "modifier": null }
  ]
}
```

### 5.3 `GET /api/categories`

Return all categories with counts (optional).

### 5.4 `GET /api/nutrients`

Return all nutrients; optionally include `top`/`search`.

---

## 6) Acceptance Criteria for “Project Setup First” phase

This phase is done when:

1. Next.js project builds and runs:

   * `npm run dev`
2. `src/lib/db.ts` exists and can connect (simple test route ok)
3. Migrations folder exists with `001_init.sql`
4. API route skeletons exist (even if they return `501 Not Implemented`)
5. Env var `DATABASE_URL` is documented and wired

