-- SportMatch – Match Engine
--
-- Score(u, e) = w1*Sport + w2*Level + w3*Distance + w4*Time + w5*Rating + w6*History
-- P(join)     = sigmoid(bias + Score)      -- shown to the user as "% match"
--
-- Every feature is normalised to [0, 1]:
--   Sport    1 if the sport is in the user's profile, else 0
--   Level    1 - |level(u) - level(e)| / 4, levels estimated from self-rating + peer ratings
--   Distance exp(-km / 7)
--   Time     1 if the event falls in the user's preferred time slots, 0 if not, 0.5 if no preference
--   Rating   average reputation of the people already in the event
--   History  social affinity: played before with the people / organizer of this event
--
-- The weights live in match_weights and are re-fitted from real behaviour by
-- calibrate_weights() (logistic regression, projected gradient descent).

-- ---------------------------------------------------------------
-- Level estimation: Bayesian blend of self-reported level and peer skill ratings.
-- The self rating counts like 3 peer ratings, so a few peer ratings move it gradually.
-- ---------------------------------------------------------------
-- Internal helpers live in the "private" schema, which is not exposed through the API.
create schema if not exists private;

create or replace view private.user_sport_levels as
select us.user_id,
       us.sport_id,
       us.self_level,
       coalesce(r.n, 0)::int as n_ratings,
       (us.self_level * 3.0 + coalesce(r.sum_skill, 0)) / (3 + coalesce(r.n, 0)) as level_est
from public.user_sports us
left join (
  select ra.ratee_id, e.sport_id, count(*) as n, sum(ra.skill) as sum_skill
  from public.ratings ra
  join public.events e on e.id = ra.event_id
  group by ra.ratee_id, e.sport_id
) r on r.ratee_id = us.user_id and r.sport_id = us.sport_id;

create or replace function public.user_level(p_user uuid, p_sport smallint) returns float8
language sql stable security definer set search_path = public as $$
  select coalesce((select level_est from private.user_sport_levels where user_id = p_user and sport_id = p_sport), 3.0)
$$;

-- Reputation in [0, 1]: Bayesian average of sportsmanship (prior 3.5, weight 2),
-- multiplied by a reliability factor that penalises no-shows.
create or replace function public.user_reputation(p_user uuid) returns float8
language sql stable security definer set search_path = public as $$
  with r as (
    select (2 * 3.5 + coalesce(sum(sportsmanship), 0)) / (2 + count(*)) as avg_sp
    from ratings where ratee_id = p_user
  ), a as (
    select count(*) filter (where status = 'attended') as att,
           count(*) filter (where status = 'no_show') as ns
    from event_participants where user_id = p_user
  )
  select ((r.avg_sp - 1) / 4.0) * ((a.att + 1.0) / (a.att + a.ns + 1.0)) from r, a
$$;

-- Effective level of an event: organiser's target level (weight 2) blended with the
-- estimated levels of the players already registered.
create or replace function public.event_level(p_event uuid) returns float8
language sql stable security definer set search_path = public as $$
  select (2.0 * e.level + coalesce(sum(user_level(ep.user_id, e.sport_id)), 0))
         / (2 + count(ep.user_id))
  from events e
  left join event_participants ep on ep.event_id = e.id and ep.status = 'joined'
  where e.id = p_event
  group by e.id, e.level
$$;

create or replace function public.event_reputation(p_event uuid) returns float8
language sql stable security definer set search_path = public as $$
  select coalesce(avg(user_reputation(ep.user_id)), 0.625)
  from event_participants ep
  where ep.event_id = p_event and ep.status = 'joined'
$$;

-- Social affinity of a user to an event in [0, 1]
create or replace function public.history_affinity(p_user uuid, p_event uuid) returns float8
language sql stable security definer set search_path = public as $$
  with mates as (
    select count(distinct cur.user_id) as n
    from event_participants cur
    where cur.event_id = p_event and cur.status = 'joined' and cur.user_id <> p_user
      and exists (
        select 1
        from event_participants me
        join event_participants them on them.event_id = me.event_id and them.user_id = cur.user_id
        join events pe on pe.id = me.event_id
        where me.user_id = p_user and me.event_id <> p_event
          and me.status in ('joined', 'attended') and them.status in ('joined', 'attended')
          and pe.starts_at < now()
      )
  ), org as (
    select exists (
      select 1 from event_participants me
      join events pe on pe.id = me.event_id
      where me.user_id = p_user and me.status in ('joined', 'attended')
        and pe.starts_at < now() and me.event_id <> p_event
        and pe.organizer_id = (select organizer_id from events where id = p_event)
        and pe.organizer_id <> p_user
    ) as played
  )
  select 0.6 * least(1.0, mates.n / 3.0) + 0.4 * (case when org.played then 1 else 0 end)
  from mates, org
