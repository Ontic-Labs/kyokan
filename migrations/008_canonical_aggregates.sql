-- Migration 008: Canonical ingredient aggregates as first-class foods
-- Creates synthetic FDC entries (9,200,000+) for canonical ingredient aggregates
-- Each aggregate represents a statistical composite of all foods sharing a canonical name

-- Sequence for synthetic canonical IDs (starting at 9,200,000)
CREATE SEQUENCE IF NOT EXISTS canonical_aggregate_id_seq
  START WITH 9200000
  INCREMENT BY 1
  MINVALUE 9200000
  MAXVALUE 9299999
  NO CYCLE;

-- Master table for canonical aggregates
-- These are inserted into foods table with synthetic FDC IDs
CREATE TABLE IF NOT EXISTS canonical_aggregates (
  canonical_id BIGINT PRIMARY KEY DEFAULT nextval('canonical_aggregate_id_seq'),
  
  -- Identity
  canonical_name TEXT NOT NULL,
  canonical_slug TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('base', 'specific')),
  
  -- Unique on (slug, level) since different canonical_names can map to same slug
  CONSTRAINT canonical_aggregates_slug_level_key UNIQUE (canonical_slug, level),
  
  -- Aggregate metadata
  food_count INT NOT NULL DEFAULT 0,
  data_types TEXT[] NOT NULL DEFAULT '{}',  -- e.g., ['SR Legacy', 'Foundation']
  
  -- Representative food (most common or highest quality source)
  representative_fdc_id BIGINT REFERENCES foods(fdc_id),
  
  -- Audit
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canonical_version TEXT NOT NULL DEFAULT '1.0.0'
);

CREATE INDEX IF NOT EXISTS idx_canonical_aggregates_slug
  ON canonical_aggregates (canonical_slug);

CREATE INDEX IF NOT EXISTS idx_canonical_aggregates_name_trgm
  ON canonical_aggregates USING GIN (canonical_name gin_trgm_ops);

-- Junction table linking aggregates to their source foods
CREATE TABLE IF NOT EXISTS canonical_aggregate_sources (
  canonical_id BIGINT NOT NULL REFERENCES canonical_aggregates(canonical_id) ON DELETE CASCADE,
  fdc_id BIGINT NOT NULL REFERENCES foods(fdc_id) ON DELETE CASCADE,
  
  -- Source metadata
  data_type TEXT NOT NULL,
  description TEXT NOT NULL,
  
  PRIMARY KEY (canonical_id, fdc_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_aggregate_sources_fdc
  ON canonical_aggregate_sources (fdc_id);

-- Aggregate nutrient statistics (median, p5, p95 across source foods)
CREATE TABLE IF NOT EXISTS canonical_aggregate_nutrients (
  canonical_id BIGINT NOT NULL REFERENCES canonical_aggregates(canonical_id) ON DELETE CASCADE,
  nutrient_id INT NOT NULL REFERENCES nutrients(nutrient_id),
  
  -- Statistical values per 100g
  median_amount NUMERIC,
  p5_amount NUMERIC,    -- 5th percentile
  p95_amount NUMERIC,   -- 95th percentile
  min_amount NUMERIC,
  max_amount NUMERIC,
  sample_count INT NOT NULL DEFAULT 0,
  
  PRIMARY KEY (canonical_id, nutrient_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_aggregate_nutrients_nutrient
  ON canonical_aggregate_nutrients (nutrient_id);

-- Mark synthetic foods
ALTER TABLE foods ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS canonical_aggregate_id BIGINT REFERENCES canonical_aggregates(canonical_id);

CREATE INDEX IF NOT EXISTS idx_foods_synthetic
  ON foods (is_synthetic) WHERE is_synthetic = TRUE;

COMMENT ON TABLE canonical_aggregates IS 'Synthetic FDC entries (9,200,000+) representing statistical composites of foods sharing a canonical name';
COMMENT ON COLUMN canonical_aggregates.canonical_id IS 'Synthetic FDC ID in range 9,200,000-9,299,999';
COMMENT ON TABLE canonical_aggregate_nutrients IS 'Statistical nutrient values (median, percentiles) computed across all source foods';
