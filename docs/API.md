# Kyokon API Reference

> REST API for USDA FoodData Central SR Legacy and Foundation Foods data.
>
> **Kyokon** (巨根) — it means exactly what you think it means. 🍆

Base URL: `http://localhost:3000/api` (development)

---

## Table of Contents

- [Overview](#overview)
- [Pagination](#pagination)
- [Endpoints](#endpoints)
  - [GET /foods](#get-foods)
  - [GET /foods/:fdcId](#get-foodsfdcid)
  - [GET /categories](#get-categories)
  - [GET /nutrients](#get-nutrients)
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
| 1.4.0 | 2026-02-02 | Added Zod response validation for all endpoints |
| 1.3.0 | 2026-02-02 | Added food state filters (`state`, `preservation`, `processing`) |
| 1.2.0 | 2026-02-02 | Added `cookable` filter |
| 1.1.0 | 2026-02-01 | Added Foundation Foods support |
| 1.0.0 | 2026-02-01 | Initial release with SR Legacy |
