-- CreateTable
CREATE TABLE "NotifySetting" (
    "id" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL DEFAULT '',
    "discordWebhook" TEXT NOT NULL DEFAULT '',
    "minSeverity" TEXT NOT NULL DEFAULT 'high',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotifySetting_pkey" PRIMARY KEY ("id")
);
