-- app_secrets — server-side rotating secrets table.
--
-- Purpose: persist values that ROTATE at runtime (e.g. Higgsfield's 7-day
-- refresh_token, which the /refresh endpoint rotates on every successful
-- exchange). Storing them only in process memory means each Railway deploy
-- — or container restart — wipes the rotated value and we fall back to the
-- stale env var, breaking auth.
--
-- Access: service-role only. RLS is enabled with NO policies so anon and
-- authenticated roles get an empty result; the service-role key bypasses RLS
-- and is the only path the server uses anyway.
--
-- Initial bootstrap is manual: after running this migration, insert the
-- current valid refresh_token via the Supabase SQL editor:
--
--   INSERT INTO app_secrets (key, value)
--     VALUES ('higgsfield_refresh_token', 'PASTE_NEW_TOKEN_HERE')
--     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

CREATE TABLE IF NOT EXISTS app_secrets (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app_secrets IS 'Server-side rotating secrets (e.g. higgsfield_refresh_token). Service-role only — no RLS policies on purpose.';
