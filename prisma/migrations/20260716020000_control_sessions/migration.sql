-- Interactive control: PTY terminals, file transfer, process/service control, and
-- ad-hoc installs, delivered as append-only ControlMessage rows over the unified
-- stream. Idempotent so the production self-heal build can re-run it safely.

CREATE TABLE IF NOT EXISTS "ControlSession" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'pty',
    "status" TEXT NOT NULL DEFAULT 'opening',
    "cols" INTEGER NOT NULL DEFAULT 80,
    "rows" INTEGER NOT NULL DEFAULT 24,
    "asRoot" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "ControlSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ControlSession_runnerId_status_idx" ON "ControlSession"("runnerId", "status");

CREATE TABLE IF NOT EXISTS "ControlMessage" (
    "seq" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "dir" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ControlMessage_pkey" PRIMARY KEY ("seq")
);
CREATE INDEX IF NOT EXISTS "ControlMessage_sessionId_dir_seq_idx" ON "ControlMessage"("sessionId", "dir", "seq");

-- Full-control unlock window on the runner.
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "fullControlUntil" TIMESTAMP(3);
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "fullControlBy" TEXT NOT NULL DEFAULT '';

-- FKs, guarded so a re-run can't fail on an existing constraint.
DO $$ BEGIN
  ALTER TABLE "ControlSession" ADD CONSTRAINT "ControlSession_runnerId_fkey"
    FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "ControlMessage" ADD CONSTRAINT "ControlMessage_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "ControlSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
