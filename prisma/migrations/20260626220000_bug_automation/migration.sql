-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "autoImport" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BugProgram" ADD COLUMN     "auto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoRunnerId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastAutoAt" TIMESTAMP(3);
