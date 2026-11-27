-- SportMatch – event editing + players the organizer already has ("guests")
--
-- guest_count = players the organizer brings who are NOT registered in the app
-- (the organizer counts separately as a participant). Taken spots = joined app users + guest_count.

alter table public.events add column guest_count int not null default 0 check (guest_count >= 0);
alter table public.events add constraint events_guests_lt_max check (guest_count < max_participants);

-- New events: status depends on how many spots are already taken
create or replace function public.before_event_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.starts_at < now() - interval '5 minutes' then
    raise exception 'event must start in the future';
  end if;
  if 1 + new.guest_count >= new.max_participants then
    new.status := 'full';
    new.filled_at := now();
  else
    new.status := 'open';
    new.filled_at := null;
  end if;
  return new;
end $$;

-- Organizer edits: keep derived columns, validate, recompute open/full
create or replace function public.protect_event_columns() returns trigger
language plpgsql set search_path = public as $$
declare
  v_joined int;
begin
  if coalesce(current_setting('app.internal', true), '') = 'on' then
    return new;
  end if;
  new.organizer_id := old.organizer_id;
  new.team_imbalance := old.team_imbalance;
  new.team_imbalance_random := old.team_imbalance_random;
  new.teams_generated_at := old.teams_generated_at;
  new.created_at := old.created_at;
  new.status := old.status;
  new.filled_at := old.filled_at;

  if old.status in ('cancelled', 'completed') then
    raise exception 'אי אפשר לערוך אירוע שבוטל או שהסתיים';
  end if;
  if new.starts_at is distinct from old.starts_at and new.starts_at < now() then
    raise exception 'מועד האירוע חייב להיות בעתיד';
  end if;

  select count(*) into v_joined from event_participants where event_id = new.id and status = 'joined';
  if v_joined + new.guest_count > new.max_participants then
    raise exception 'כבר תפוסים % מקומות (% רשומים באפליקציה + % שלך) – אי אפשר להגדיר רק % משתתפים',
      v_joined + new.guest_count, v_joined, new.guest_count, new.max_participants;
  end if;
  if v_joined + new.guest_count >= new.max_participants then
    new.status := 'full';
    new.filled_at := coalesce(old.filled_at, now());
  else
    new.status := 'open';
    new.filled_at := null;
  end if;
  return new;
end $$;

-- Tell registered participants when the time / place / price changes
create or replace function public.after_event_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.internal', true), '') = 'on' then
    return new;
  end if;
  if new.starts_at is distinct from old.starts_at
     or new.lat is distinct from old.lat or new.lng is distinct from old.lng
     or new.address is distinct from old.address
     or new.price_ils is distinct from old.price_ils then
    insert into notifications (user_id, event_id, kind, message)
    select ep.user_id, new.id, 'updated', format('פרטי "%s" עודכנו – כדאי לבדוק מועד ומיקום', new.title)
    from event_participants ep
    where ep.event_id = new.id and ep.status = 'joined' and ep.user_id <> new.organizer_id;
  end if;
  return new;
end $$;

create trigger events_after_update
  after update on public.events
  for each row execute function public.after_event_update();

revoke execute on function public.after_event_update() from public, anon, authenticated;

-- Join: guests take spots too
create or replace function public.join_event(p_event uuid, p_source text default 'browse')
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  e events%rowtype;
  v_count int;
  v_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_source not in ('recommendation', 'browse', 'link') then p_source := 'browse'; end if;

  select * into e from events where id = p_event for update;
  if not found then raise exception 'האירוע לא נמצא'; end if;
  if e.status = 'cancelled' then raise exception 'האירוע בוטל'; end if;
  if e.starts_at <= now() then raise exception 'האירוע כבר התחיל'; end if;

  if exists (select 1 from event_participants where event_id = p_event and user_id = v_uid and status = 'joined') then
    return json_build_object('ok', true, 'already', true);
  end if;

  select count(*) + e.guest_count into v_count from event_participants where event_id = p_event and status = 'joined';
  if v_count >= e.max_participants then raise exception 'האירוע מלא'; end if;

  insert into event_participants (event_id, user_id, source)
  values (p_event, v_uid, p_source)
  on conflict (event_id, user_id) do update
    set status = 'joined', source = excluded.source, joined_at = now(), paid = false, team = null;

  insert into user_sports (user_id, sport_id, self_level) values (v_uid, e.sport_id, e.level)
  on conflict do nothing;

  update recommendation_log set joined = true where user_id = v_uid and event_id = p_event;

  select full_name into v_name from profiles where id = v_uid;
  perform private.notify(e.organizer_id, p_event, 'joined',
                 format('%s הצטרף/ה ל"%s"', coalesce(nullif(v_name, ''), 'משתתף חדש'), e.title));

  v_count := v_count + 1;
  if v_count >= e.max_participants then
    perform set_config('app.internal', 'on', true);
    update events set status = 'full', filled_at = now() where id = p_event;
    perform set_config('app.internal', 'off', true);
    perform private.notify(e.organizer_id, p_event, 'full', format('"%s" מלא! 🎉', e.title));
  end if;
  return json_build_object('ok', true, 'joined_count', v_count);
end $$;

