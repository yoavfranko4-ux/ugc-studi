-- Migration: add regenerations_used column to the jobs table
--
-- Powers the per-scene regeneration feature in
-- app/api/agent/regenerate-scene/route.js. Without this column the endpoint
-- still works, but the per-scene rate limit ("max 3 regenerations per scene")
-- is not enforced (the route logs a warning and skips the counter update).
--
-- Shape: { "1": 0, "2": 1, "3": 2, "4": 0 }  — scene number -> times regenerated
--
-- Run this in the Supabase SQL editor, or via `psql` against the database.
-- Safe to run multiple times; uses IF NOT EXISTS guards.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS regenerations_used JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Optional: GIN index for future queries that filter jobs by regen activity.
-- Cheap on Supabase even for large job tables; safe to skip if unneeded.
CREATE INDEX IF NOT EXISTS jobs_regenerations_used_gin_idx
    ON jobs USING GIN (regenerations_used);
