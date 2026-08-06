-- Attack-chain correlation: a short label when a finding forms a real attack path
-- with others on the same asset (its risk is boosted alongside). Idempotent.
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "chain" TEXT NOT NULL DEFAULT '';
