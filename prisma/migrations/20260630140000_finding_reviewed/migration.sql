-- Human-review sign-off for high-impact findings before publication/submission.
-- Additive only.
ALTER TABLE "Finding" ADD COLUMN "reviewed" BOOLEAN NOT NULL DEFAULT false;
