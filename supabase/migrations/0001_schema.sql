-- SportMatch – core schema
-- Tables, helper functions, RLS policies.

-- ---------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------
create type public.user_role as enum ('user', 'facility_owner', 'admin', 'auditor');
create type public.event_status as enum ('open', 'full', 'cancelled', 'completed');
create type public.participant_status as enum ('joined', 'left', 'attended', 'no_show');

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------
create table public.sports (
  id smallint primary key,
  name_he text not null,
  emoji text not null,
  team_count smallint not null default 2,      -- teams used by the balancer (1 = no teams)
  default_players smallint not null default 10
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  city text,
  home_lat double precision,
  home_lng double precision,
  max_distance_km int not null default 20 check (max_distance_km between 1 and 200),
  -- preferred time slots: 0-2 weekday morning/afternoon/evening, 3-5 weekend (Fri-Sat)
  pref_slots smallint[] not null default '{}',
  role public.user_role not null default 'user',
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.user_sports (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sport_id smallint not null references public.sports (id),
  self_level smallint not null check (self_level between 1 and 5),
  primary key (user_id, sport_id)
);

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  city text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  sport_ids smallint[] not null default '{}',
  phone text,
  price_per_hour int check (price_per_hour >= 0),
  description text,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles (id) on delete cascade,
  sport_id smallint not null references public.sports (id),
  facility_id uuid references public.facilities (id) on delete set null,
  title text not null check (length(title) between 2 and 80),
  description text check (length(description) <= 1000),
  city text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  starts_at timestamptz not null,
  duration_min int not null default 90 check (duration_min between 15 and 600),
  max_participants int not null check (max_participants between 2 and 100),
  level smallint not null default 3 check (level between 1 and 5),
  price_ils numeric(8, 2) not null default 0 check (price_ils >= 0),
  bit_link text check (bit_link is null or bit_link ~* '^https://'),
  status public.event_status not null default 'open',
  team_imbalance double precision,          -- max-min team strength after balancing
  team_imbalance_random double precision,   -- same metric for a random split (baseline)
  teams_generated_at timestamptz,
  filled_at timestamptz,
  created_at timestamptz not null default now()
);
create index events_upcoming_idx on public.events (starts_at) where status in ('open', 'full');
create index events_organizer_idx on public.events (organizer_id);

