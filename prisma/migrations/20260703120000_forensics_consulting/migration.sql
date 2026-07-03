-- Digital Forensics: evidence register + chain of custody
CREATE TABLE "Evidence" (
  "id" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'file',
  "source" TEXT NOT NULL DEFAULT '',
  "hashAlgo" TEXT NOT NULL DEFAULT 'sha256',
  "hashValue" TEXT NOT NULL DEFAULT '',
  "size" TEXT NOT NULL DEFAULT '',
  "storage" TEXT NOT NULL DEFAULT '',
  "acquiredBy" TEXT NOT NULL DEFAULT '',
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Evidence_engagementId_idx" ON "Evidence"("engagementId");
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CustodyEvent" (
  "id" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "action" TEXT NOT NULL DEFAULT 'note',
  "actor" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustodyEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustodyEvent_evidenceId_idx" ON "CustodyEvent"("evidenceId");
ALTER TABLE "CustodyEvent" ADD CONSTRAINT "CustodyEvent_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Security Consulting: framework assessments + control results
CREATE TABLE "Assessment" (
  "id" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "framework" TEXT NOT NULL DEFAULT 'custom',
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Assessment_engagementId_idx" ON "Assessment"("engagementId");
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ControlResult" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "controlId" TEXT NOT NULL,
  "domain" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'na',
  "maturity" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT NOT NULL DEFAULT '',
  "recommendation" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "ControlResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ControlResult_assessmentId_idx" ON "ControlResult"("assessmentId");
ALTER TABLE "ControlResult" ADD CONSTRAINT "ControlResult_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
