# Kyokon API Reference

<div align="center">

**Version 1.7.0** | **February 2026**

*Complete REST API documentation for USDA FoodData Central data*

</div>

> REST API for USDA FoodData Central SR Legacy and Foundation Foods data.
>
> **Kyokon** (巨根) — it means exactly what you think it means. 🍆

Base URL: `http://localhost:3000/api` (development)

---

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Pagination](#pagination)
- [Endpoints](#endpoints)
  - [GET /foods](#get-foods)
  - [GET /foods/:fdcId](#get-foodsfdcid)
  - [GET /categories](#get-categories)
  - [GET /nutrients](#get-nutrients)
  - [GET /ingredients](#get-ingredients)
  - [GET /ingredients/:slug](#get-ingredientsslug)
- [Admin Endpoints](#admin-endpoints)
- [Data Types](#data-types)
- [Error Responses](#error-responses)

---

## Overview

This API provides access to **8,158 foods** from the USDA FoodData Central database:

| Dataset | Foods | Description |
|---------|-------|-------------|
| SR Legacy | 7,793 | Standard Reference Legacy (2018) |
| Foundation Foods | 365 | High-quality reference data with Atwater factors |

All responses are JSON. Dates are ISO 8601 format.

---

## Authentication

### API Keys

API keys are required in production. Keys are prefixed with `kyo_` and are 56 characters total.

**Passing the key:**

```bash
# Option 1: Authorization header (preferred)
curl -H "Authorization: Bearer kyo_abc123..." https://api.example.com/api/foods

# Option 2: X-API-Key header
curl -H "X-API-Key: kyo_abc123..." https://api.example.com/api/foods
```

**Getting a key:**

1. Contact your administrator
2. Or visit the Admin UI at `/admin/keys` (requires `ADMIN_SECRET`)

### Development Mode

Authentication is **optional** in development:
- When `NODE_ENV !== 'production'` and `REQUIRE_API_KEY` is not set
- Legacy single `API_KEY` env var still works for backward compatibility

### Swagger UI

Visit `/api-docs` to use the interactive API explorer. Click **Authorize** to enter your API key.

---

## Pagination

List endpoints support pagination with these query parameters:

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `page` | integer | 1 | — | Page number (1-indexed) |
| `pageSize` | integer | 25 | 100 | Items per page |

Paginated responses include metadata:

```json
{
  "items": [...],
  "total": 8158,
  "page": 1,
  "pageSize": 25,
  "totalPages": 327
}
```

---

## Endpoints

### GET /foods

Search and filter foods with full-text search, category, nutrient, and state filtering.

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Full-text search query (uses PostgreSQL `plainto_tsquery`) |
| `categoryId` | integer | Filter by food category ID |
| `nutrientId` | integer | Filter by nutrient ID (requires nutrient to exist in food) |
| `min` | number | Minimum nutrient amount (requires `nutrientId`) |
| `max` | number | Maximum nutrient amount (requires `nutrientId`) |
| `cookable` | boolean | Filter by cookability assessment (`true` or `false`) |
| `state` | enum | Cooking state: `unknown`, `raw`, `cooked` |
| `preservation` | enum | Preservation method (see below) |
| `processing` | enum | Physical processing (see below) |
| `page` | integer | Page number |
| `pageSize` | integer | Items per page |

**Preservation values:** `unknown`, `fresh`, `frozen`, `canned`, `dried`, `cured`, `pickled`, `fermented`, `smoked`

**Processing values:** `unknown`, `whole`, `ground`, `sliced`, `diced`, `shredded`, `pureed`, `paste`, `powder`, `flour`, `juice`, `oil`, `broth`, `stock`

#### Example Requests

**Basic search:**
```
GET /api/foods?q=chicken breast
```

**Search with filters:**
```
GET /api/foods?q=beef&state=raw&cookable=true&pageSize=10
```

**High-protein foods:**
```
GET /api/foods?nutrientId=1003&min=25
```
*(Nutrient 1003 = Protein)*

**Frozen vegetables:**
```
GET /api/foods?categoryId=11&preservation=frozen
```

#### Response

```json
{
  "items": [
    {
      "fdcId": 171077,
      "description": "Chicken, breast, boneless, skinless, raw",
      "categoryId": 5,
      "categoryName": "Poultry Products",
      "cookingState": "raw",
      "cookingMethods": [],
      "preservation": "unknown",
      "processing": "unknown"
    }
  ],
  "total": 61,
  "page": 1,
  "pageSize": 25,
  "totalPages": 3
}
```

**Note:** `cookingState`, `cookingMethods`, `preservation`, and `processing` are only included when state-related filters are applied.

---

### GET /foods/:fdcId

Get detailed information for a single food item, including nutrients and portions.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fdcId` | integer | FDC ID of the food |

#### Example Request

```
GET /api/foods/171077
```

#### Response

```json
{
  "fdcId": 171077,
  "description": "Chicken, breast, boneless, skinless, raw",
  "dataType": "sr_legacy_food",
  "publishedDate": "2019-04-01",
  "category": {
    "categoryId": 5,
    "name": "Poultry Products"
  },
  "nutrients": [
    {
      "nutrientId": 1003,
      "name": "Protein",
      "unit": "g",
      "amount": 22.5
    },
    {
      "nutrientId": 1004,
      "name": "Total lipid (fat)",
      "unit": "g",
      "amount": 2.62
    }
  ],
  "portions": [
    {
      "gramWeight": 118,
      "amount": 1,
      "unit": "breast, bone and skin removed",
      "modifier": null
    }
  ]
}
```

---

### GET /categories

List all food categories, optionally with food counts.

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `includeCounts` | boolean | false | Include count of foods per category |

#### Example Request

```
GET /api/categories?includeCounts=true
```

#### Response

Without counts:
```json
{
  "categories": [
    { "categoryId": 1, "name": "Dairy and Egg Products" },
    { "categoryId": 2, "name": "Spices and Herbs" }
  ]
}
```

With counts:
```json
{
  "categories": [
    { "categoryId": 1, "name": "Dairy and Egg Products", "foodCount": 266 },
    { "categoryId": 2, "name": "Spices and Herbs", "foodCount": 64 }
  ]
}
```

---

### GET /nutrients

List all nutrients with optional search.

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Case-insensitive partial match on nutrient name |
| `page` | integer | Page number |
| `pageSize` | integer | Items per page |

#### Example Request

```
GET /api/nutrients?search=vitamin
```

#### Response

```json
{
  "items": [
    {
      "nutrientId": 1106,
      "name": "Vitamin A, RAE",
      "unit": "µg",
      "rank": 5300,
      "isEnergy": false
    },
    {
      "nutrientId": 1162,
      "name": "Vitamin C, total ascorbic acid",
      "unit": "mg",
      "rank": 5400,
      "isEnergy": false
    }
  ],
  "total": 14,
  "page": 1,
  "pageSize": 25,
  "totalPages": 1
}
```

---

### GET /ingredients

Browse and search canonical ingredients. Each ingredient represents a real recipe term (e.g., "ground beef", "salt") mapped to FDC foods with aggregated nutrient boundaries.

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Case-insensitive partial match on ingredient name |
| `hasNutrients` | boolean | Filter to only ingredients with computed nutrient data |
| `page` | integer | Page number |
| `pageSize` | integer | Items per page |

#### Example Request

```
GET /api/ingredients?q=beef&hasNutrients=true
```

#### Response

```json
{
  "items": [
    {
      "canonicalId": "550e8400-e29b-41d4-a716-446655440000",
      "ingredientName": "ground beef",
      "ingredientSlug": "ground-beef",
      "syntheticFdcId": 9000001,
      "frequency": 12847,
      "fdcCount": 24,
      "hasNutrients": true
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 25,
  "totalPages": 2
}
```

---

### GET /ingredients/:slug

Get detailed information for a canonical ingredient, including statistical nutrient values (median, percentile boundaries) computed from all mapped FDC foods.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `slug` | string | Ingredient slug (e.g., `ground-beef`, `salt`, `olive-oil`) |

#### Example Request

```
GET /api/ingredients/ground-beef
```

#### Response

```json
{
  "canonicalId": "550e8400-e29b-41d4-a716-446655440000",
  "ingredientName": "ground beef",
  "ingredientSlug": "ground-beef",
  "syntheticFdcId": 9000001,
  "frequency": 12847,
  "fdcCount": 24,
  "nutrients": [
    {
      "nutrientId": 1003,
      "name": "Protein",
      "unit": "g",
      "median": 17.5,
      "p10": 14.2,
      "p90": 21.8,
      "p25": 15.6,
      "p75": 19.4,
      "min": 12.1,
      "max": 26.3,
      "nSamples": 24
    },
    {
      "nutrientId": 1004,
      "name": "Total lipid (fat)",
      "unit": "g",
      "median": 20.0,
      "p10": 10.5,
      "p90": 30.2,
      "p25": 15.0,
      "p75": 25.0,
      "min": 5.0,
      "max": 35.0,
      "nSamples": 24
    }
  ]
}
```

#### Nutrient Boundary Fields

| Field | Description |
|-------|-------------|
| `median` | 50th percentile (middle value) |
| `p10` | 10th percentile (lower bound, null if n < 3) |
| `p90` | 90th percentile (upper bound, null if n < 3) |
| `p25` | 25th percentile (1st quartile, null if n < 3) |
| `p75` | 75th percentile (3rd quartile, null if n < 3) |
| `min` | Minimum observed value |
| `max` | Maximum observed value |
| `nSamples` | Number of FDC foods with this nutrient |

---

## Admin Endpoints

Admin endpoints require the `X-Admin-Secret` header matching the server's `ADMIN_SECRET` environment variable.

### POST /admin/keys

Create a new API key.

**Request:**
```json
{
  "name": "Mobile App Production",
  "expires_in_days": 365
}
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "key": "kyo_a1b2c3d4e5f6...",
  "name": "Mobile App Production",
  "expires_at": "2027-02-02T12:00:00.000Z"
}
```

> ⚠️ **The full key is only shown once!** Copy it immediately.

### GET /admin/keys

List all API keys (without full key values).

**Response:**
```json
{
  "keys": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Mobile App Production",
      "key_prefix": "kyo_a1b2",
      "created_at": "2026-02-02T12:00:00.000Z",
      "expires_at": "2027-02-02T12:00:00.000Z",
      "revoked_at": null,
      "last_used_at": "2026-02-02T14:30:00.000Z",
      "request_count": 1542
    }
  ]
}
```

### GET /admin/keys/:id

Get details for a single API key.

### PATCH /admin/keys/:id

Update an API key's name.

**Request:**
```json
{
  "name": "New Name"
}
```

### DELETE /admin/keys/:id

Revoke an API key. The key will immediately stop working.

**Response:**
```json
{
  "success": true,
  "revoked_at": "2026-02-02T15:00:00.000Z"
}
```

---

## Data Types

### FoodListItem

| Field | Type | Description |
|-------|------|-------------|
| `fdcId` | integer | Unique FDC identifier |
| `description` | string | Food name/description |
| `categoryId` | integer \| null | Category ID |
| `categoryName` | string \| null | Category name |
| `cookingState` | string | `unknown`, `raw`, or `cooked` (conditional) |
| `cookingMethods` | string[] | Array of cooking methods (conditional) |
| `preservation` | string | Preservation method (conditional) |
| `processing` | string | Physical processing (conditional) |

### FoodDetail

| Field | Type | Description |
|-------|------|-------------|
| `fdcId` | integer | Unique FDC identifier |
| `description` | string | Food name/description |
| `dataType` | string | `sr_legacy_food` or `foundation_food` |
| `publishedDate` | string \| null | ISO 8601 date |
| `category` | CategoryInfo \| null | Category object |
| `nutrients` | NutrientInfo[] | Array of nutrients |
| `portions` | PortionInfo[] | Array of portion sizes |

### NutrientInfo

| Field | Type | Description |
|-------|------|-------------|
| `nutrientId` | integer | Nutrient ID |
| `name` | string | Nutrient name |
| `unit` | string | Unit of measurement (g, mg, µg, kcal, etc.) |
| `amount` | number | Amount per 100g |

### PortionInfo

| Field | Type | Description |
|-------|------|-------------|
| `gramWeight` | number | Weight in grams |
| `amount` | number \| null | Quantity (e.g., 1) |
| `unit` | string \| null | Unit description (e.g., "cup", "tbsp") |
| `modifier` | string \| null | Additional descriptor |

### CategoryInfo

| Field | Type | Description |
|-------|------|-------------|
| `categoryId` | integer | Category ID |
| `name` | string | Category name |

### IngredientListItem

| Field | Type | Description |
|-------|------|-------------|
| `canonicalId` | string (UUID) | Unique identifier |
| `ingredientName` | string | Human-readable name from recipe corpus |
| `ingredientSlug` | string | URL-safe slug |
| `syntheticFdcId` | integer \| null | Synthetic FDC ID (9,000,000+ range) |
| `frequency` | integer | Recipe usage frequency |
| `fdcCount` | integer | Number of mapped FDC foods |
| `hasNutrients` | boolean | Whether nutrient boundaries are computed |

### IngredientDetail

| Field | Type | Description |
|-------|------|-------------|
| `canonicalId` | string (UUID) | Unique identifier |
| `ingredientName` | string | Human-readable name |
| `ingredientSlug` | string | URL-safe slug |
| `syntheticFdcId` | integer \| null | Synthetic FDC ID |
| `frequency` | integer | Recipe usage frequency |
| `fdcCount` | integer | Number of mapped FDC foods |
| `nutrients` | IngredientNutrient[] | Array of nutrient statistics |

### IngredientNutrient

| Field | Type | Description |
|-------|------|-------------|
| `nutrientId` | integer | Nutrient ID |
| `name` | string | Nutrient name |
| `unit` | string | Unit (g, mg, µg, etc.) |
| `median` | number | 50th percentile per 100g |
| `p10` | number \| null | 10th percentile (null if n < 3) |
| `p90` | number \| null | 90th percentile (null if n < 3) |
| `p25` | number \| null | 25th percentile (null if n < 3) |
| `p75` | number \| null | 75th percentile (null if n < 3) |
| `min` | number | Minimum observed value |
| `max` | number | Maximum observed value |
| `nSamples` | integer | Number of samples |

---

## Error Responses

All errors return a consistent format:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Food with fdcId 999999 not found"
  }
}
```

### Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `BAD_REQUEST` | Invalid query parameters |
| 404 | `NOT_FOUND` | Resource not found |
| 500 | `INTERNAL_ERROR` | Server error |

### Validation Errors

Invalid query parameters return details about what failed:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid query parameters",
    "details": [
      {
        "path": ["categoryId"],
        "message": "Expected number, received string"
      }
    ]
  }
}
```

---

## Cookability Assessment

The `cookable` filter uses a layered deterministic veto system to identify foods appropriate for use in recipes. Foods are excluded via four independent layers:

| Layer | Veto Type | What it catches |
|-------|-----------|-----------------|
| Category | Hard veto: prepared foods | Fast Foods, Restaurant Foods, Meals/Entrees/Side Dishes |
| Category | Hard veto: non-cooking | Meal replacements, sports nutrition bars |
| Category | Infant/medical/supplement | Baby Foods, Dietary Supplements, Medical/Enteral foods |
| Lexical | Supplement keywords | "capsule", "tablet", "whey protein", "protein isolate" |
| Lexical | Medical keywords | "infant", "tube feeding", "enteral", "pediatric" |
| Portion | Non-cooking units only | Foods with only capsule/tablet portion units |
| Nutrient | Implausible profiles | Protein >80g with minimal carbs/fat, extreme vitamin levels |

Foods with veto flags from 2+ distinct layers, or any hard-veto flag (CATEGORY_PREPARED, CATEGORY_NON_COOKING), are marked as not cookable.

---

## Food State Classification

Foods are classified along four independent axes:

### Cooking State

| Value | Description | Example |
|-------|-------------|---------|
| `unknown` | State not determinable from description | "Apples" |
| `raw` | Explicitly uncooked | "Beef, ground, raw" |
| `cooked` | Heat-processed | "Chicken, roasted" |

### Cooking Methods

When `state=cooked`, the `cookingMethods` array contains detected methods:

`baked`, `blanched`, `boiled`, `braised`, `broiled`, `deep_fried`, `fried`, `grilled`, `microwaved`, `pan_fried`, `poached`, `roasted`, `sauteed`, `scrambled`, `simmered`, `smoked`, `steamed`, `stewed`, `stir_fried`, `toasted`

### Preservation

Only set when an explicit preservation keyword appears in the description. Default is `unknown`.

| Value | Keyword trigger | Example description |
|-------|-----------------|---------------------|
| `unknown` | No preservation keyword | "Butter, salted" |
| `fresh` | Explicit "fresh" | "Peas, green, fresh" |
| `frozen` | "frozen" | "Peas, green, frozen" |
| `canned` | "canned" | "Tomatoes, red, ripe, canned" |
| `dried` | "dried", "dehydrated" | "Figs, dried, uncooked" |
| `cured` | "cured" | "Pork, cured, bacon" |
| `pickled` | "pickled" | "Beets, pickled" |
| `fermented` | "fermented" | "Cabbage, fermented" |
| `smoked` | "smoked" (when another cooking method present) | "Turkey, smoked, cooked, roasted" |

### Processing

Only set when an explicit processing keyword appears in the description. Default is `unknown`.

| Value | Keyword trigger | Example description |
|-------|-----------------|---------------------|
| `unknown` | No processing keyword | "Apples" |
| `whole` | "whole" | "Chicken, whole, raw" |
| `ground` | "ground", "minced" | "Beef, ground, 80% lean" |
| `sliced` | "sliced" | "Ham, sliced" |
| `shredded` | "shredded", "grated" | "Cheese, cheddar, shredded" |
| `powder` | "powder" | "Garlic powder" |
| `flour` | "flour" | "Wheat flour, whole-grain" |
| `juice` | "juice" | "Orange juice, raw" |
| `oil` | "oil" | "Olive oil" |
| `broth` | "broth" | "Chicken broth" |
| `stock` | "stock" | "Beef stock" |
| `pureed` | "puree", "pureed" | "Squash, butternut, pureed" |
| `paste` | "paste" | "Tomato paste" |
| `diced` | "diced" | "Tomatoes, canned, diced" |

---

## Common Nutrient IDs

| ID | Name | Unit |
|----|------|------|
| 1003 | Protein | g |
| 1004 | Total lipid (fat) | g |
| 1005 | Carbohydrate, by difference | g |
| 1008 | Energy | kcal |
| 1079 | Fiber, total dietary | g |
| 1087 | Calcium, Ca | mg |
| 1089 | Iron, Fe | mg |
| 1093 | Sodium, Na | mg |
| 1162 | Vitamin C | mg |

Use `GET /api/nutrients` for the complete list of 228 nutrients.

---

## Rate Limits

No rate limits are enforced in development. Production deployments should implement appropriate limits.

---

## Response Validation (Zod)

All API responses are validated at runtime using [Zod](https://zod.dev/) schemas. This ensures type safety between the database layer and API consumers.

### Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│  Database   │ -> │  Row Mapper  │ -> │  Zod Validate   │ -> │  JSON Response│
│  (pg query) │    │  (transform) │    │  (validateItems)│    │  (validated)  │
└─────────────┘    └──────────────┘    └─────────────────┘    └──────────────┘
```

### Schemas

All response types are defined as Zod schemas in `src/types/fdc.ts`:

| Schema | Description |
|--------|-------------|
| `FoodListItemSchema` | Search result item |
| `FoodDetailSchema` | Single food with nutrients/portions |
| `NutrientInfoSchema` | Nutrient amount info |
| `NutrientListItemSchema` | Nutrient list item |
| `PortionInfoSchema` | Portion size info |
| `CategoryInfoSchema` | Category info |
| `CategoryWithCountSchema` | Category with food count |
| `CookingStateSchema` | Enum: unknown, raw, cooked |
| `CookingMethodSchema` | Enum of cooking methods |
| `PreservationSchema` | Enum of preservation methods |
| `ProcessingSchema` | Enum of processing types |

### Type Derivation

TypeScript types are derived from Zod schemas using `z.infer<>`:

```typescript
// Schema definition
export const FoodListItemSchema = z.object({
  fdcId: z.number().int(),
  description: z.string(),
  categoryId: z.number().int().nullable(),
  categoryName: z.string().optional(),
  cookingState: CookingStateSchema.optional(),
  // ...
});

// Type derived from schema (single source of truth)
export type FoodListItem = z.infer<typeof FoodListItemSchema>;
```

### Validation Behavior

| Environment | On Validation Failure |
|-------------|----------------------|
| Development | Throws error (fail fast to catch bugs) |
| Production | Logs warning, returns unvalidated data (graceful degradation) |

### Validated Endpoints

| Endpoint | Items Schema | Response Schema |
|----------|--------------|-----------------|
| `GET /foods` | `FoodListItemSchema` | `PaginatedResponse<FoodListItem>` |
| `GET /foods/:fdcId` | — | `FoodDetailSchema` |
| `GET /categories` | `CategoryInfoSchema` | `CategoriesResponseSchema` |
| `GET /categories?includeCounts` | `CategoryWithCountSchema` | `CategoriesWithCountResponseSchema` |
| `GET /nutrients` | `NutrientListItemSchema` | `PaginatedResponse<NutrientListItem>` |

### Helper Functions

Located in `src/lib/validate-response.ts`:

```typescript
// Validate full response and return NextResponse
validatedResponse(schema, data) -> NextResponse<T>

// Validate array of items, filter invalid in prod, throw in dev
validateItems(schema, items) -> T[]
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.7.0 | 2026-02-02 | Added `/ingredients` endpoints with nutrient boundaries |
| 1.6.0 | 2026-02-02 | Added API key management system |
| 1.4.0 | 2026-02-02 | Added Zod response validation for all endpoints |
| 1.3.0 | 2026-02-02 | Added food state filters (`state`, `preservation`, `processing`) |
| 1.2.0 | 2026-02-02 | Added `cookable` filter |
| 1.1.0 | 2026-02-01 | Added Foundation Foods support |
| 1.0.0 | 2026-02-01 | Initial release with SR Legacy |

---

<div style="page-break-before: always;"></div>

## Appendix A: Complete Nutrient Reference

Use `GET /api/nutrients` to retrieve the complete list of 228 nutrients. Common nutrients are listed in [Common Nutrient IDs](#common-nutrient-ids).

## Appendix B: Category Reference

| ID | Name | Food Count |
|----|------|------------|
| 1 | Dairy and Egg Products | 266 |
| 2 | Spices and Herbs | 64 |
| 3 | Baby Foods | 299 |
| 4 | Fats and Oils | 173 |
| 5 | Poultry Products | 360 |
| 6 | Soups, Sauces, and Gravies | 492 |
| 7 | Sausages and Luncheon Meats | 267 |
| 8 | Breakfast Cereals | 405 |
| 9 | Fruits and Fruit Juices | 328 |
| 10 | Pork Products | 211 |
| 11 | Vegetables and Vegetable Products | 786 |
| 12 | Nut and Seed Products | 131 |
| 13 | Beef Products | 747 |
| 14 | Beverages | 282 |
| 15 | Finfish and Shellfish Products | 234 |
| 16 | Legumes and Legume Products | 374 |
| 17 | Lamb, Veal, and Game Products | 285 |
| 18 | Baked Products | 428 |
| 19 | Sweets | 345 |
| 20 | Cereal Grains and Pasta | 177 |
| 21 | Fast Foods | 378 |
| 22 | Meals, Entrees, and Side Dishes | 204 |
| 23 | Snacks | 176 |
| 24 | American Indian/Alaska Native Foods | 165 |
| 25 | Restaurant Foods | 62 |

---

*Document generated: 2026-02-02 | API Version: 1.7.0*
