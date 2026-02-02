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

// Category info
export const CategoryInfoSchema = z.object({
  categoryId: z.number().int(),
  name: z.string(),
});
export type CategoryInfo = z.infer<typeof CategoryInfoSchema>;

// Category with count
export const CategoryWithCountSchema = CategoryInfoSchema.extend({
  foodCount: z.number().int().nonnegative(),
});
export type CategoryWithCount = z.infer<typeof CategoryWithCountSchema>;

// Nutrient info
export const NutrientInfoSchema = z.object({
  nutrientId: z.number().int(),
  name: z.string(),
  unit: z.string(),
  amount: z.number(),
});
export type NutrientInfo = z.infer<typeof NutrientInfoSchema>;

// Nutrient list item (for /nutrients endpoint)
export const NutrientListItemSchema = z.object({
  nutrientId: z.number().int(),
  name: z.string(),
  unit: z.string(),
  rank: z.number().int().nullable(),
  isEnergy: z.boolean(),
});
export type NutrientListItem = z.infer<typeof NutrientListItemSchema>;

// Portion info
export const PortionInfoSchema = z.object({
  gramWeight: z.number(),
  amount: z.number().nullable(),
  unit: z.string().nullable(),
  modifier: z.string().nullable(),
});
export type PortionInfo = z.infer<typeof PortionInfoSchema>;

// Food list item (for search results)
export const FoodListItemSchema = z.object({
  fdcId: z.number().int(),
  description: z.string(),
  categoryId: z.number().int().nullable(),
  categoryName: z.string().optional(),
  dataType: z.string().optional(),
  cookingState: CookingStateSchema.optional(),
  cookingMethods: z.array(CookingMethodSchema).optional(),
  preservation: PreservationSchema.optional(),
  processing: ProcessingSchema.optional(),
});
export type FoodListItem = z.infer<typeof FoodListItemSchema>;

// Food detail (for single food)
export const FoodDetailSchema = z.object({
  fdcId: z.number().int(),
  description: z.string(),
  dataType: z.string(),
  publishedDate: z.string().nullable(),
  category: CategoryInfoSchema.nullable(),
  nutrients: z.array(NutrientInfoSchema),
  portions: z.array(PortionInfoSchema),
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
