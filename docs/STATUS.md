# Kyokan API — Status Report

**Version:** 1.7.0  
**Date:** 2026-02-02  
**Branch:** `main`

---

## Executive Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Core API (`/foods`, `/nutrients`, `/categories`) | ✅ Production | Fully functional |
| Ingredients API (`/ingredients`) | ✅ Production | New in v1.7.0 |
| API Key Auth | ✅ Production | Migration 010 applied |
| Admin UI (`/admin/keys`) | ✅ Production | Key management working |
| Swagger UI | ✅ Production | Authorize button fixed |
| OpenAPI Spec | ✅ v1.7.0 | Updated with all endpoints |
| API.md Documentation | ✅ Complete | 886 lines, printable |

---

## Recently Completed

### API Key Management System
- Migration `010_api_keys.sql` applied
- `src/lib/api-keys.ts` — generation, hashing, validation
- `src/lib/auth.ts` — route wrappers (`withApiKey`, `withAdminAuth`)
- `src/app/api/admin/keys/` — CRUD endpoints
- `src/app/(site)/admin/keys/page.tsx` — Admin UI with improved clipboard

### Ingredients API
- `GET /ingredients` — paginated list with filtering
- `GET /ingredients/{slug}` — full detail with nutrients
- `POST /ingredients/resolve` — batch ingredient name resolution
- Data layer: `src/lib/data/ingredients.ts`
- Zod schemas in `src/types/fdc.ts`

### Documentation
- `public/openapi.json` updated to v1.7.0
- `docs/API.md` — complete printable reference (886 lines)
- `docs/bugs/aggregate-recipe-nutrients-and-fdc-types-bugs.md` — v2.0

---

## Synthetic Ingredients Status

| Aspect | Status |
|--------|--------|
| `canonical_ingredient.synthetic_fdc_id` | ✅ Populated (9,000,000+ range) |
| Synthetic IDs in `foods` table | ❌ Not present |
| `/api/ingredients/{slug}` | ✅ Works correctly |
| `/api/foods/{9000001}` | ❌ Returns 404 (by design) |

**Decision needed:** Keep `/ingredients` as separate API (recommended) or sync synthetic foods to `foods` table.

---

## TODO List

### Priority 1 — Immediate
- [x] **Fix:** Add missing `tags` to OpenAPI endpoints (Foods, Categories, Nutrients, Canonicals)
- [ ] **Decision:** Synthetic ingredients architecture (separate vs unified)

### Priority 2 — Technical Debt
- [x] ~~Sync `min`/`max` nullability in `IngredientNutrientSchema`~~ — fixed: now non-nullable
- [x] ~~Optimize correlated subqueries in ingredients list query~~ — replaced with LEFT JOINs
- [x] ~~Optimize correlated subqueries in `resolveCanonicalId`~~ — replaced with LEFT JOIN + GROUP BY
- [ ] Add naming convention comments in `fdc.ts`
- [ ] Add type alias `FoundationFood = SRLegacyFood`

### Priority 3 — Enhancements
- [ ] Add type alias `FoundationFood = SRLegacyFood`
- [ ] Rate limiting for API keys
- [ ] Usage analytics dashboard
- [ ] API key scopes (read-only vs full)

### Priority 4 — Future
- [ ] Recipe search endpoint
- [ ] Meal planning API
- [ ] Batch nutrient lookup
- [ ] WebSocket for real-time updates

---

## Database Migrations

| # | Name | Status | Description |
|---|------|--------|-------------|
| 001 | `init.sql` | ✅ Applied | Core tables |
| 002 | `cookability.sql` | ✅ Applied | Cookability fields |
| 003 | `fix_veto_score_constraint.sql` | ✅ Applied | Constraint fix |
| 004 | `atwater_factors.sql` | ✅ Applied | Atwater calorie factors |
| 005 | `food_state.sql` | ✅ Applied | Food state classification |
| 010 | `api_keys.sql` | ✅ Applied | API key management |

