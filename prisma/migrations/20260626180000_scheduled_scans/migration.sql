-- CreateTable
CREATE TABLE "ScheduledScan" (
    "id" TEXT NOT NULL,
    "targets" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ownerEmail" TEXT NOT NULL DEFAULT '',
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledScan_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ScheduledScan" ADD CONSTRAINT "ScheduledScan_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

