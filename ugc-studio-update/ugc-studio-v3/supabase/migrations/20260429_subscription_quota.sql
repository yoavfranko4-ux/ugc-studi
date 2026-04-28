-- Migration: subscription tier + usage tracking on the users table.
--
-- Powers /api/agent quota gate (rejects the 4th basic / 9th pro / 2nd trial
-- generation) and the dashboard "videos remaining" widget. All columns are
-- added with IF NOT EXISTS guards so the migration is safe to re-run on a
-- database that was previously seeded by hand from app/api/payplus-webhook.
--
-- Defaults rationale:
--   subscription_tier='trial'         — every new row starts on trial
--   videos_used_this_period=0         — paid-tier monthly counter
--   lifetime_videos_used=0            — gates trial ("1 video for life")
--   subscription_period_start=NOW()   — first billing period anchor
--   trial_started_at=NOW()            — 3-day trial clock anchor
--
-- Existing rows (created before this migration) get the same defaults via
-- the column ADD; for trial users that means their 3-day clock starts on
-- migration day, which is the most generous reasonable interpretation.

ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier        TEXT        DEFAULT 'trial';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS videos_used_this_period  INT         DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime_videos_used     INT         DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_period_start TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at         TIMESTAMPTZ DEFAULT NOW();

-- Fast tier filter (admin views, marketing queries).
CREATE INDEX IF NOT EXISTS idx_users_subscription_tier ON users(subscription_tier);
