-- Self-healing runner enrollment: a reusable, owner-scoped, expiring code a
-- machine uses to obtain a runner token (instead of hand-pasting one). Idempotent.
CREATE TABLE IF NOT EXISTS "EnrollCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL DEFAULT 50,
    "lastUsedAt" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnrollCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EnrollCode_codeHash_key" ON "EnrollCode"("codeHash");
CREATE INDEX IF NOT EXISTS "EnrollCode_ownerEmail_idx" ON "EnrollCode"("ownerEmail");

-- Stable machine id so a re-enrolling machine reclaims its runner row in place.
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "fingerprint" TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "Runner_fingerprint_idx" ON "Runner"("fingerprint");
