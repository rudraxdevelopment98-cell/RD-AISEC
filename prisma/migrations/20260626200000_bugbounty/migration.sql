-- CreateTable
CREATE TABLE "BugAccount" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'hackerone',
    "handle" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "ownerEmail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BugAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugProgram" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'hackerone',
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "outScope" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "reward" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "ownerEmail" TEXT NOT NULL DEFAULT '',
    "engagementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugProgram_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BugProgram" ADD CONSTRAINT "BugProgram_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
