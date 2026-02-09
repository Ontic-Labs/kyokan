/**
 * Shared constants for the data pipeline
 *
 * Only whole-food ingredient categories are permitted in canonical_fdc_membership.
 * If an FDC food's category is not in this list, it is rejected.
 */

export const ALLOWED_CATEGORIES = [
  "Beef Products",
  "Vegetables and Vegetable Products",
  "Lamb, Veal, and Game Products",
  "Pork Products",
  "Poultry Products",
  "Fruits and Fruit Juices",
  "Dairy and Egg Products",
  "Finfish and Shellfish Products",
  "Legumes and Legume Products",
  "Cereal Grains and Pasta",
  "Beverages",
  "Fats and Oils",
  "Nut and Seed Products",
  "Spices and Herbs",
] as const;

export type AllowedCategory = (typeof ALLOWED_CATEGORIES)[number];
