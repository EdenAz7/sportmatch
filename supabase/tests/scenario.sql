-- End-to-end scenario test for the local database. Run with ON_ERROR_STOP.
\set QUIET on
\pset format unaligned
\pset tuples_only on

-- users
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001', 'org@test', '{"full_name":"דני מארגן"}'),
 ('00000000-0000-0000-0000-000000000002', 'u2@test', '{"full_name":"יוסי"}'),
 ('00000000-0000-0000-0000-000000000003', 'u3@test', '{"full_name":"מיכל"}'),
 ('00000000-0000-0000-0000-000000000004', 'u4@test', '{"full_name":"אבי"}'),
 ('00000000-0000-0000-0000-000000000005', 'u5@test', '{"full_name":"רון"}'),
 ('00000000-0000-0000-0000-0000000000aa', 'admin@test', '{"full_name":"אדמין"}');

update profiles set home_lat = 32.08, home_lng = 34.78, city = 'תל אביב', onboarded = true, phone = '050000000' || right(id::text, 1);
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000aa';
update profiles set pref_slots = '{2,5}' where id = '00000000-0000-0000-0000-000000000002';
insert into user_sports values
 ('00000000-0000-0000-0000-000000000002', 1, 3),
 ('00000000-0000-0000-0000-000000000003', 1, 5),
 ('00000000-0000-0000-0000-000000000004', 2, 2);

select 'profiles created: ' || count(*) from profiles;

-- organiser creates an event (as authenticated user)
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
insert into events (organizer_id, sport_id, title, city, lat, lng, starts_at, max_participants, level, price_ils, bit_link)
values ('00000000-0000-0000-0000-000000000001', 1, 'כדורגל בפארק', 'תל אביב', 32.09, 34.79,
        date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem' + interval '2 days 19 hours',
        4, 3, 40, 'https://www.bitpay.co.il/app/share-info?i=123');
insert into events (organizer_id, sport_id, title, city, lat, lng, starts_at, max_participants, level)
values ('00000000-0000-0000-0000-000000000001', 2, 'כדורסל רחוק', 'חיפה', 32.79, 34.99, now() + interval '3 days', 10, 2);
select 'organizer auto-joined: ' || count(*) from event_participants;

-- u2 gets recommendations
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select 'u2 recs: ' || string_agg(format('%s rank=%s d=%s fs=%s fl=%s fd=%s ft=%s fr=%s fh=%s pct=%s',
         left(event_id::text, 8), rank, round(distance_km::numeric, 1), f_sport, round(f_level::numeric, 2),
         round(f_distance::numeric, 2), f_time, round(f_rating::numeric, 2), f_history, match_pct), ' | ')
from recommend_events();

-- RLS: direct insert into participants must fail
do $$ begin
  insert into event_participants (event_id, user_id) select id, auth.uid() from events limit 1;
  raise exception 'FAIL: direct insert allowed';
exception when insufficient_privilege then raise notice 'ok: direct participant insert blocked';
end $$;
-- RLS: user can't escalate role
do $$ begin
  update profiles set role = 'admin' where id = auth.uid();
  raise exception 'FAIL: role escalation allowed';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok: role escalation blocked (%)', sqlerrm;
end $$;
-- u2 can't edit organiser's event
update events set title = 'hacked' where title = 'כדורגל בפארק';
select 'title after hack attempt: ' || title from events where sport_id = 1;

select 'join u2: ' || join_event((select id from events where sport_id = 1), 'recommendation')::text;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select 'join u3: ' || join_event((select id from events where sport_id = 1), 'browse')::text;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select 'join u4: ' || join_event((select id from events where sport_id = 1), 'link')::text;
reset role;
select 'status after 4/4: ' || status || ' filled_at set: ' || (filled_at is not null) from events where sport_id = 1;
select 'u2 impression labelled joined: ' || joined from recommendation_log where user_id = '00000000-0000-0000-0000-000000000002' and event_id = (select id from events where sport_id = 1);
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
do $$ begin
  perform join_event((select id from events where sport_id = 1));
  raise exception 'FAIL: joined full event';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok: full event rejected (%)', sqlerrm;
