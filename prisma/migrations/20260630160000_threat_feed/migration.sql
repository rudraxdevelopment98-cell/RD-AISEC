-- Threat intelligence feed (CISA KEV etc.) synced by a runner. Additive only.
CREATE TABLE "ThreatFeed" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ThreatFeed_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ThreatFeed_kind_key" ON "ThreatFeed"("kind");
