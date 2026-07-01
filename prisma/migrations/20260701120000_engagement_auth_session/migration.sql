-- Authenticated-scan session for an engagement (encrypted at rest).
ALTER TABLE "Engagement" ADD COLUMN "authSession" TEXT NOT NULL DEFAULT '';
