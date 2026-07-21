-- Remove the TaskEvent "realtime bus": it was built for the v2 agent, which is
-- being retired; the live runner never wrote to it. Idempotent so the production
-- self-heal build can re-run it safely.
DROP TABLE IF EXISTS "TaskEvent";
