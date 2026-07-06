-- Portal-initiated runner restart flag.
ALTER TABLE "Runner" ADD COLUMN "restartRequested" BOOLEAN NOT NULL DEFAULT false;
