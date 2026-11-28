-- SportMatch – business side (facility owners) + push notifications to the phone
--
-- 1. Facilities: verification flag (admins only) + edit timestamp
-- 2. Open time slots that a facility owner publishes; an organizer books one by opening a game in it
-- 3. The facility owner is notified when a game is opened / cancelled / moved at their facility
-- 4. Owner dashboard, public open-slot search, admin facility metrics
-- 5. Push: device subscriptions + every new in-app notification is also pushed to the user's phone
--    (pg_net → Edge Function "send-push" → Web Push). The URL and shared secret live in
--    private.app_config and are NOT stored in this file.

-- ---------------------------------------------------------------
-- 1. Facilities
-- ---------------------------------------------------------------
alter table public.facilities add column if not exists verified boolean not null default false;
alter table public.facilities add column if not exists updated_at timestamptz;

create or replace function public.protect_facility_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not is_admin() then
    if tg_op = 'INSERT' then
      new.verified := false;
    else
      new.verified := old.verified;
      new.owner_id := old.owner_id;
      new.created_at := old.created_at;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger facilities_protect_columns
  before insert or update on public.facilities
  for each row execute function public.protect_facility_columns();

create or replace function public.set_facility_verified(p_facility uuid, p_verified boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'רק מנהל מערכת יכול לאמת מתקנים'; end if;
  update facilities set verified = p_verified where id = p_facility;
  if not found then raise exception 'המתקן לא נמצא'; end if;
end $$;

-- ---------------------------------------------------------------
-- 2. Open time slots
-- ---------------------------------------------------------------
create table public.facility_slots (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete cascade,
  starts_at timestamptz not null,
  duration_min int not null default 90 check (duration_min between 30 and 600),
  price_ils int check (price_ils >= 0),          -- null = use the facility's price per hour
  created_at timestamptz not null default now()
);
create index facility_slots_facility_idx on public.facility_slots (facility_id, starts_at);

-- A game that booked a slot points to it. Only one live (not cancelled) game per slot.
alter table public.events add column if not exists facility_slot_id uuid
  references public.facility_slots (id) on delete set null;
create unique index events_live_slot_uniq on public.events (facility_slot_id)
  where facility_slot_id is not null and status <> 'cancelled';

alter table public.facility_slots enable row level security;
create policy "slots readable" on public.facility_slots for select using (true);
create policy "slot owners insert" on public.facility_slots for insert to authenticated
  with check (exists (select 1 from public.facilities f
                      where f.id = facility_id and (f.owner_id = auth.uid() or public.is_admin())));
create policy "slot owners delete" on public.facility_slots for delete to authenticated
  using (exists (select 1 from public.facilities f
                 where f.id = facility_id and (f.owner_id = auth.uid() or public.is_admin()))
         and not exists (select 1 from public.events e
                         where e.facility_slot_id = facility_slots.id and e.status <> 'cancelled'));

create or replace function public.before_slot_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.starts_at <= now() then
    raise exception 'השעה הפנויה חייבת להיות בעתיד';
  end if;
  return new;
end $$;

create trigger facility_slots_before_insert
  before insert on public.facility_slots
  for each row execute function public.before_slot_insert();

-- Booking: when a game is created (or edited) with a slot, validate it and copy time + place from it.
-- If the organizer later moves the game to another time or place, the slot is released.
create or replace function public.events_slot_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s facility_slots%rowtype;
  f facilities%rowtype;
begin
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('app.internal', true), '') = 'on' then
      return new;
    end if;
    if new.facility_slot_id is not distinct from old.facility_slot_id then
      if new.facility_slot_id is not null
         and (new.starts_at is distinct from old.starts_at or new.facility_id is distinct from old.facility_id) then
        new.facility_slot_id := null;
      end if;
      return new;
    end if;
  end if;

  if new.facility_slot_id is null then
    return new;
  end if;

  select * into s from facility_slots where id = new.facility_slot_id for update;
  if not found then raise exception 'השעה שנבחרה לא נמצאה'; end if;
  if s.starts_at <= now() then raise exception 'השעה שנבחרה כבר עברה'; end if;
  if exists (select 1 from events e
             where e.facility_slot_id = s.id and e.status <> 'cancelled' and e.id <> new.id) then
    raise exception 'השעה הזו כבר נתפסה – נא לבחור שעה אחרת';
  end if;

  select * into f from facilities where id = s.facility_id;
  new.facility_id := f.id;
  new.starts_at := s.starts_at;
  new.duration_min := s.duration_min;
  new.lat := f.lat;
  new.lng := f.lng;
  new.city := f.city;
  new.address := coalesce(f.address, f.name);
  return new;