end $$;
-- full events are not recommended
select 'u5 recs (football should be absent): ' || coalesce(string_agg(left(event_id::text, 8), ','), 'none') from recommend_events();

select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select 'leave u4: ' || leave_event((select id from events where sport_id = 1))::text;
reset role;
select 'status after leave: ' || status from events where sport_id = 1;
set role authenticated;

-- teams + details as organiser
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select save_teams((select id from events where sport_id = 1),
  '[{"user_id":"00000000-0000-0000-0000-000000000001","team":1},{"user_id":"00000000-0000-0000-0000-000000000002","team":2},{"user_id":"00000000-0000-0000-0000-000000000003","team":1}]',
  0.5, 2.0);
select 'details: ' || (get_event_details((select id from events where sport_id = 1)) -> 'participants')::text;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
select 'non-member sees organizer phone: ' || coalesce(get_event_details((select id from events where sport_id = 1)) -> 'organizer' ->> 'phone', 'hidden');

-- move the event to the past, rate, check level estimate
reset role;
select null from set_config('app.internal', 'on', false);
update events set starts_at = now() - interval '2 hours' where sport_id = 1;
select null from set_config('app.internal', 'off', false);
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select 'ratings saved: ' || submit_ratings((select id from events where sport_id = 1),
  '[{"user_id":"00000000-0000-0000-0000-000000000002","skill":5,"sportsmanship":5},{"user_id":"00000000-0000-0000-0000-000000000003","skill":5,"sportsmanship":5}]');
reset role;
select 'u2 level est after a 5-star rating (self 3): ' || round(user_level('00000000-0000-0000-0000-000000000002', 1::smallint)::numeric, 3)
  || ', reputation: ' || round(user_reputation('00000000-0000-0000-0000-000000000002')::numeric, 3);
select private.hourly_maintenance();
select 'notifications: ' || string_agg(kind, ',' order by id) from notifications;

-- ---------------------------------------------------------------
-- Calibration: synthetic impressions from a known "true" model
-- true: bias -3, sport 2.5, level 3.0, distance 2.0, time 0.3, rating 0, history 2.0
-- ---------------------------------------------------------------
alter table recommendation_log drop constraint recommendation_log_event_id_fkey; -- local test only
select setseed(0.42);
insert into recommendation_log (user_id, event_id, f_sport, f_level, f_distance, f_time, f_rating, f_history, joined)
select '00000000-0000-0000-0000-000000000005', gen_random_uuid(), fs, fl, fd, ft, fr, fh,
       random() < 1 / (1 + exp(-(-3 + 2.5 * fs + 3.0 * fl + 2.0 * fd + 0.3 * ft + 0 * fr + 2.0 * fh)))
from (select (random() < 0.6)::int::float8 fs, random() fl, random() fd,
             (array[0, 0.5, 1])[1 + floor(random() * 3)::int] ft, random() fr,
             (random() < 0.2)::int * random() fh
      from generate_series(1, 2000)) x
on conflict do nothing;
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ begin
  perform calibrate_weights();
  raise exception 'FAIL: non-admin calibrated';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok: non-admin calibration blocked';
end $$;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
\timing on
select format('calibrated: bias=%s sport=%s level=%s dist=%s time=%s rating=%s hist=%s | n=%s pos=%s | logloss %s -> %s | auc %s -> %s | acc %s',
  round(bias::numeric,2), round(w_sport::numeric,2), round(w_level::numeric,2), round(w_distance::numeric,2),
  round(w_time::numeric,2), round(w_rating::numeric,2), round(w_history::numeric,2), training_size, positives,
  round(baseline_log_loss::numeric,3), round(log_loss::numeric,3), round(baseline_auc::numeric,3), round(auc::numeric,3), round(accuracy::numeric,3))
from calibrate_weights(1500, 2.0, 0.001);
\timing off
select 'active weights rows: ' || count(*) from match_weights where active;
select 'admin stats: ' || admin_stats()::text;