---

## Scripts Status

| Script | Purpose | Status |
|--------|---------|--------|
| `import-foundation.ts` | Import Foundation Foods | ✅ Complete |
| `import-sr-legacy.ts` | Import SR Legacy Foods | ✅ Complete |
| `assess-cookability.ts` | Classify cookability | ✅ Complete |
| `assess-food-state.ts` | Classify food states | ✅ Complete |
| `classify-food-state.ts` | State classification | ✅ Complete |
| `aggregate-recipe-nutrients.ts` | Compute canonical nutrients | ✅ Complete (v2.0 fixes) |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `ADMIN_SECRET` | ✅ | Admin UI authentication |
| `NEXT_PUBLIC_BASE_URL` | Optional | API base URL for docs |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Next.js App                          │
├─────────────────────────────────────────────────────────────┤
│  Routes                                                     │
│  ├── /api/foods         ← Core FDC data                    │
│  ├── /api/nutrients     ← Nutrient reference               │
│  ├── /api/categories    ← Food categories                  │
│  ├── /api/ingredients   ← Canonical ingredients (NEW)      │
│  ├── /api/admin/keys    ← API key management               │
│  └── /api-docs          ← Swagger UI                       │
├─────────────────────────────────────────────────────────────┤
│  Libraries                                                  │
│  ├── src/lib/db.ts        ← Database connection            │
│  ├── src/lib/auth.ts      ← Route wrappers                 │
│  ├── src/lib/api-keys.ts  ← Key generation/validation      │
│  └── src/lib/data/        ← Data access layer              │
├─────────────────────────────────────────────────────────────┤
│  Types                                                      │
│  └── src/types/fdc.ts     ← Zod schemas + TS types         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL (Supabase)                    │
├─────────────────────────────────────────────────────────────┤
│  Core Tables           │  Canonical Tables                  │
│  ├── foods             │  ├── canonical_ingredient          │
│  ├── food_nutrients    │  ├── canonical_ingredient_nutrients│
│  ├── nutrients         │  └── canonical_fdc_membership      │
│  └── food_categories   │                                    │
├─────────────────────────────────────────────────────────────┤
│  Auth Tables                                                │
│  └── api_keys                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Known Issues

See [aggregate-recipe-nutrients-and-fdc-types-bugs.md](bugs/aggregate-recipe-nutrients-and-fdc-types-bugs.md) for detailed bug tracking.

**Summary:** 0 critical, 2 medium, 8 low priority issues remaining.

---

## API Endpoints Summary

### Foods
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/foods` | Search and filter foods |
| GET | `/foods/{fdcId}` | Get food detail with nutrients |

### Categories
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/categories` | List food categories |

### Nutrients
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/nutrients` | List all nutrients |

### Ingredients (v1.7.0)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ingredients` | List canonical ingredients |
| GET | `/ingredients/{slug}` | Get ingredient detail with nutrient boundaries |
| POST | `/ingredients/resolve` | Batch resolve ingredient names |

### Canonicals (Legacy)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/canonicals` | List canonical aggregates |
| GET | `/canonicals/{slug}` | Get canonical detail |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/keys` | List API keys |
| POST | `/admin/keys` | Create API key |
| GET | `/admin/keys/{id}` | Get key details |
| PATCH | `/admin/keys/{id}` | Update key name |
| DELETE | `/admin/keys/{id}` | Revoke key |

---

## Changelog

### v1.7.0 (2026-02-02)
- Added `/ingredients` and `/ingredients/{slug}` endpoints
- Added `/ingredients/resolve` POST endpoint
- Added API key management system
- Updated OpenAPI spec with all endpoint tags
- Fixed Swagger UI Authorize button
- Marked `/canonicals` as legacy

### v1.6.0
- Added `shelf_stable` preservation type
- Food state classification

### v1.5.0
- Canonical ingredient aggregation
- Nutrient statistics (median, percentiles)
