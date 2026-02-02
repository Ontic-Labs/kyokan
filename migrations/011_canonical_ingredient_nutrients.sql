-- Migration 011: Canonical ingredient nutrient boundaries
--
-- Stores aggregated nutrient statistics (median, percentiles, min/max)
-- per canonical ingredient, computed from canonical_fdc_membership + food_nutrients.
--
-- One row per (canonical_id, nutrient_id).
-- Follows the recipe-first architecture: canonical_ingredient → canonical_fdc_membership → food_nutrients.

CREATE TABLE IF NOT EXISTS canonical_ingredient_nutrients (
  canonical_id   uuid NOT NULL REFERENCES canonical_ingredient(canonical_id) ON DELETE CASCADE,
  nutrient_id    bigint NOT NULL REFERENCES nutrients(nutrient_id),
  unit_name      text NOT NULL,

  -- Central tendency
  median         double precision NOT NULL,

  -- Boundaries
  p10            double precision,
  p90            double precision,
  p25            double precision,
  p75            double precision,

  -- Raw extremes (debugging)
  min_amount     double precision,
  max_amount     double precision,

  -- Sample metadata
  n_samples      int NOT NULL,       -- foods with this nutrient present
  n_total        int NOT NULL,       -- total member foods

  computed_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (canonical_id, nutrient_id)
);

CREATE INDEX IF NOT EXISTS idx_cin_nutrient
  ON canonical_ingredient_nutrients (nutrient_id);

COMMENT ON TABLE canonical_ingredient_nutrients IS
  'Aggregated nutrient statistics per canonical ingredient, computed from FDC member foods';
