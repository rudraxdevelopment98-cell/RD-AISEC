-- Two-account IDOR/BOLA testing: a second account's session (encrypted at rest)
-- plus a marker unique to account A's data. The runner replays each object
-- endpoint as A / B / anon; a leak of A's marker into B's or anon's response is a
-- confirmed broken-object-level-authorization finding. Additive + idempotent.
ALTER TABLE "Engagement" ADD COLUMN IF NOT EXISTS "authSessionB" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Engagement" ADD COLUMN IF NOT EXISTS "idorMarker" TEXT NOT NULL DEFAULT '';
