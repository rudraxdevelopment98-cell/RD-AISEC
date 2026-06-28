-- Per-machine parallelism: how many jobs a runner runs at once (portal-controlled).
ALTER TABLE "Runner" ADD COLUMN "maxWorkers" INTEGER NOT NULL DEFAULT 3;
