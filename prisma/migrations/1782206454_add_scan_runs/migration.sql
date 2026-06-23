-- CreateTable ScanRun
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "scanType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanRun_engagementId_idx" ON "ScanRun"("engagementId");

-- AddForeignKey
ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