create table public.event_participants (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.participant_status not null default 'joined',
  paid boolean not null default false,
  team smallint,
  source text not null default 'browse' check (source in ('organizer', 'recommendation', 'browse', 'link')),
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_participants_user_idx on public.event_participants (user_id);

create table public.ratings (
  event_id uuid not null references public.events (id) on delete cascade,
  rater_id uuid not null references public.profiles (id) on delete cascade,
  ratee_id uuid not null references public.profiles (id) on delete cascade,
  skill smallint not null check (skill between 1 and 5),
  sportsmanship smallint not null check (sportsmanship between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (event_id, rater_id, ratee_id),
  check (rater_id <> ratee_id)
);
create index ratings_ratee_idx on public.ratings (ratee_id);

-- Weights of the Match Engine. Exactly one row is active.
create table public.match_weights (
  id serial primary key,
  bias double precision not null,
  w_sport double precision not null,
  w_level double precision not null,
  w_distance double precision not null,
  w_time double precision not null,
  w_rating double precision not null,
  w_history double precision not null,
  method text not null check (method in ('manual', 'calibrated')),
  training_size int,
  positives int,
  log_loss double precision,
  baseline_log_loss double precision,
  accuracy double precision,
  auc double precision,
  baseline_auc double precision,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  active boolean not null default false
);
create unique index match_weights_one_active on public.match_weights (active) where active;

-- Every recommendation shown to a user (an "impression") and whether it led to a join.
-- This is the training set for weight calibration.
create table public.recommendation_log (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  weights_id int references public.match_weights (id),
  rank smallint,
  score double precision,
  f_sport double precision not null,
  f_level double precision not null,
  f_distance double precision not null,
  f_time double precision not null,
  f_rating double precision not null,
  f_history double precision not null,
  shown_count int not null default 1,
  first_shown_at timestamptz not null default now(),
  last_shown_at timestamptz not null default now(),
  joined boolean not null default false,
  unique (user_id, event_id)
);

create table public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  kind text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- Internal usage analytics (complements Google Analytics)
create table public.app_events (
  id bigserial primary key,
  user_id uuid,
  name text not null check (length(name) <= 60),
  props jsonb,
  created_at timestamptz not null default now()
);
create index app_events_created_idx on public.app_events (created_at);

-- ---------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
$$;

create or replace function public.haversine_km(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable as $$
  select 2 * 6371 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

-- Time slot of a timestamp in Israel time: 0..2 weekday, 3..5 weekend (Fri/Sat)
create or replace function public.time_slot(ts timestamptz) returns smallint
language sql stable as $$
  select ((case when extract(dow from ts at time zone 'Asia/Jerusalem') in (5, 6) then 3 else 0 end)
        + (case when extract(hour from ts at time zone 'Asia/Jerusalem') < 12 then 0
                when extract(hour from ts at time zone 'Asia/Jerusalem') < 17 then 1
                else 2 end))::smallint
$$;

-- ---------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------
-- Create a profile row for every new auth user
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may not change their own role (only admins can)
-- (security invoker on purpose: current_user is the API role for app users,
--  and 'postgres' for the dashboard / trusted functions)
create or replace function public.protect_role() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role is distinct from old.role
     and current_user in ('authenticated', 'anon')
     and not public.is_admin() then
    raise exception 'role change not allowed';
  end if;
  return new;
end $$;

create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_role();

-- Validate new events and auto-join the organizer
create or replace function public.before_event_insert() returns trigger
language plpgsql as $$
begin
  if new.starts_at < now() - interval '5 minutes' then
    raise exception 'event must start in the future';
  end if;
  new.status := 'open';
  return new;
end $$;

create trigger events_before_insert
  before insert on public.events
  for each row execute function public.before_event_insert();

create or replace function public.after_event_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into event_participants (event_id, user_id, source, paid)
  values (new.id, new.organizer_id, 'organizer', true);
  -- make sure the organizer has a level for this sport
  insert into user_sports (user_id, sport_id, self_level)
  values (new.organizer_id, new.sport_id, new.level)
  on conflict do nothing;
  return new;
end $$;

create trigger events_after_insert
  after insert on public.events
  for each row execute function public.after_event_insert();

-- Organizers may edit details but not status/derived columns directly
create or replace function public.protect_event_columns() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.internal', true), '') = 'on' then
    return new;
  end if;
  new.status := old.status;
  new.organizer_id := old.organizer_id;
  new.team_imbalance := old.team_imbalance;
  new.team_imbalance_random := old.team_imbalance_random;
  new.teams_generated_at := old.teams_generated_at;
  new.filled_at := old.filled_at;
  new.created_at := old.created_at;
  return new;
end $$;

create trigger events_protect_columns
  before update on public.events
  for each row execute function public.protect_event_columns();

-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------
alter table public.sports enable row level security;
alter table public.profiles enable row level security;
alter table public.user_sports enable row level security;
alter table public.facilities enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.ratings enable row level security;
alter table public.match_weights enable row level security;
alter table public.recommendation_log enable row level security;
alter table public.notifications enable row level security;
alter table public.app_events enable row level security;

create policy "sports readable" on public.sports for select using (true);

create policy "own profile read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "own sports read" on public.user_sports for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy "own sports write" on public.user_sports for insert to authenticated
  with check (user_id = auth.uid());
create policy "own sports update" on public.user_sports for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own sports delete" on public.user_sports for delete to authenticated
  using (user_id = auth.uid());

create policy "facilities readable" on public.facilities for select using (true);
create policy "facility owners insert" on public.facilities for insert to authenticated
  with check (owner_id = auth.uid()
              and exists (select 1 from public.profiles where id = auth.uid() and role in ('facility_owner', 'admin')));
create policy "facility owners update" on public.facilities for update to authenticated
  using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
create policy "facility owners delete" on public.facilities for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

create policy "events readable" on public.events for select using (true);
create policy "events insert" on public.events for insert to authenticated
  with check (organizer_id = auth.uid());
create policy "events update by organizer" on public.events for update to authenticated
  using (organizer_id = auth.uid() or public.is_admin())
  with check (organizer_id = auth.uid() or public.is_admin());

-- participant rows are readable (needed for counts); all writes go through RPCs
create policy "participants readable" on public.event_participants for select using (true);

create policy "ratings own read" on public.ratings for select to authenticated
  using (rater_id = auth.uid() or public.is_staff());

create policy "weights readable" on public.match_weights for select using (true);

create policy "recs own read" on public.recommendation_log for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

create policy "notifications own read" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications own update" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "app events insert" on public.app_events for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
create policy "app events staff read" on public.app_events for select to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------
insert into public.sports (id, name_he, emoji, team_count, default_players) values
  (1, 'כדורגל', '⚽', 2, 10),
  (2, 'כדורסל', '🏀', 2, 10),
  (3, 'טניס', '🎾', 2, 4),
  (4, 'פאדל', '🏸', 2, 4),
  (5, 'כדורעף', '🏐', 2, 12),
  (6, 'ריצה', '🏃', 1, 15),
  (7, 'אופניים', '🚴', 1, 10),
  (8, 'כדורגל חופים', '🏖️', 2, 8);

-- Initial (manual) weights – the starting point before calibration
insert into public.match_weights
  (bias, w_sport, w_level, w_distance, w_time, w_rating, w_history, method, note, active)
values (-4.0, 2.0, 1.5, 1.5, 1.0, 0.5, 1.0, 'manual', 'משקלים התחלתיים שנקבעו ידנית', true);