-- hardening checks
set role anon;
select null from set_config('request.jwt.claim.sub', '', false);
do $$ begin
  perform join_event(gen_random_uuid());
  raise exception 'FAIL: anon could call join_event';
exception when insufficient_privilege then raise notice 'ok: anon blocked from join_event';
end $$;
select 'anon can view event page: ' || (get_event_details((select id from events where sport_id = 1)) is not null);
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ begin
  perform history_affinity(auth.uid(), gen_random_uuid());
  raise exception 'FAIL: helper exposed';
exception when insufficient_privilege then raise notice 'ok: internal helper not callable';
end $$;
select 'trigger still fires after revoke: ' || count(*) from (
  select 1 from events e where e.organizer_id = '00000000-0000-0000-0000-000000000001') x;
insert into events (organizer_id, sport_id, title, city, lat, lng, starts_at, max_participants)
values ('00000000-0000-0000-0000-000000000002', 1, 'בדיקת טריגר', 'תל אביב', 32.08, 34.78, now() + interval '1 day', 6);
select 'organizer auto-joined after revoke: ' || count(*) from event_participants ep join events e on e.id = ep.event_id where e.title = 'בדיקת טריגר';
select 'recs after hardening: ' || count(*) from recommend_events();
reset role;

-- guests + editing
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
insert into events (organizer_id, sport_id, title, city, lat, lng, starts_at, max_participants, guest_count)
values ('00000000-0000-0000-0000-000000000003', 1, 'עם חברים', 'תל אביב', 32.08, 34.78, now() + interval '2 days', 6, 3);
select 'guests: status after create (1+3 of 6): ' || status from events where title = 'עם חברים';
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select 'u4 sees joined_count incl guests: ' || joined_count from recommend_events() where event_id = (select id from events where title = 'עם חברים');
select 'u4 join: ' || join_event((select id from events where title = 'עם חברים'))::text;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
select 'u5 join (last spot): ' || join_event((select id from events where title = 'עם חברים'))::text;
reset role;
select 'status when 3 app + 3 guests of 6: ' || status from events where title = 'עם חברים';
set role authenticated;
-- u5 (not organizer) cannot edit
update events set max_participants = 50 where title = 'עם חברים';
select 'max after non-organizer edit: ' || max_participants from events where title = 'עם חברים';
-- organizer edits: more spots -> open again, participants notified of time change
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
update events set max_participants = 8, starts_at = starts_at + interval '1 hour' where title = 'עם חברים';
select 'after organizer edit to 8: status=' || status || ' filled_at null=' || (filled_at is null) from events where title = 'עם חברים';
do $$ begin
  update events set max_participants = 4 where title = 'עם חברים';
  raise exception 'FAIL: shrink below taken allowed';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok: shrink blocked (%)', sqlerrm;
end $$;
do $$ begin
  update events set starts_at = now() - interval '1 day' where title = 'עם חברים';
  raise exception 'FAIL: moved to past';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'ok: past date blocked';
end $$;
reset role;
select 'update notifications: ' || count(*) from notifications where kind = 'updated';

-- ---------------------------------------------------------------
-- cancellation policy + waitlist
-- ---------------------------------------------------------------
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
insert into events (organizer_id, sport_id, title, city, lat, lng, starts_at, max_participants, price_ils, level)
values ('00000000-0000-0000-0000-000000000001', 1, 'מדיניות', 'תל אביב', 32.08, 34.78, now() + interval '2 days', 3, 40, 3.5);
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select 'A join: ' || join_event((select id from events where title = 'מדיניות'))::text;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select 'B join: ' || join_event((select id from events where title = 'מדיניות'))::text;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
do $$ begin perform join_event((select id from events where title = 'מדיניות')); raise exception 'FAIL'; 
exception when raise_exception then if sqlerrm = 'FAIL' then raise; end if; raise notice 'ok: C cannot join full event'; end $$;
select 'C waitlist: ' || join_waitlist((select id from events where title = 'מדיניות'))::text;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
select 'D waitlist: ' || join_waitlist((select id from events where title = 'מדיניות'))::text;
-- organizer marks A paid
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select set_paid((select id from events where title = 'מדיניות'), '00000000-0000-0000-0000-000000000002', true);
-- A cancels 2 days before: free, full refund, C promoted
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select 'A leaves (>24h): ' || leave_event((select id from events where title = 'מדיניות'))::text;
reset role;
select 'after A: ' || string_agg(left(user_id::text, 1) || right(user_id::text, 1) || '=' || status || coalesce(' refund=' || refund_due, '') || case when promoted_at is not null then ' promoted' else '' end, ', ' order by user_id)
  from event_participants where event_id = (select id from events where title = 'מדיניות');
