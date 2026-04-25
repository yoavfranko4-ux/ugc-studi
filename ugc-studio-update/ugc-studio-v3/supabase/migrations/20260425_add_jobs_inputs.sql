-- Migration: add inputs column to the jobs table
--
-- Powers jobId auto-recovery for older saved_edits and lets the
-- regenerate-scene route rebuild the reference-image set without the
-- client sending lastGenPayload. New jobs (since this migration) have
-- jobs.inputs populated at creation time in app/api/agent/route.js with:
--   { videoType, avatarUrl, productImageUrl, businessPhotos }
--
-- Without this column the agent route logs a warning and inserts the row
-- without inputs; regen for jobs created before the column existed will
-- degrade to using only the previous-scene frame as reference.
--
-- Run this in the Supabase SQL editor, or via `psql` against the database.
-- Safe to run multiple times; uses IF NOT EXISTS guards.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS inputs JSONB NOT NULL DEFAULT '{}'::jsonb;

-- GIN index supports the lookup-by-video endpoint
-- (`.contains('result->videos', ...)`). Cheap on Supabase even for large
-- job tables. The column being indexed is `result`, not `inputs` — this
-- index already exists if a prior migration created it; the IF NOT EXISTS
-- guard makes re-running safe either way.
CREATE INDEX IF NOT EXISTS jobs_result_gin_idx
    ON jobs USING GIN (result);
