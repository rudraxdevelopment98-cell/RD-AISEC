-- Live machine stats reported by the runner for the footer activity monitor.
ALTER TABLE "Runner" ADD COLUMN "cpuPct" INTEGER;
ALTER TABLE "Runner" ADD COLUMN "memPct" INTEGER;
ALTER TABLE "Runner" ADD COLUMN "tempC" INTEGER;
ALTER TABLE "Runner" ADD COLUMN "loadAvg" TEXT NOT NULL DEFAULT '';
