-- Learned false-positive suppression rules (self-improving accuracy loop).
CREATE TABLE "Suppression" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "scope"     TEXT NOT NULL DEFAULT 'global',
  "host"      TEXT NOT NULL DEFAULT '',
  "tool"      TEXT NOT NULL DEFAULT '',
  "vulnClass" TEXT NOT NULL DEFAULT '',
  "titleKey"  TEXT NOT NULL,
  "reason"    TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL DEFAULT '',
  "hits"      INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Suppression_titleKey_idx" ON "Suppression" ("titleKey");
