-- Accumulated monitor-mode RF survey vantages for the auto home map.
CREATE TABLE "WifiSurvey" (
    "id" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WifiSurvey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WifiSurvey_ownerEmail_key" ON "WifiSurvey"("ownerEmail");
