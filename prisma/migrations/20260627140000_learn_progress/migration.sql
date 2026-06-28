-- CreateTable
CREATE TABLE "LearnProgress" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearnProgress_key_ownerEmail_key" ON "LearnProgress"("key", "ownerEmail");
