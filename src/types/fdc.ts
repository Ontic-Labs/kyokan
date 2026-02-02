/**
 * TypeScript types for FoodData Central SR Legacy data
 * 
 * Types are derived from Zod schemas for runtime validation.
 */

import { z } from "zod";

// ============================================================================
// Database row types (not validated at runtime, used for type hints)
// ============================================================================

export interface FoodRow {
  fdc_id: number;
  description: string;
  data_type: string;
  category_id: number | null;
  published_date: Date | null;
  raw_json: Record<string, unknown>;
}

export interface NutrientRow {
  nutrient_id: number;
  name: string;
  unit_name: string;
  nutrient_rank: number | null;
  is_energy: boolean;
  raw_json: Record<string, unknown>;
}

export interface FoodNutrientRow {
  fdc_id: number;
  nutrient_id: number;
  amount: number;
  data_points: number | null;
  derivation_id: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
  footnote: string | null;
  raw_json: Record<string, unknown>;
}

export interface FoodCategoryRow {
  category_id: number;
  name: string;
  raw_json: Record<string, unknown>;
}

export interface MeasureUnitRow {
  measure_unit_id: number;
  name: string;
  abbreviation: string | null;
  raw_json: Record<string, unknown>;
}

export interface FoodPortionRow {
  portion_id: number;
  fdc_id: number;
  measure_unit_id: number | null;
  amount: number | null;
  gram_weight: number;
  modifier: string | null;
  sequence_number: number | null;
  raw_json: Record<string, unknown>;
}

// ============================================================================
// API Response Schemas (Zod) + Derived Types
// ============================================================================

// Enum schemas for food state
export const CookingStateSchema = z.enum(["unknown", "raw", "cooked"]);
export const CookingMethodSchema = z.enum([
  "baked", "blanched", "boiled", "braised", "broiled", "fried", "grilled",
  "microwaved", "poached", "roasted", "sauteed", "scrambled", "simmered",
  "smoked", "steamed", "stewed", "stir_fried", "toasted", "pan_fried", "deep_fried",
]);
export const PreservationSchema = z.enum([
  "unknown", "fresh", "frozen", "canned", "dried", "cured",
  "pickled", "fermented", "smoked", "shelf_stable",
]);
export const ProcessingSchema = z.enum([
  "unknown", "whole", "ground", "sliced", "diced", "shredded",
  "pureed", "paste", "powder", "flour", "juice", "oil", "broth", "stock",
]);

// Coercive number schema for DB results — pg may return integers as strings
// through Supabase's connection pooler (Supavisor).
const dbInt = z.coerce.number().int();
const dbNum = z.coerce.number();

// Category info
export const CategoryInfoSchema = z.object({
  categoryId: dbInt,
  name: z.string(),
});
export type CategoryInfo = z.infer<typeof CategoryInfoSchema>;

// Category with count
export const CategoryWithCountSchema = CategoryInfoSchema.extend({
  foodCount: dbInt.nonnegative(),
});
export type CategoryWithCount = z.infer<typeof CategoryWithCountSchema>;

// Nutrient info
export const NutrientInfoSchema = z.object({
  nutrientId: dbInt,
  name: z.string(),
  unit: z.string(),
  amount: dbNum,
});
export type NutrientInfo = z.infer<typeof NutrientInfoSchema>;

// Nutrient list item (for /nutrients endpoint)
export const NutrientListItemSchema = z.object({
  nutrientId: dbInt,
  name: z.string(),
  unit: z.string(),
  rank: dbInt.nullable(),
  isEnergy: z.boolean(),
});
export type NutrientListItem = z.infer<typeof NutrientListItemSchema>;

// Portion info
export const PortionInfoSchema = z.object({
  gramWeight: dbNum,
  amount: dbNum.nullable(),
  unit: z.string().nullable(),
  modifier: z.string().nullable(),
});
export type PortionInfo = z.infer<typeof PortionInfoSchema>;

// Food list item (for search results)
export const FoodListItemSchema = z.object({
  fdcId: dbInt,
  description: z.string(),
  categoryId: dbInt.nullable(),
  categoryName: z.string().optional(),
  dataType: z.string().optional(),
  cookingState: CookingStateSchema.optional(),
  cookingMethods: z.array(CookingMethodSchema).optional(),
  preservation: PreservationSchema.optional(),
  processing: ProcessingSchema.optional(),
  canonicalBaseName: z.string().optional(),
  canonicalBaseSlug: z.string().optional(),
  canonicalSpecificName: z.string().optional(),
  canonicalSpecificSlug: z.string().optional(),
});
export type FoodListItem = z.infer<typeof FoodListItemSchema>;

// Food detail (for single food)
export const FoodDetailSchema = z.object({
  fdcId: dbInt,
  description: z.string(),
  dataType: z.string(),
  publishedDate: z.string().nullable(),
  category: CategoryInfoSchema.nullable(),
  nutrients: z.array(NutrientInfoSchema),
  portions: z.array(PortionInfoSchema),
  canonicalBaseName: z.string().optional(),
  canonicalBaseSlug: z.string().optional(),
  canonicalSpecificName: z.string().optional(),
  canonicalSpecificSlug: z.string().optional(),
});
export type FoodDetail = z.infer<typeof FoodDetailSchema>;

