-- AlterTable
ALTER TABLE "BugAccount" ADD COLUMN     "apiUser" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "apiToken" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncStatus" TEXT NOT NULL DEFAULT '';
