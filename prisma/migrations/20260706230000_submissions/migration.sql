-- Vulnerability submission tracking (finding → submitted → accepted → bounty).
CREATE TABLE "Submission" (
  "id" TEXT NOT NULL,
  "engagementId" TEXT,
  "findingId" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'hackerone',
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "rewardCents" INTEGER NOT NULL DEFAULT 0,
  "reportUrl" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ownerEmail" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Submission_engagementId_idx" ON "Submission"("engagementId");
