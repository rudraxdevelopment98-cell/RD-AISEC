-- Queue priority for jobs: higher runs first. The runner claims queued jobs
-- ordered by priority DESC, then createdAt ASC.
ALTER TABLE "Job" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

-- Index the queue-claim path (per runner, queued, ordered by priority/age).
CREATE INDEX "Job_runnerId_status_priority_createdAt_idx"
  ON "Job" ("runnerId", "status", "priority" DESC, "createdAt" ASC);