select 'C notified: ' || message from notifications where kind = 'promoted' and user_id = '00000000-0000-0000-0000-000000000004';
select null from set_config('app.internal', 'on', false);
update events set starts_at = now() + interval '10 hours' where title = 'מדיניות';
select null from set_config('app.internal', 'off', false);
set role authenticated;
-- B (did not pay) cancels 10h before: late, no refund, D promoted
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select 'B leaves (10h): ' || leave_event((select id from events where title = 'מדיניות'))::text;
reset role;
select 'B late flag: ' || late_cancel || ', B reputation: ' || round(user_reputation('00000000-0000-0000-0000-000000000003')::numeric, 3) from event_participants where user_id = '00000000-0000-0000-0000-000000000003' and event_id = (select id from events where title = 'מדיניות');
select null from set_config('app.internal', 'on', false);
update events set starts_at = now() + interval '2 hours' where title = 'מדיניות';
select null from set_config('app.internal', 'off', false);
-- C was promoted two days earlier in real time
update event_participants set promoted_at = now() - interval '2 days' where user_id = '00000000-0000-0000-0000-000000000004' and event_id = (select id from events where title = 'מדיניות');
set role authenticated;
-- C (promoted 2 days before) cannot cancel in the last 3h
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
do $$ begin perform leave_event((select id from events where title = 'מדיניות')); raise exception 'FAIL';
exception when raise_exception then if sqlerrm = 'FAIL' then raise; end if; raise notice 'ok: locked in last 3h (%)', sqlerrm; end $$;
-- D (promoted inside the last 24h) can still cancel without penalty
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
select 'D leaves (promoted recently, 2h): ' || leave_event((select id from events where title = 'מדיניות'))::text;
-- organizer view: refunds + status
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select 'refunds for organizer: ' || (get_event_details((select id from events where title = 'מדיניות')) -> 'refunds')::text;
select set_refunded((select id from events where title = 'מדיניות'), '00000000-0000-0000-0000-000000000002', true);
select 'refund marked done: ' || refund_done from event_participants where user_id = '00000000-0000-0000-0000-000000000002' and event_id = (select id from events where title = 'מדיניות');
reset role;
select 'event status after D left: ' || status from events where title = 'מדיניות';
-- waitlist promotion when organizer adds spots
set role authenticated;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
insert into events (organizer_id, sport_id, title, city, lat, lng, starts_at, max_participants, price_ils)
values ('00000000-0000-0000-0000-000000000001', 1, 'הגדלה', 'תל אביב', 32.08, 34.78, now() + interval '3 days', 2, 0);
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select 'join small: ' || join_event((select id from events where title = 'הגדלה'))::text;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select 'wait small: ' || join_waitlist((select id from events where title = 'הגדלה'))::text;
select null from set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
update events set max_participants = 4 where title = 'הגדלה';
reset role;
select 'after adding spots: ' || string_agg(right(user_id::text, 1) || '=' || status, ', ' order by user_id) || ' | event ' || (select status from events where title = 'הגדלה')
  from event_participants where event_id = (select id from events where title = 'הגדלה');
-- level ranges
select 'levels stored as midpoints: ' || string_agg(distinct self_level::text, ',') from user_sports;
select 'event level default: ' || level from events where title = 'הגדלה';
