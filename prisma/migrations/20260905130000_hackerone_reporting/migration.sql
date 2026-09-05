-- HackerOne report draft-and-submit (Phase 5).
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "h1State" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "h1IntentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "h1ReportId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "h1Url" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "Integration" (
  "id" TEXT NOT NULL,
  "ownerEmail" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "username" TEXT NOT NULL DEFAULT '',
  "secret" TEXT NOT NULL DEFAULT '',
  "handle" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Integration_ownerEmail_kind_key" ON "Integration"("ownerEmail", "kind");
