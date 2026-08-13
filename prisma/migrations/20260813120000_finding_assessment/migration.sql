-- Persist the master-policy assessment on each finding so the findings list can
-- filter/sort by policy state, engine confidence, and estimated bug-bounty
-- acceptance % — instead of only computing them at render time. Additive +
-- idempotent (safe for the self-heal build). Legacy rows keep NULL/'' until the
-- next enrich pass (ingest or recomputeEngagementIntel) stamps them.
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "state" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "confScore" INTEGER;
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "bbProb" INTEGER;
CREATE INDEX IF NOT EXISTS "Finding_engagementId_state_idx" ON "Finding"("engagementId", "state");
