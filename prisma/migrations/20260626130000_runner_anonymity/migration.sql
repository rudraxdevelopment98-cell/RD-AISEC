-- AlterTable
ALTER TABLE "Runner" ADD COLUMN     "anonymity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "exitIp" TEXT NOT NULL DEFAULT '';

