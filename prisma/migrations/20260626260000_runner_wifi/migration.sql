-- AlterTable
ALTER TABLE "Runner" ADD COLUMN     "wifi" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "wifiMonitor" BOOLEAN NOT NULL DEFAULT false;