end $$;

create trigger events_slot_sync_insert
  before insert on public.events
  for each row execute function public.events_slot_sync();
create trigger events_slot_sync_update
  before update on public.events
  for each row execute function public.events_slot_sync();

-- Free upcoming slots (optionally for one facility / one sport)
create or replace function public.open_slots(p_facility uuid default null, p_sport smallint default null)
returns table (id uuid, facility_id uuid, starts_at timestamptz, duration_min int, price_ils int)
language sql stable security definer set search_path = public as $$
  select s.id, s.facility_id, s.starts_at, s.duration_min, s.price_ils
  from facility_slots s
  join facilities f on f.id = s.facility_id
  where s.starts_at > now()
    and (p_facility is null or s.facility_id = p_facility)
    and (p_sport is null or p_sport = any (f.sport_ids))
    and not exists (select 1 from events e where e.facility_slot_id = s.id and e.status <> 'cancelled')
  order by s.starts_at
  limit 300
$$;

-- ---------------------------------------------------------------
-- 3. Tell the facility owner about games at their facility
-- ---------------------------------------------------------------
create or replace function public.events_facility_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_name text;
  v_when text := to_char(new.starts_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI');
begin
  if new.facility_id is null then
    return new;
  end if;
  select owner_id, name into v_owner, v_name from facilities where id = new.facility_id;
  if v_owner is null or v_owner = new.organizer_id then
    return new;
  end if;

  if tg_op = 'INSERT' or new.facility_id is distinct from old.facility_id then
    perform private.notify(v_owner, new.id, 'facility_booked',
      format('נפתח משחק חדש במתקן "%s": %s, %s', v_name, new.title, v_when));
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform private.notify(v_owner, new.id, 'facility_cancelled',
      format('המשחק "%s" במתקן "%s" (%s) בוטל%s', new.title, v_name, v_when,
             case when new.facility_slot_id is not null then ' – השעה חזרה להיות פנויה' else '' end));
  elsif new.starts_at is distinct from old.starts_at and new.status in ('open', 'full') then
    perform private.notify(v_owner, new.id, 'facility_updated',
      format('המועד של "%s" במתקן "%s" שונה ל-%s', new.title, v_name, v_when));
  end if;
  return new;
end $$;

create trigger events_facility_notify
  after insert or update on public.events
  for each row execute function public.events_facility_notify();

-- ---------------------------------------------------------------
-- 4. Owner dashboard + admin metrics
-- ---------------------------------------------------------------
create or replace function public.get_my_facilities()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(t.x order by t.x -> 'facility' ->> 'name'), '[]'::json)
  from (
    select json_build_object(
      'facility', to_json(f),
      'slots', (
        select coalesce(json_agg(json_build_object(
                 'id', s.id, 'starts_at', s.starts_at, 'duration_min', s.duration_min, 'price_ils', s.price_ils,
                 'event', (select json_build_object('id', e.id, 'title', e.title, 'status', e.status)
                           from events e where e.facility_slot_id = s.id and e.status <> 'cancelled' limit 1))
               order by s.starts_at), '[]'::json)
        from facility_slots s
        where s.facility_id = f.id and s.starts_at > now() - interval '1 day'),
      'events', (
        select coalesce(json_agg(json_build_object(
                 'id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'status', e.status,
                 'sport_id', e.sport_id, 'max_participants', e.max_participants,
                 'taken', e.guest_count + (select count(*) from event_participants ep
                                           where ep.event_id = e.id and ep.status in ('joined', 'attended')),
                 'organizer_name', p.full_name, 'organizer_phone', p.phone,
                 'from_slot', e.facility_slot_id is not null)
               order by e.starts_at), '[]'::json)
        from events e join profiles p on p.id = e.organizer_id
        where e.facility_id = f.id and e.starts_at > now() - interval '30 days'),
      'stats', json_build_object(
        'games_total', (select count(*) from events e where e.facility_id = f.id and e.status <> 'cancelled'),
        'games_upcoming', (select count(*) from events e
                           where e.facility_id = f.id and e.status in ('open', 'full') and e.starts_at > now()),
        'players_total', (select count(*) from event_participants ep join events e on e.id = ep.event_id
                          where e.facility_id = f.id and e.status <> 'cancelled'
                            and ep.status in ('joined', 'attended')),
        'slots_offered', (select count(*) from facility_slots s where s.facility_id = f.id),
        'slots_booked', (select count(*) from facility_slots s where s.facility_id = f.id
                           and exists (select 1 from events e
                                       where e.facility_slot_id = s.id and e.status <> 'cancelled')))
    ) as x
    from facilities f
    where f.owner_id = auth.uid()
  ) t
