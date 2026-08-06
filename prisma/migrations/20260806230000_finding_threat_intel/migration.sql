-- Threat-intel triage: persist KEV / EPSS / risk on each finding so the findings
-- list ranks by real-world danger (actively-exploited + exploit-probability +
-- risk score), not just static severity. Idempotent for the self-heal build.
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "kev" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "epss" DOUBLE PRECISION;
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "risk" INTEGER;
CREATE INDEX IF NOT EXISTS "Finding_engagementId_risk_idx" ON "Finding"("engagementId", "risk" DESC);
