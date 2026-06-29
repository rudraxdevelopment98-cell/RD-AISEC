-- Self-healing auto-retry: how many times the portal has re-queued a job after a
-- recoverable runner-side failure. Additive only.
ALTER TABLE "Job" ADD COLUMN "retries" INTEGER NOT NULL DEFAULT 0;
