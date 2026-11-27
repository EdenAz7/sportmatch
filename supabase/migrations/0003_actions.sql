-- SportMatch – actions (RPCs). All writes to participants / ratings go through here.

create or replace function private.notify(p_user uuid, p_event uuid, p_kind text, p_message text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, event_id, kind, message) values (p_user, p_event, p_kind, p_message)
$$;

-- Join an event (capacity-safe)
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

  select count(*) into v_count from event_participants where event_id = p_event and status = 'joined';
  if v_count >= e.max_participants then raise exception 'האירוע מלא'; end if;

  insert into event_participants (event_id, user_id, source)
  values (p_event, v_uid, p_source)
  on conflict (event_id, user_id) do update
    set status = 'joined', source = excluded.source, joined_at = now(), paid = false, team = null;

  -- the user now plays this sport; give them a level if they have none
  insert into user_sports (user_id, sport_id, self_level) values (v_uid, e.sport_id, e.level)
  on conflict do nothing;

  -- label the impression as a positive example for calibration
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

create or replace function public.leave_event(p_event uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  e events%rowtype;
  v_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into e from events where id = p_event for update;
  if not found then raise exception 'האירוע לא נמצא'; end if;
  if e.organizer_id = v_uid then raise exception 'מארגן לא יכול לעזוב – אפשר לבטל את האירוע'; end if;
  if e.starts_at <= now() then raise exception 'האירוע כבר התחיל'; end if;

  update event_participants set status = 'left', team = null
  where event_id = p_event and user_id = v_uid and status = 'joined';
  if not found then return json_build_object('ok', true); end if;

  update recommendation_log set joined = false where user_id = v_uid and event_id = p_event;

  if e.status = 'full' then
    perform set_config('app.internal', 'on', true);
    update events set status = 'open', filled_at = null where id = p_event;
    perform set_config('app.internal', 'off', true);
  end if;
  select full_name into v_name from profiles where id = v_uid;
  perform private.notify(e.organizer_id, p_event, 'left',
                 format('%s עזב/ה את "%s"', coalesce(nullif(v_name, ''), 'משתתף'), e.title));
  return json_build_object('ok', true);
end $$;

create or replace function public.cancel_event(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  e events%rowtype;
begin
  select * into e from events where id = p_event for update;
  if not found then raise exception 'האירוע לא נמצא'; end if;
  if e.organizer_id <> auth.uid() and not is_admin() then raise exception 'רק המארגן יכול לבטל'; end if;
  perform set_config('app.internal', 'on', true);
  update events set status = 'cancelled' where id = p_event;
  perform set_config('app.internal', 'off', true);
  insert into notifications (user_id, event_id, kind, message)
  select ep.user_id, p_event, 'cancelled', format('האירוע "%s" בוטל', e.title)
  from event_participants ep
  where ep.event_id = p_event and ep.status = 'joined' and ep.user_id <> e.organizer_id;
end $$;

create or replace function public.set_paid(p_event uuid, p_user uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from events where id = p_event and organizer_id = auth.uid()) then
    raise exception 'רק המארגן יכול לעדכן תשלום';
  end if;
  update event_participants set paid = p_paid where event_id = p_event and user_id = p_user;
end $$;

-- After the game: organiser marks who actually came (feeds reputation)
create or replace function public.set_attendance(p_event uuid, p_user uuid, p_attended boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from events where id = p_event and organizer_id = auth.uid() and starts_at < now()) then
    raise exception 'אפשר לסמן נוכחות רק אחרי האירוע, ורק המארגן';
  end if;
  update event_participants
     set status = case when p_attended then 'attended' else 'no_show' end::participant_status
   where event_id = p_event and user_id = p_user and status in ('joined', 'attended', 'no_show');
end $$;

-- Save the balanced teams computed on the client.
-- p_teams: [{"user_id": "...", "team": 1}, ...]
create or replace function public.save_teams(
  p_event uuid, p_teams jsonb, p_imbalance float8, p_imbalance_random float8)
returns void language plpgsql security definer set search_path = public as $$
declare
  e events%rowtype;
begin
  select * into e from events where id = p_event;
  if not found or e.organizer_id <> auth.uid() then raise exception 'רק המארגן יכול לחלק לקבוצות'; end if;

  update event_participants ep set team = (t ->> 'team')::smallint
  from jsonb_array_elements(p_teams) t
  where ep.event_id = p_event and ep.user_id = (t ->> 'user_id')::uuid and ep.status = 'joined';

  perform set_config('app.internal', 'on', true);
  update events set team_imbalance = p_imbalance, team_imbalance_random = p_imbalance_random,
                    teams_generated_at = now()
  where id = p_event;
  perform set_config('app.internal', 'off', true);

  insert into notifications (user_id, event_id, kind, message)
  select ep.user_id, p_event, 'teams', format('הקבוצות ל"%s" מוכנות – את/ה בקבוצה %s', e.title, ep.team)
  from event_participants ep
  where ep.event_id = p_event and ep.status = 'joined' and ep.team is not null and ep.user_id <> e.organizer_id;
end $$;

-- Rate other participants after the game. p_ratings: [{"user_id","skill","sportsmanship"}]
create or replace function public.submit_ratings(p_event uuid, p_ratings jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  e events%rowtype;
  v_n int;
begin
  select * into e from events where id = p_event;
  if not found then raise exception 'האירוע לא נמצא'; end if;
  if e.starts_at > now() then raise exception 'אפשר לדרג רק אחרי האירוע'; end if;
  if e.starts_at < now() - interval '14 days' then raise exception 'עבר הזמן לדירוג האירוע'; end if;
  if not exists (select 1 from event_participants where event_id = p_event and user_id = v_uid
                 and status in ('joined', 'attended')) then
    raise exception 'רק משתתפים יכולים לדרג';
  end if;

  insert into ratings (event_id, rater_id, ratee_id, skill, sportsmanship)
  select p_event, v_uid, (r ->> 'user_id')::uuid,
         least(5, greatest(1, (r ->> 'skill')::int)),
         least(5, greatest(1, (r ->> 'sportsmanship')::int))
  from jsonb_array_elements(p_ratings) r
  where (r ->> 'user_id')::uuid <> v_uid
    and exists (select 1 from event_participants ep where ep.event_id = p_event
                and ep.user_id = (r ->> 'user_id')::uuid and ep.status in ('joined', 'attended'))
  on conflict (event_id, rater_id, ratee_id) do update
    set skill = excluded.skill, sportsmanship = excluded.sportsmanship, created_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Event page data: participants with names, levels, reputation; phones only where appropriate.
create or replace function public.get_event_details(p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  e events%rowtype;
  v_is_org boolean;
  v_is_member boolean;
  v_result json;
begin
  select * into e from events where id = p_event;
  if not found then return null; end if;
  v_is_org := e.organizer_id = v_uid;
  v_is_member := exists (select 1 from event_participants where event_id = p_event and user_id = v_uid
                         and status in ('joined', 'attended', 'no_show'));

  select json_build_object(
    'event', to_json(e),
    'sport', (select to_json(s) from sports s where s.id = e.sport_id),
    'facility', (select json_build_object('id', f.id, 'name', f.name, 'phone', f.phone)
                 from facilities f where f.id = e.facility_id),
    'organizer', (select json_build_object(
                    'id', p.id, 'full_name', p.full_name,
                    'phone', case when v_is_member then p.phone end,
                    'reputation', round(user_reputation(p.id)::numeric, 2))
                  from profiles p where p.id = e.organizer_id),
    'event_level', round(event_level(e.id)::numeric, 2),
    'is_organizer', v_is_org,
    'is_member', v_is_member,
    'my_status', (select status from event_participants where event_id = p_event and user_id = v_uid),
    'my_ratings_done', (select count(*) from ratings where event_id = p_event and rater_id = v_uid),
    'participants', coalesce((
      select json_agg(json_build_object(
               'user_id', ep.user_id, 'full_name', p.full_name, 'status', ep.status,
               'paid', ep.paid, 'team', ep.team, 'source', ep.source, 'joined_at', ep.joined_at,
               'level', round(user_level(ep.user_id, e.sport_id)::numeric, 2),
               'reputation', round(user_reputation(ep.user_id)::numeric, 2),
               'phone', case when v_is_org then p.phone end)
             order by ep.joined_at)
      from event_participants ep join profiles p on p.id = ep.user_id
      where ep.event_id = p_event and ep.status in ('joined', 'attended', 'no_show')), '[]'::json)
  ) into v_result;
  return v_result;
end $$;

-- Lightweight presence + analytics
create or replace function public.touch() returns void
language sql security definer set search_path = public as $$
  update profiles set last_seen_at = now() where id = auth.uid()
$$;

create or replace function public.become_facility_owner() returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set role = 'facility_owner' where id = auth.uid() and role = 'user';
end $$;

-- Public profile card (no phone)
create or replace function public.get_public_profile(p_user uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', p.id, 'full_name', p.full_name, 'city', p.city, 'created_at', p.created_at,
    'reputation', round(user_reputation(p.id)::numeric, 2),
    'games', (select count(*) from event_participants ep join events e on e.id = ep.event_id
              where ep.user_id = p.id and ep.status in ('joined', 'attended') and e.starts_at < now()),
    'sports', coalesce((select json_agg(json_build_object('sport_id', l.sport_id,
                         'level', round(l.level_est::numeric, 2), 'n_ratings', l.n_ratings))
                        from private.user_sport_levels l where l.user_id = p.id), '[]'::json))
  from profiles p where p.id = p_user and auth.uid() is not null
$$;

-- ---------------------------------------------------------------
-- KPIs for the admin dashboard (before/after metrics for the report)
-- ---------------------------------------------------------------
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v json;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  with past as (
    select e.*, (select count(*) from event_participants ep
                 where ep.event_id = e.id and ep.status in ('joined', 'attended')) as jc
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

-- ---------------------------------------------------------------
-- Hourly maintenance (scheduled with pg_cron on Supabase)
-- ---------------------------------------------------------------
create or replace function private.hourly_maintenance()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.internal', 'on', true);
  update events set status = 'completed'
  where status in ('open', 'full') and starts_at + make_interval(mins => duration_min) < now();
  perform set_config('app.internal', 'off', true);

  -- reminder ~24h before
  insert into notifications (user_id, event_id, kind, message)
  select ep.user_id, e.id, 'reminder',
         format('תזכורת: "%s" מחר ב-%s', e.title, to_char(e.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI'))
  from events e join event_participants ep on ep.event_id = e.id and ep.status = 'joined'
  where e.status in ('open', 'full') and e.starts_at between now() and now() + interval '24 hours'
    and not exists (select 1 from notifications n where n.user_id = ep.user_id and n.event_id = e.id and n.kind = 'reminder');

  -- ask to rate after the game
  insert into notifications (user_id, event_id, kind, message)
  select ep.user_id, e.id, 'rate', format('איך היה "%s"? דרג/י את השחקנים', e.title)
  from events e join event_participants ep on ep.event_id = e.id and ep.status in ('joined', 'attended')
  where e.status = 'completed' and e.starts_at > now() - interval '3 days'
    and (select count(*) from event_participants x where x.event_id = e.id and x.status in ('joined', 'attended')) > 1
    and not exists (select 1 from notifications n where n.user_id = ep.user_id and n.event_id = e.id and n.kind = 'rate');
end $$;