$$;

-- ---------------------------------------------------------------
-- Feature computation for one user against all candidate events.
-- Hard filters: open, future, not full, not already joined, within max distance.
-- ---------------------------------------------------------------
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
           (select count(*) from event_participants ep
             where ep.event_id = e.id and ep.status = 'joined')::int as jc,
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

-- ---------------------------------------------------------------
-- Public RPC: ranked recommendations for the signed-in user.
-- Logs every recommendation shown (impression) for later calibration.
-- ---------------------------------------------------------------
create or replace function public.recommend_events(
  p_lat float8 default null, p_lng float8 default null,
  p_sport smallint default null, p_limit int default 20)
returns table (
  event_id uuid, rank int, distance_km float8, joined_count int,
  f_sport float8, f_level float8, f_distance float8, f_time float8, f_rating float8, f_history float8,
  score float8, match_pct int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_lat float8;
  v_lng float8;
  w match_weights%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select coalesce(p_lat, home_lat), coalesce(p_lng, home_lng) into v_lat, v_lng
  from profiles where id = v_uid;
  select * into w from match_weights where active;

  create temp table if not exists _recs (
    event_id uuid, rank int, distance_km float8, joined_count int,
    f_sport float8, f_level float8, f_distance float8, f_time float8, f_rating float8, f_history float8,
    score float8, match_pct int
  ) on commit drop;
  truncate _recs;

  insert into _recs
  select s.event_id, (row_number() over (order by s.score desc, s.distance_km nulls last))::int,
         s.distance_km, s.joined_count,
         s.f_sport, s.f_level, s.f_distance, s.f_time, s.f_rating, s.f_history,
         s.score,
         round(100.0 / (1 + exp(-greatest(-30, least(30, w.bias + s.score)))))::int
  from (
    select c.*,
           w.w_sport * c.f_sport + w.w_level * c.f_level + w.w_distance * c.f_distance
           + w.w_time * c.f_time + w.w_rating * c.f_rating + w.w_history * c.f_history as score
    from private.compute_candidates(v_uid, v_lat, v_lng, p_sport) c
  ) s
  order by s.score desc, s.distance_km nulls last
  limit greatest(1, least(p_limit, 50));

  insert into recommendation_log as rl
    (user_id, event_id, weights_id, rank, score,
     f_sport, f_level, f_distance, f_time, f_rating, f_history)
  select v_uid, r.event_id, w.id, r.rank, r.score,
         r.f_sport, r.f_level, r.f_distance, r.f_time, r.f_rating, r.f_history
  from _recs r
  on conflict (user_id, event_id) do update
    set weights_id = excluded.weights_id, rank = excluded.rank, score = excluded.score,
        f_sport = excluded.f_sport, f_level = excluded.f_level, f_distance = excluded.f_distance,
        f_time = excluded.f_time, f_rating = excluded.f_rating, f_history = excluded.f_history,
        shown_count = rl.shown_count + 1, last_shown_at = now();

  return query select * from _recs order by _recs.rank;
end $$;

-- ---------------------------------------------------------------
-- Calibration: fit the weights to real behaviour.
-- Logistic regression of joined ~ features over all logged impressions,
-- batch gradient descent with L2 regularisation; feature weights are projected
-- to be non-negative so they stay interpretable. Warm-starts from the active weights.
-- Reports log-loss / accuracy / AUC of the old and the new weights on the same data.
-- ---------------------------------------------------------------
create or replace function public.calibrate_weights(
  p_iters int default 800, p_lr float8 default 2.0, p_l2 float8 default 0.001)
returns public.match_weights
language plpgsql security definer set search_path = public as $$
declare
  cur match_weights%rowtype;
  res match_weights%rowtype;
  w float8[];
  g float8[];
  n int;
  npos int;
  i int;
  j int;
  old_ll float8;
  new_ll float8;
  new_acc float8;
  old_auc float8;
  new_auc float8;
begin
  if not is_admin() then
    raise exception 'admins only';
  end if;

  select * into cur from match_weights where active;

  create temp table _train on commit drop as
  select f_sport as x1, f_level as x2, f_distance as x3, f_time as x4,
         f_rating as x5, f_history as x6, (case when joined then 1.0 else 0.0 end)::float8 as y
  from recommendation_log;

  select count(*), coalesce(sum(y), 0)::int into n, npos from _train;
  if n < 30 or npos = 0 or npos = n then
    raise exception 'צריך לפחות 30 המלצות שהוצגו, עם הצטרפויות וגם בלי (יש כרגע % המלצות ו-% הצטרפויות)', n, npos;
  end if;

  w := array[cur.bias, cur.w_sport, cur.w_level, cur.w_distance, cur.w_time, cur.w_rating, cur.w_history];

  for i in 1 .. p_iters loop
    select array[avg(e), avg(e * x1), avg(e * x2), avg(e * x3), avg(e * x4), avg(e * x5), avg(e * x6)]
      into g
    from (
      select x1, x2, x3, x4, x5, x6,
             1.0 / (1 + exp(-greatest(-30, least(30,
               w[1] + w[2] * x1 + w[3] * x2 + w[4] * x3 + w[5] * x4 + w[6] * x5 + w[7] * x6)))) - y as e
      from _train
    ) t;
    w[1] := w[1] - p_lr * g[1];
    for j in 2 .. 7 loop
      w[j] := greatest(0.0, w[j] - p_lr * (g[j] + p_l2 * w[j]));
    end loop;
  end loop;

  -- metrics for old and new weights on the same data
  create temp table _scored on commit drop as
  select y,
         greatest(-30, least(30, cur.bias + cur.w_sport * x1 + cur.w_level * x2 + cur.w_distance * x3
              + cur.w_time * x4 + cur.w_rating * x5 + cur.w_history * x6)) as z_old,
         greatest(-30, least(30, w[1] + w[2] * x1 + w[3] * x2 + w[4] * x3
              + w[5] * x4 + w[6] * x5 + w[7] * x6)) as z_new
  from _train;

  select avg(-(y * ln(greatest(1e-12, 1 / (1 + exp(-z_old))))
             + (1 - y) * ln(greatest(1e-12, 1 - 1 / (1 + exp(-z_old)))))),
         avg(-(y * ln(greatest(1e-12, 1 / (1 + exp(-z_new))))
             + (1 - y) * ln(greatest(1e-12, 1 - 1 / (1 + exp(-z_new)))))),
         avg(case when (z_new >= 0) = (y = 1) then 1.0 else 0.0 end)
    into old_ll, new_ll, new_acc
  from _scored;

  -- AUC via the Mann-Whitney rank statistic (average ranks for ties)
  with r as (
    select y, (rank() over (order by z_old) + count(*) over (partition by z_old) - 1 + rank() over (order by z_old)) / 2.0 as ro,
              (rank() over (order by z_new) + count(*) over (partition by z_new) - 1 + rank() over (order by z_new)) / 2.0 as rn
    from _scored
  )
  select (sum(ro) filter (where y = 1) - npos * (npos + 1) / 2.0) / (npos::float8 * (n - npos)),
         (sum(rn) filter (where y = 1) - npos * (npos + 1) / 2.0) / (npos::float8 * (n - npos))
    into old_auc, new_auc
  from r;

  update match_weights set active = false where active;
  insert into match_weights
    (bias, w_sport, w_level, w_distance, w_time, w_rating, w_history, method,
     training_size, positives, log_loss, baseline_log_loss, accuracy, auc, baseline_auc,
     note, created_by, active)
  values (w[1], w[2], w[3], w[4], w[5], w[6], w[7], 'calibrated',
          n, npos, new_ll, old_ll, new_acc, new_auc, old_auc,
          format('כיול על %s המלצות, %s הצטרפויות', n, npos), auth.uid(), true)
  returning * into res;
  return res;
end $$;

-- Admin: set weights manually (e.g. to roll back)
create or replace function public.set_manual_weights(
  p_bias float8, p_sport float8, p_level float8, p_distance float8,
  p_time float8, p_rating float8, p_history float8, p_note text default null)
returns public.match_weights
language plpgsql security definer set search_path = public as $$
declare
  res match_weights%rowtype;
begin
  if not is_admin() then
    raise exception 'admins only';
  end if;
  if least(p_sport, p_level, p_distance, p_time, p_rating, p_history) < 0 then
    raise exception 'weights must be non-negative';
  end if;
  update match_weights set active = false where active;
  insert into match_weights (bias, w_sport, w_level, w_distance, w_time, w_rating, w_history,
                             method, note, created_by, active)
  values (p_bias, p_sport, p_level, p_distance, p_time, p_rating, p_history,
          'manual', coalesce(p_note, 'עדכון ידני'), auth.uid(), true)
  returning * into res;
  return res;
end $$;
