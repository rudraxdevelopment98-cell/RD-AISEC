-- GPU + power/battery stats reported by the runner.
ALTER TABLE "Runner" ADD COLUMN "gpuPct" INTEGER;
ALTER TABLE "Runner" ADD COLUMN "batteryPct" INTEGER;
ALTER TABLE "Runner" ADD COLUMN "charging" BOOLEAN;
ALTER TABLE "Runner" ADD COLUMN "powerW" INTEGER;
