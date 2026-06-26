-- AlterTable
ALTER TABLE "Runner" ADD COLUMN     "installed" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Install" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "output" TEXT NOT NULL DEFAULT '',
    "exitCode" INTEGER,
    "requestedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Install_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Install" ADD CONSTRAINT "Install_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