// Categories response
export const CategoriesResponseSchema = z.object({
  categories: z.array(CategoryInfoSchema),
});
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;

export const CategoriesWithCountResponseSchema = z.object({
  categories: z.array(CategoryWithCountSchema),
});
export type CategoriesWithCountResponse = z.infer<typeof CategoriesWithCountResponseSchema>;

// ============================================================================
// Canonical Ingredient (recipe-first) Schemas
// ============================================================================

// Nutrient with boundaries (for ingredient detail)
export const IngredientNutrientSchema = z.object({
  nutrientId: dbInt,
  name: z.string(),
  unit: z.string(),
  median: dbNum,
  p10: dbNum.nullable(),
  p90: dbNum.nullable(),
  p25: dbNum.nullable(),
  p75: dbNum.nullable(),
  min: dbNum,
  max: dbNum,
  nSamples: dbInt,
});
export type IngredientNutrient = z.infer<typeof IngredientNutrientSchema>;

// Ingredient detail response (for /api/ingredients/:slug)
export const IngredientDetailSchema = z.object({
  canonicalId: z.string(),
  ingredientName: z.string(),
  ingredientSlug: z.string(),
  syntheticFdcId: dbInt.nullable(),
  frequency: dbInt,
  fdcCount: dbInt,
  nutrients: z.array(IngredientNutrientSchema),
});
export type IngredientDetail = z.infer<typeof IngredientDetailSchema>;

// Ingredient list item (for /api/ingredients)
export const IngredientListItemSchema = z.object({
  canonicalId: z.string(),
  ingredientName: z.string(),
  ingredientSlug: z.string(),
  syntheticFdcId: dbInt.nullable(),
  frequency: dbInt,
  fdcCount: dbInt,
  hasNutrients: z.boolean(),
});
export type IngredientListItem = z.infer<typeof IngredientListItemSchema>;

// Resolve request/response (for POST /api/ingredients/resolve)
export const ResolveRequestSchema = z.object({
  ingredients: z.array(z.string().min(1)).min(1).max(50),
});
export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;

export const MatchMethodSchema = z.enum(["direct", "alias", "fuzzy"]);
export type MatchMethod = z.infer<typeof MatchMethodSchema>;

export const ResolvedIngredientSchema = z.object({
  input: z.string(),
  match: z.object({
    ingredientName: z.string(),
    ingredientSlug: z.string(),
    canonicalId: z.string(),
    syntheticFdcId: dbInt.nullable(),
    frequency: dbInt,
    fdcCount: dbInt,
    method: MatchMethodSchema,
    confidence: dbNum,
    nutrients: z.array(IngredientNutrientSchema),
  }).nullable(),
});
export type ResolvedIngredientResponse = z.infer<typeof ResolvedIngredientSchema>;

export const ResolveResponseSchema = z.object({
  results: z.array(ResolvedIngredientSchema),
  resolved: dbInt,
  unresolved: dbInt,
});
export type ResolveResponse = z.infer<typeof ResolveResponseSchema>;

// ============================================================================
// Raw JSON types from SR Legacy file

export interface SRLegacyNutrient {
  id: number;
  number: string;
  name: string;
  rank: number;
  unitName: string;
}

export interface SRLegacyFoodNutrient {
  type: string;
  id: number;
  nutrient: SRLegacyNutrient;
  dataPoints?: number;
  amount: number;
  max?: number;
  min?: number;
  median?: number;
  footnote?: string;
  foodNutrientDerivation?: {
    code: string;
    description: string;
    foodNutrientSource?: {
      id: number;
      code: string;
      description: string;
    };
  };
}

export interface SRLegacyMeasureUnit {
  id: number;
  name: string;
  abbreviation: string;
}

export interface SRLegacyFoodPortion {
  id: number;
  value?: number;
  measureUnit: SRLegacyMeasureUnit;
  modifier?: string;
  gramWeight: number;
  sequenceNumber?: number;
  amount?: number;
}

export interface SRLegacyFoodCategory {
  description: string;
}

export interface SRLegacyFood {
  fdcId: number;
  ndbNumber?: number;
  dataType: string;
  foodClass?: string;
  description: string;
  publicationDate?: string;
  foodCategory?: SRLegacyFoodCategory;
  foodNutrients: SRLegacyFoodNutrient[];
  foodPortions?: SRLegacyFoodPortion[];
  nutrientConversionFactors?: unknown[];
  foodAttributes?: unknown[];
  isHistoricalReference?: boolean;
  inputFoods?: unknown[];
}

export interface SRLegacyFile {
  SRLegacyFoods: SRLegacyFood[];
}

// Foundation Foods types (similar structure to SR Legacy)

export interface FoundationFoodFile {
  FoundationFoods: SRLegacyFood[];
}
