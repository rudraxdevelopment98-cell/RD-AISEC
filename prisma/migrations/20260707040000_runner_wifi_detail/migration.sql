-- Per-adapter chipset/driver detail on a runner (drives AirSight device options).
ALTER TABLE "Runner" ADD COLUMN "wifiDetail" TEXT NOT NULL DEFAULT '';
