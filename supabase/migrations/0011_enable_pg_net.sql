-- Async HTTP from the database (used to hand new notifications to the send-push Edge Function).
-- Live only: the local test runner skips this file and uses a stand-in.
create extension if not exists pg_net with schema extensions;
