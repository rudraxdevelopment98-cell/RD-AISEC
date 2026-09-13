-- Exploit-validator proof (P1): how a finding was proven + short evidence.
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "proof" TEXT NOT NULL DEFAULT '';
