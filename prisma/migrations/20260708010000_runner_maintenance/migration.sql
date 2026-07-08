-- Daily self-heal / maintenance cycle fields on Runner. Idempotent so the
-- production self-heal build can re-run it safely.
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "maintStage" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "maintNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "maintPct" INTEGER;
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "maintStartedAt" TIMESTAMP(3);
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "maintUpdatedAt" TIMESTAMP(3);
