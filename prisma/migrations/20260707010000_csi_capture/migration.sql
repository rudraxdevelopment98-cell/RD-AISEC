-- Latest CSI ("WiFi camera") analysis per owner, upserted by a CSI collector.
CREATE TABLE "CsiCapture" (
    "id" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '',
    "frames" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CsiCapture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CsiCapture_ownerEmail_key" ON "CsiCapture"("ownerEmail");
