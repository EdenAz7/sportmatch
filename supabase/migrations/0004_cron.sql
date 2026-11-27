-- Hourly maintenance: mark finished events, send reminders and rating requests.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('sportmatch-hourly', '7 * * * *', $$select private.hourly_maintenance()$$);
