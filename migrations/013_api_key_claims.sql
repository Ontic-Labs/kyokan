-- Migration 013: API Key Claims
-- Simple tracking for which env-var keys have been claimed

CREATE TABLE api_key_claims (
    id SERIAL PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,        -- SHA-256 hash of the key (never store plain key)
    claimed_by VARCHAR(255) NOT NULL,     -- Email of claimer
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT                            -- Optional notes
);

CREATE INDEX idx_api_key_claims_hash ON api_key_claims(key_hash);

COMMENT ON TABLE api_key_claims IS 'Tracks which API keys from API_KEYS env var have been claimed';
COMMENT ON COLUMN api_key_claims.key_hash IS 'SHA-256 hash of the claimed key';
