-- Migration 009: Recipe-first canonical ingredients
--
-- Normalized schema per docs/recipe-first-architecture.md section 11.1.
-- Four tables separate concerns: raw vocab, canonical registry, aliases, FDC membership.
--
-- Recipe ingredient names (from real recipe corpora) ARE the canonical identities.
-- No LLM inference, no regex derivation — just counted human consensus.

-- ---------------------------------------------------------------------------
-- 1. Recipe ingredient vocabulary (raw corpus data)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recipe_ingredient_vocab (
  vocab_id       bigserial PRIMARY KEY,
  ingredient_text text NOT NULL,                 -- exact string as found in corpus
  ingredient_norm text NOT NULL,                 -- normalized (lower, trim, collapse ws)
  count          bigint NOT NULL DEFAULT 0,      -- frequency in corpus
  source         text NOT NULL DEFAULT 'food-com', -- corpus identifier
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, ingredient_norm)
);

CREATE INDEX IF NOT EXISTS idx_vocab_count
  ON recipe_ingredient_vocab (count DESC);

CREATE INDEX IF NOT EXISTS idx_vocab_norm_trgm
  ON recipe_ingredient_vocab USING gin (ingredient_norm gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. Canonical ingredient registry
-- ---------------------------------------------------------------------------

-- Sequence for synthetic FDC IDs (9,000,000 range = recipe-derived)
CREATE SEQUENCE IF NOT EXISTS recipe_ingredient_synthetic_seq
  START WITH 9000000
  INCREMENT BY 1
  MINVALUE 9000000
  MAXVALUE 9099999;

CREATE TABLE IF NOT EXISTS canonical_ingredient (
  canonical_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name   text NOT NULL,                -- chosen canonical string ("ground beef")
  canonical_slug   text NOT NULL UNIQUE,         -- "ground-beef"
  canonical_rank   bigint NOT NULL,              -- frequency-based priority (1 = most common)
  total_count      bigint NOT NULL,              -- aggregate count across all aliases
  synthetic_fdc_id bigint UNIQUE DEFAULT nextval('recipe_ingredient_synthetic_seq'),
  version          text NOT NULL DEFAULT '1.0.0',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_name_trgm
  ON canonical_ingredient USING gin (canonical_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_canonical_rank
  ON canonical_ingredient (canonical_rank);

-- ---------------------------------------------------------------------------
-- 3. Canonical aliases (bias control + portability)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS canonical_ingredient_alias (
  canonical_id   uuid NOT NULL REFERENCES canonical_ingredient(canonical_id) ON DELETE CASCADE,
  alias_norm     text NOT NULL,                  -- normalized alias string
  alias_count    bigint NOT NULL DEFAULT 0,      -- frequency of this specific alias
  alias_source   text NOT NULL DEFAULT 'corpus', -- 'corpus', 'manual', 'uk-corpus', etc.
  PRIMARY KEY (canonical_id, alias_norm)
);

CREATE INDEX IF NOT EXISTS idx_alias_norm_trgm
  ON canonical_ingredient_alias USING gin (alias_norm gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 4. FDC membership (join table — not an array)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS canonical_fdc_membership (
  canonical_id       uuid NOT NULL REFERENCES canonical_ingredient(canonical_id) ON DELETE CASCADE,
  fdc_id             bigint NOT NULL REFERENCES foods(fdc_id) ON DELETE CASCADE,
  membership_reason  text NOT NULL,              -- 'canonical_bridge', 'base_bridge', 'substring', etc.
  weight             double precision NOT NULL DEFAULT 1.0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_id, fdc_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_fdc_id
  ON canonical_fdc_membership (fdc_id);