$$;

create or replace function public.admin_facility_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'אין הרשאה'; end if;
  return json_build_object(
    'facilities', (select count(*) from facilities),
    'verified', (select count(*) from facilities where verified),
    'owners', (select count(*) from profiles where role = 'facility_owner'),
    'slots_upcoming', (select count(*) from facility_slots where starts_at > now()),
    'slots_booked', (select count(*) from facility_slots s
                     where exists (select 1 from events e where e.facility_slot_id = s.id and e.status <> 'cancelled')),
    'slots_total', (select count(*) from facility_slots),
    'games_at_facilities', (select count(*) from events where facility_id is not null and status <> 'cancelled'),
    'games_total', (select count(*) from events where status <> 'cancelled'),
    'push_users', (select count(distinct user_id) from push_subscriptions),
    'list', (select coalesce(json_agg(json_build_object(
               'id', f.id, 'name', f.name, 'city', f.city, 'verified', f.verified, 'owner_name', p.full_name,
               'games', (select count(*) from events e where e.facility_id = f.id and e.status <> 'cancelled'))
             order by f.created_at desc), '[]'::json)
             from facilities f join profiles p on p.id = f.owner_id)
  );
end $$;

-- ---------------------------------------------------------------
-- 5. Push notifications
-- ---------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own push read" on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy "own push delete" on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- Save this device for the signed-in user (a device that switches account moves to the new user)
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'צריך להתחבר'; end if;
  if p_endpoint !~ '^https://' then raise exception 'כתובת לא תקינה'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

-- A test notification to yourself (in-app + push)
create or replace function public.send_test_push()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'צריך להתחבר'; end if;
  perform private.notify(auth.uid(), null, 'test', 'התראת בדיקה: ההתראות לטלפון עובדות');
end $$;

-- Settings that must not be in the code (push_url, push_secret). Not exposed through the API.
create table if not exists private.app_config (
  key text primary key,
  value text not null
);

-- Every new notification is also sent to the user's devices (asynchronously, via pg_net)
create or replace function public.notifications_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from push_subscriptions where user_id = new.user_id) then
    return new;
  end if;
  select value into v_url from private.app_config where key = 'push_url';
  select value into v_secret from private.app_config where key = 'push_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('notification_id', new.id, 'user_id', new.user_id, 'kind', new.kind,
                                 'message', new.message, 'event_id', new.event_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      timeout_milliseconds := 8000);
  exception when others then
    raise warning 'push not queued: %', sqlerrm;
  end;
  return new;
end $$;

create trigger notifications_push
  after insert on public.notifications
  for each row execute function public.notifications_push();
