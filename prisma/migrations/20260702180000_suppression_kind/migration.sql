-- allow/suppress: learning from confirmed findings protects them from suppression.
ALTER TABLE "Suppression" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'suppress';
