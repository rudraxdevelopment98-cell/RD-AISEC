-- Runner v2 realtime bus: durable, append-only per-job event log the UI tails by
-- cursor (`seq`). Idempotent so the production self-heal build can re-run it.
CREATE TABLE IF NOT EXISTS "TaskEvent" (
    "seq" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'progress',
    "step" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("seq")
);

CREATE INDEX IF NOT EXISTS "TaskEvent_jobId_seq_idx" ON "TaskEvent"("jobId", "seq");

-- FK to Job, guarded so a re-run can't fail on an existing constraint.
DO $$ BEGIN
  ALTER TABLE "TaskEvent"
    ADD CONSTRAINT "TaskEvent_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
