-- AirSight rolling history (device sightings + presence timeline) per owner.
CREATE TABLE "AirsightLog" (
    "id" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AirsightLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AirsightLog_ownerEmail_key" ON "AirsightLog"("ownerEmail");
