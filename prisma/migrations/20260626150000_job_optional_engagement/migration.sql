-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_engagementId_fkey";

-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "engagementId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

