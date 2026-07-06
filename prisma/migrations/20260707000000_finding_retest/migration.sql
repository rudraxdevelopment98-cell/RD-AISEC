-- Remediation retest loop on findings (pentest deliverable).
ALTER TABLE "Finding" ADD COLUMN "retest" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Finding" ADD COLUMN "retestNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Finding" ADD COLUMN "retestedAt" TIMESTAMP(3);
