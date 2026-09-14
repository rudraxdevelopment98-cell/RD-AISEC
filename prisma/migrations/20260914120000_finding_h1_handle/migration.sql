-- HackerOne program handle chosen at draft time (used at submit).
ALTER TABLE "Finding" ADD COLUMN IF NOT EXISTS "h1Handle" TEXT NOT NULL DEFAULT '';
