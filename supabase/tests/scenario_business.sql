-- Business side (facility owners) + push queueing. Runs after scenario.sql.
\set QUIET on
\pset format unaligned
\pset tuples_only on

set role authenticated;
-- u5 becomes a facility owner and publishes a facility (tries to self-verify)
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
select become_facility_owner();
insert into facilities (owner_id, name, city, address, lat, lng, sport_ids, price_per_hour, verified)
values ('00000000-0000-0000-0000-000000000005', 'מגרשי הפארק', 'רמת גן', 'דרך אבא הלל 1', 32.07, 34.82, '{1,5}', 300, true);
select 'self-verify blocked: ' || (not verified) from facilities where name = 'מגרשי הפארק';
-- owner edits: name ok, verified stays false
update facilities set name = 'מגרשי הפארק רמת גן', verified = true where name = 'מגרשי הפארק';
select 'edit ok, still unverified: ' || name || ' / ' || verified || ' / updated_at set=' || (updated_at is not null) from facilities where owner_id = '00000000-0000-0000-0000-000000000005';
-- slots
insert into facility_slots (facility_id, starts_at, duration_min)
select id, date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem' + interval '4 days 20 hours', 90 from facilities where owner_id = auth.uid();
insert into facility_slots (facility_id, starts_at, duration_min, price_ils)
select id, date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem' + interval '5 days 21 hours', 60, 250 from facilities where owner_id = auth.uid();
do $$ begin
  insert into facility_slots (facility_id, starts_at) select id, now() - interval '1 hour' from facilities where owner_id = auth.uid();
  raise exception 'FAIL';
exception when raise_exception then if sqlerrm = 'FAIL' then raise; end if; raise notice 'ok: past slot blocked (%)', sqlerrm; end $$;
-- a non-owner can't add slots or facilities
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ begin
  insert into facility_slots (facility_id, starts_at) select id, now() + interval '2 days' from facilities limit 1;
  raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'ok: non-owner slot insert blocked'; end $$;
do $$ begin
  insert into facilities (owner_id, name, city, lat, lng) values (auth.uid(), 'שלי', 'חולון', 32, 34.8);
  raise exception 'FAIL';
exception when insufficient_privilege then raise notice 'ok: regular user cannot add a facility'; end $$;
select 'open slots for football: ' || count(*) from open_slots(null, 1::smallint);
select 'open slots for tennis: ' || count(*) from open_slots(null, 3::smallint);

-- organizer books the first slot (sends wrong time/place on purpose – the slot wins)
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
insert into events (organizer_id, sport_id, title, city, lat, lng, starts_at, max_participants, facility_slot_id)
select '00000000-0000-0000-0000-000000000001', 1, 'משחק במתקן', 'חיפה', 32.8, 35.0, now() + interval '10 days', 10, s.id
from open_slots() s order by s.starts_at limit 1;
reset role;
select 'booked game: city=' || e.city || ' facility=' || f.name || ' time matches slot=' || (e.starts_at = s.starts_at) || ' duration=' || e.duration_min
from events e join facility_slots s on s.id = e.facility_slot_id join facilities f on f.id = e.facility_id where e.title = 'משחק במתקן';
select 'owner notified: ' || message from notifications where user_id = '00000000-0000-0000-0000-000000000005' and kind = 'facility_booked';
set role authenticated;
select 'open slots after booking: ' || count(*) from open_slots();
-- someone else tries the same slot
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$ begin
  insert into events (organizer_id, sport_id, title, city, lat, lng, starts_at, max_participants, facility_slot_id)
  select auth.uid(), 1, 'כפול', 'x', 32, 34, now() + interval '3 days', 10, facility_slot_id from events where title = 'משחק במתקן';
  raise exception 'FAIL';
exception when raise_exception then if sqlerrm = 'FAIL' then raise; end if; raise notice 'ok: double booking blocked (%)', sqlerrm; end $$;
-- owner can't delete a booked slot
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
delete from facility_slots where id = (select facility_slot_id from events where title = 'משחק במתקן');
select 'booked slot still exists: ' || count(*) from facility_slots where id = (select facility_slot_id from events where title = 'משחק במתקן');
select 'owner dashboard: ' || (get_my_facilities() -> 0 -> 'stats')::text;
select 'owner sees organizer phone: ' || (get_my_facilities() -> 0 -> 'events' -> 0 ->> 'organizer_phone');
-- organizer moves the game to another time -> slot released, owner told
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
update events set starts_at = starts_at + interval '1 hour' where title = 'משחק במתקן';
reset role;
select 'after move: slot released=' || (facility_slot_id is null) from events where title = 'משחק במתקן';
select 'owner told about move: ' || count(*) from notifications where user_id = '00000000-0000-0000-0000-000000000005' and kind = 'facility_updated';
set role authenticated;
select 'open slots after move: ' || count(*) from open_slots();
-- book again, then cancel -> slot free again, owner told
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
insert into events (organizer_id, sport_id, title, city, lat, lng, starts_at, max_participants, facility_slot_id)
select auth.uid(), 5, 'כדורעף במתקן', 'x', 32, 34, now() + interval '3 days', 8, s.id from open_slots() s order by s.starts_at limit 1;
select 'open slots after 2nd booking: ' || count(*) from open_slots();
select cancel_event((select id from events where title = 'כדורעף במתקן'));
select 'open slots after cancel: ' || count(*) from open_slots();
reset role;
select 'owner told about cancel: ' || message from notifications where user_id = '00000000-0000-0000-0000-000000000005' and kind = 'facility_cancelled';
-- admin verifies + metrics
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$ begin perform set_facility_verified((select id from facilities limit 1), true); raise exception 'FAIL';
exception when raise_exception then if sqlerrm = 'FAIL' then raise; end if; raise notice 'ok: non-admin cannot verify'; end $$;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select set_facility_verified((select id from facilities limit 1), true);
select 'verified by admin: ' || verified from facilities limit 1;
select 'admin facility stats: ' || (admin_facility_stats()::jsonb - 'list')::text;

-- push: subscribe u2, queue on new notification only when configured
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select save_push_subscription('https://push.example/abc', 'p256', 'authkey', 'test-agent');
select send_test_push();
reset role;
select 'calls without config: ' || count(*) from net._calls;
insert into private.app_config values ('push_url', 'https://x.supabase.co/functions/v1/send-push'), ('push_secret', 's3cret');
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select send_test_push();
select 'own subscriptions visible: ' || count(*) from push_subscriptions;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select 'other user sees: ' || count(*) from push_subscriptions;
select send_test_push();  -- u3 has no device -> no call
reset role;
select 'queued: ' || count(*) || ' -> ' || min(url) || ' kind=' || min(body ->> 'kind') || ' secret header=' || min(headers ->> 'x-push-secret') from net._calls;
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select delete_push_subscription('https://push.example/abc');
select 'after unsubscribe: ' || count(*) from push_subscriptions;
reset role;
