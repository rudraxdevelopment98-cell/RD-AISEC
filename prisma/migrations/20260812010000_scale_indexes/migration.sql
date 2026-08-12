-- Scale hardening: indexes for the hot query paths and the multi-owner
-- ownerEmail scoping added across the app. All idempotent (CREATE INDEX IF NOT
-- EXISTS) and additive — safe to re-run, no data change. Names follow Prisma's
-- convention so `migrate diff` stays clean.

-- Job: the status-first "adopt any queued job" claim path + per-engagement lookups.
CREATE INDEX IF NOT EXISTS "Job_status_priority_createdAt_idx" ON "Job"("status", "priority" DESC, "createdAt");
CREATE INDEX IF NOT EXISTS "Job_engagementId_idx" ON "Job"("engagementId");

-- Finding: findings-list filters + the category filter chips.
CREATE INDEX IF NOT EXISTS "Finding_status_severity_idx" ON "Finding"("status", "severity");
CREATE INDEX IF NOT EXISTS "Finding_category_idx" ON "Finding"("category");

-- Install: the per-runner pending/installing lookups.
CREATE INDEX IF NOT EXISTS "Install_runnerId_status_idx" ON "Install"("runnerId", "status");

-- ScanRun / ScheduledScan: engagement scoping + cron's enabled filter.
CREATE INDEX IF NOT EXISTS "ScanRun_engagementId_idx" ON "ScanRun"("engagementId");
CREATE INDEX IF NOT EXISTS "ScheduledScan_engagementId_idx" ON "ScheduledScan"("engagementId");
CREATE INDEX IF NOT EXISTS "ScheduledScan_enabled_idx" ON "ScheduledScan"("enabled");

-- Multi-owner isolation: list/scoped queries filter by ownerEmail.
CREATE INDEX IF NOT EXISTS "Engagement_ownerEmail_idx" ON "Engagement"("ownerEmail");
CREATE INDEX IF NOT EXISTS "Runner_ownerEmail_idx" ON "Runner"("ownerEmail");
CREATE INDEX IF NOT EXISTS "Runner_lastSeenAt_idx" ON "Runner"("lastSeenAt");
CREATE INDEX IF NOT EXISTS "BugProgram_ownerEmail_idx" ON "BugProgram"("ownerEmail");
CREATE INDEX IF NOT EXISTS "BugProgram_auto_status_idx" ON "BugProgram"("auto", "status");
CREATE INDEX IF NOT EXISTS "Submission_ownerEmail_idx" ON "Submission"("ownerEmail");
CREATE INDEX IF NOT EXISTS "Resource_ownerEmail_idx" ON "Resource"("ownerEmail");
