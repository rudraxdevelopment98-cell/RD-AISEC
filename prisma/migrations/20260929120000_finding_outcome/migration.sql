-- Real-world outcome polled back from the platform — the signal the engine learns
-- from ("what actually pays"). Plus paid bounty amount and when it landed.
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "outcome" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "bountyAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "outcomeAt" TIMESTAMP(3);
