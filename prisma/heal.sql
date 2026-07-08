-- Self-heal for Prisma P3009: clear any migration recorded as failed / in-progress
-- (finished_at IS NULL) so `migrate deploy` can re-apply our idempotent migrations.
-- Runs before migrate deploy at build time; a normal deploy has no such rows, so
-- this is a harmless no-op then.
DELETE FROM "_prisma_migrations" WHERE finished_at IS NULL;
