-- White-box source recon: an https git repo URL the runner clones and analyzes
-- for the engagement. Additive only.
ALTER TABLE "Engagement" ADD COLUMN "sourceRepo" TEXT NOT NULL DEFAULT '';
