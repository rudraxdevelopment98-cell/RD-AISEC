-- Per-adapter chipset/driver detail on a runner (drives AirSight device options).
-- Idempotent: safe even if a preview build already added the column.
ALTER TABLE "Runner" ADD COLUMN IF NOT EXISTS "wifiDetail" TEXT NOT NULL DEFAULT '';