-- Candidates: taken spots include guests (joined_count returned includes them)
create or replace function private.compute_candidates(
  p_user uuid, p_lat float8, p_lng float8, p_sport smallint default null)
returns table (
  event_id uuid, distance_km float8, joined_count int,
  f_sport float8, f_level float8, f_distance float8, f_time float8, f_rating float8, f_history float8)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_maxd int;
  v_slots smallint[];
begin
  select max_distance_km, pref_slots into v_maxd, v_slots from profiles where id = p_user;
  return query
  with cand as (
    select e.id, e.sport_id, e.starts_at, e.max_participants,
           ((select count(*) from event_participants ep
              where ep.event_id = e.id and ep.status = 'joined') + e.guest_count)::int as jc,
           case when p_lat is null or p_lng is null then null
                else haversine_km(p_lat, p_lng, e.lat, e.lng) end as d
    from events e
    where e.status = 'open'
      and e.starts_at > now()
      and (p_sport is null or e.sport_id = p_sport)
      and not exists (select 1 from event_participants ep
                       where ep.event_id = e.id and ep.user_id = p_user and ep.status = 'joined')
  )
  select c.id,
         c.d,
         c.jc,
         (case when exists (select 1 from user_sports us
                             where us.user_id = p_user and us.sport_id = c.sport_id)
               then 1.0 else 0.0 end)::float8,
         greatest(0.0, 1 - abs(user_level(p_user, c.sport_id) - event_level(c.id)) / 4.0)::float8,
         (case when c.d is null then 0.5 else exp(-c.d / 7.0) end)::float8,
         (case when coalesce(array_length(v_slots, 1), 0) = 0 then 0.5
               when time_slot(c.starts_at) = any (v_slots) then 1.0
               else 0.0 end)::float8,
         event_reputation(c.id)::float8,
         history_affinity(p_user, c.id)::float8
  from cand c
  where c.jc < c.max_participants
    and (c.d is null or c.d <= coalesce(v_maxd, 20));
end $$;

-- KPIs: occupancy includes the organizer's guests
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v json;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  with past as (
    select e.*, (select count(*) from event_participants ep
                 where ep.event_id = e.id and ep.status in ('joined', 'attended')) + e.guest_count as jc
    from events e where e.starts_at < now()
  ), joins as (
    select ep.* from event_participants ep where ep.source <> 'organizer'
  )
  select json_build_object(
    'users_total', (select count(*) from profiles),
    'users_onboarded', (select count(*) from profiles where onboarded),
    'active_7d', (select count(*) from profiles where last_seen_at > now() - interval '7 days'),
    'active_30d', (select count(*) from profiles where last_seen_at > now() - interval '30 days'),
    'events_total', (select count(*) from events),
    'events_upcoming', (select count(*) from events where starts_at > now() and status in ('open', 'full')),
    'events_cancelled', (select count(*) from events where status = 'cancelled'),
    'past_events', (select count(*) from past where status <> 'cancelled'),
    'fill_rate', (select round(avg(case when jc >= max_participants then 1.0 else 0.0 end), 3)
                  from past where status <> 'cancelled'),
    'avg_occupancy', (select round(avg(least(1.0, jc::numeric / max_participants)), 3)
                      from past where status <> 'cancelled'),
    'avg_hours_to_fill', (select round(avg(extract(epoch from filled_at - created_at) / 3600)::numeric, 1)
                          from events where filled_at is not null),
    'joins_total', (select count(*) from joins),
    'joins_from_recommendation', (select count(*) from joins where source = 'recommendation'),
    'impressions', (select count(*) from recommendation_log),
    'impressions_joined', (select count(*) from recommendation_log where joined),
    'ratings_total', (select count(*) from ratings),
    'teams_balanced', (select count(*) from events where teams_generated_at is not null),
    'avg_team_imbalance', (select round(avg(team_imbalance)::numeric, 2) from events where team_imbalance is not null),
    'avg_team_imbalance_random', (select round(avg(team_imbalance_random)::numeric, 2) from events where team_imbalance_random is not null),
    'retention_30d', (
      select round(avg(case when exists (
          select 1 from event_participants ep join events e on e.id = ep.event_id
          where ep.user_id = p.id and ep.joined_at > p.created_at + interval '1 day'
            and ep.joined_at <= p.created_at + interval '30 days') then 1.0 else 0.0 end), 3)
      from profiles p where p.created_at < now() - interval '1 day'),
    'weekly', (
      select coalesce(json_agg(w order by w.wk), '[]'::json) from (
        select to_char(g.week, 'DD/MM') as week, g.week as wk,
               (select count(*) from profiles where date_trunc('week', created_at) = g.week) as signups,
               (select count(*) from events where date_trunc('week', created_at) = g.week) as events,
               (select count(*) from joins where date_trunc('week', joined_at) = g.week) as joins
        from generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') as g(week)
      ) w),
    'by_sport', (
      select coalesce(json_agg(x), '[]'::json) from (
        select s.name_he, s.emoji, count(e.id) as events
        from sports s left join events e on e.sport_id = s.id
        group by s.id order by count(e.id) desc) x),
    'page_views_7d', (select count(*) from app_events where name = 'page_view' and created_at > now() - interval '7 days')
  ) into v;
  return v;
end $$;
