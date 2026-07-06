-- Detailed machine stats reported by the runner for the resource monitor.
ALTER TABLE "Runner" ADD COLUMN "memUsedMb" INTEGER;
ALTER TABLE "Runner" ADD COLUMN "memTotalMb" INTEGER;
ALTER TABLE "Runner" ADD COLUMN "diskUsedMb" INTEGER;
ALTER TABLE "Runner" ADD COLUMN "diskTotalMb" INTEGER;
ALTER TABLE "Runner" ADD COLUMN "cores" INTEGER;
ALTER TABLE "Runner" ADD COLUMN "uptimeSec" INTEGER;
