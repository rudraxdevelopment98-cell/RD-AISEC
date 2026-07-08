-- Portal-controlled schedule for the daily self-heal / maintenance cycle.
-- Idempotent so the production self-heal build can re-run it safely.
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "maintEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "maintStartHour" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "maintEndHour" INTEGER NOT NULL DEFAULT 8;
