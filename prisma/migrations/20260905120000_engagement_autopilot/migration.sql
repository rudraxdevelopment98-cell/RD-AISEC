-- Engagement autopilot: authorized engagements the cron orchestrator runs by itself.
ALTER TABLE "Engagement" ADD COLUMN IF NOT EXISTS "autopilot" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Engagement" ADD COLUMN IF NOT EXISTS "autopilotAt" TIMESTAMP(3);
ALTER TABLE "Engagement" ADD COLUMN IF NOT EXISTS "autopilotEveryH" INTEGER NOT NULL DEFAULT 24;
CREATE INDEX IF NOT EXISTS "Engagement_autopilot_idx" ON "Engagement"("autopilot");
