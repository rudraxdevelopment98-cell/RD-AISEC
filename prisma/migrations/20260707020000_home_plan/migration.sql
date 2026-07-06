-- The user's home floor plan (rooms + walls + WiFi node positions) for 3D sensing.
CREATE TABLE "HomePlan" (
    "id" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HomePlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomePlan_ownerEmail_key" ON "HomePlan"("ownerEmail");
