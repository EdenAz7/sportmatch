-- SportMatch – cancellation policy + waitlist
--
-- Cancellation policy (participant):
--   * more than 24h before the game : free cancellation, full refund if paid
--   * 24h–3h before                  : late cancellation – 50% refund, reputation penalty
--   * last 3h                        : cancellation locked; not showing up = no-show (bigger penalty)
--   * promoted from the waitlist inside the last 24h: may cancel without penalty until the game starts
-- Payments go through the organizer's Bit link, so the app tracks how much the organizer
-- must refund (refund_due) and lets the organizer mark it as done.
--
-- Waitlist: when an event is full users can join a waitlist for free. When a spot opens
-- (someone cancels, or the organizer adds spots) the first in line is moved in automatically
-- and gets an in-app notification to come in and pay.

alter table public.event_participants
  add column waitlisted_at timestamptz,
  add column promoted_at timestamptz,
  add column cancelled_at timestamptz,
  add column late_cancel boolean not null default false,
  add column refund_due numeric(8, 2) check (refund_due is null or refund_due >= 0),
  add column refund_done boolean not null default false;

create index event_participants_waitlist_idx
  on public.event_participants (event_id, waitlisted_at) where status = 'waitlist';

create or replace function private.money(p numeric) returns text
language sql immutable as $$
  select case when p = trunc(p) then trunc(p)::text else to_char(p, 'FM999990.00') end
$$;

-- Reliability now also counts late cancellations (half a no-show each)
create or replace function public.user_reputation(p_user uuid) returns float8
language sql stable security definer set search_path = public as $$
  with r as (
    select (2 * 3.5 + coalesce(sum(sportsmanship), 0)) / (2 + count(*)) as avg_sp
    from ratings where ratee_id = p_user
  ), a as (
    select count(*) filter (where status = 'attended') as att,
           count(*) filter (where status = 'no_show') as ns,
           count(*) filter (where late_cancel) as lc
    from event_participants where user_id = p_user
  )
  select ((r.avg_sp - 1) / 4.0) * ((a.att + 1.0) / (a.att + a.ns + 0.5 * a.lc + 1.0)) from r, a
$$;

-- Move people from the waitlist into free spots (first come, first served)
create or replace function private.promote_waitlist(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  e events%rowtype;
  v_taken int;
  v_next uuid;
  v_name text;
  v_n int := 0;
begin
  select * into e from events where id = p_event for update;
  if not found or e.status in ('cancelled', 'completed') or e.starts_at <= now() then
    return 0;
  end if;
  loop
    select count(*) + e.guest_count into v_taken
    from event_participants where event_id = p_event and status = 'joined';
    exit when v_taken >= e.max_participants;
    v_next := null;
    select user_id into v_next from event_participants
    where event_id = p_event and status = 'waitlist'
    order by waitlisted_at, joined_at
    limit 1;
    exit when v_next is null;

    update event_participants
       set status = 'joined', promoted_at = now(), joined_at = now(), paid = false, team = null
     where event_id = p_event and user_id = v_next;
    insert into user_sports (user_id, sport_id, self_level) values (v_next, e.sport_id, e.level)
    on conflict do nothing;
    update recommendation_log set joined = true where user_id = v_next and event_id = p_event;

    perform private.notify(v_next, p_event, 'promoted',
      case when e.price_ils > 0
           then format('התפנה מקום ב"%s" ונכנסת לאירוע! 🎉 היכנס/י לאירוע כדי לשלם ₪%s', e.title, private.money(e.price_ils))
           else format('התפנה מקום ב"%s" ונכנסת לאירוע! 🎉', e.title) end);
    select full_name into v_name from profiles where id = v_next;
    perform private.notify(e.organizer_id, p_event, 'joined',
      format('%s עלה/תה מרשימת ההמתנה ל"%s"', coalesce(nullif(v_name, ''), 'משתתף'), e.title));
    v_n := v_n + 1;
  end loop;

  perform set_config('app.internal', 'on', true);
  update events
     set status = case when v_taken >= max_participants then 'full'::event_status else 'open'::event_status end,
         filled_at = case when v_taken >= max_participants then coalesce(filled_at, now()) else null end
   where id = p_event;
  perform set_config('app.internal', 'off', true);
  return v_n;
end $$;

-- Join the waitlist of a full event (no payment)
create or replace function public.join_waitlist(p_event uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  e events%rowtype;
  v_taken int;
  v_pos int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into e from events where id = p_event for update;
  if not found then raise exception 'האירוע לא נמצא'; end if;
  if e.status = 'cancelled' then raise exception 'האירוע בוטל'; end if;
  if e.starts_at <= now() then raise exception 'האירוע כבר התחיל'; end if;
  if exists (select 1 from event_participants where event_id = p_event and user_id = v_uid and status = 'joined') then
    return json_build_object('ok', true, 'already_joined', true);
  end if;
  select count(*) + e.guest_count into v_taken from event_participants where event_id = p_event and status = 'joined';
  if v_taken < e.max_participants then raise exception 'יש מקום פנוי – אפשר להצטרף ישירות'; end if;

  insert into event_participants (event_id, user_id, status, source, waitlisted_at)
  values (p_event, v_uid, 'waitlist', 'browse', now())
  on conflict (event_id, user_id) do update
    set status = 'waitlist', waitlisted_at = coalesce(
          case when event_participants.status = 'waitlist' then event_participants.waitlisted_at end, now()),
        paid = false, team = null;

  select count(*) into v_pos from event_participants
  where event_id = p_event and status = 'waitlist'
    and waitlisted_at <= (select waitlisted_at from event_participants where event_id = p_event and user_id = v_uid);
  return json_build_object('ok', true, 'position', v_pos);
end $$;

-- Cancel participation (or leave the waitlist) according to the policy
create or replace function public.leave_event(p_event uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  e events%rowtype;
  p event_participants%rowtype;
  v_promoted_recently boolean;
  v_late boolean;
  v_refund numeric(8, 2);
  v_name text;
  v_n int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into e from events where id = p_event for update;
  if not found then raise exception 'האירוע לא נמצא'; end if;
  if e.organizer_id = v_uid then raise exception 'מארגן לא יכול לעזוב – אפשר לבטל את האירוע'; end if;
  if e.starts_at <= now() then raise exception 'האירוע כבר התחיל'; end if;

  select * into p from event_participants where event_id = p_event and user_id = v_uid;
  if not found or p.status not in ('joined', 'waitlist') then
    return json_build_object('ok', true);
  end if;

  if p.status = 'waitlist' then
    update event_participants set status = 'left', cancelled_at = now(), waitlisted_at = null
    where event_id = p_event and user_id = v_uid;
    return json_build_object('ok', true, 'waitlist', true);
  end if;

  v_promoted_recently := p.promoted_at is not null and p.promoted_at >= e.starts_at - interval '24 hours';
  if not v_promoted_recently and now() > e.starts_at - interval '3 hours' then
    raise exception 'אי אפשר לבטל פחות מ-3 שעות לפני המשחק. אם לא תגיע/י, המארגן יסמן אי-הגעה';
  end if;
  v_late := not v_promoted_recently and now() > e.starts_at - interval '24 hours';
  v_refund := case when p.paid and e.price_ils > 0
                   then case when v_late then round(e.price_ils * 0.5, 2) else e.price_ils end
                   else 0 end;

  update event_participants
     set status = 'left', team = null, cancelled_at = now(),
         late_cancel = late_cancel or v_late,
         refund_due = nullif(v_refund, 0), refund_done = false
   where event_id = p_event and user_id = v_uid;

  update recommendation_log set joined = false where user_id = v_uid and event_id = p_event;

  if e.status = 'full' then
    perform set_config('app.internal', 'on', true);
    update events set status = 'open', filled_at = null where id = p_event;
    perform set_config('app.internal', 'off', true);
  end if;

  select full_name into v_name from profiles where id = v_uid;
  perform private.notify(e.organizer_id, p_event, 'left',
    format('%s ביטל/ה השתתפות ב"%s"%s%s', coalesce(nullif(v_name, ''), 'משתתף'), e.title,
           case when v_late then ' (ביטול מאוחר)' else '' end,
           case when v_refund > 0 then format(' – יש להחזיר לו/ה ₪%s ב-Bit', private.money(v_refund)) else '' end));

  v_n := private.promote_waitlist(p_event);
  return json_build_object('ok', true, 'late', v_late, 'refund_due', v_refund, 'promoted', v_n);
end $$;

-- Organizer marks a refund as returned
create or replace function public.set_refunded(p_event uuid, p_user uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from events where id = p_event and organizer_id = auth.uid()) then
    raise exception 'רק המארגן יכול לעדכן החזרים';
  end if;
  update event_participants set refund_done = p_done
  where event_id = p_event and user_id = p_user and refund_due is not null;
end $$;

-- Organizer cancels the whole event: everyone who paid gets a full refund, waitlist is told too
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

  update event_participants set refund_due = e.price_ils, refund_done = false
  where event_id = p_event and status = 'joined' and paid and e.price_ils > 0 and user_id <> e.organizer_id;

  insert into notifications (user_id, event_id, kind, message)
  select ep.user_id, p_event, 'cancelled',
         format('האירוע "%s" בוטל%s', e.title,
                case when ep.paid and e.price_ils > 0 then format(' – המארגן יחזיר לך ₪%s', private.money(e.price_ils)) else '' end)
  from event_participants ep
  where ep.event_id = p_event and ep.status in ('joined', 'waitlist') and ep.user_id <> e.organizer_id;
end $$;

-- Editing: when the organizer adds spots, promote from the waitlist
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
  if new.max_participants - new.guest_count > old.max_participants - old.guest_count then
    perform private.promote_waitlist(new.id);
  end if;
  return new;
end $$;

-- Event page: + waitlist, my position, refunds, my promotion time
create or replace function public.get_event_details(p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  e events%rowtype;
  me event_participants%rowtype;
  v_is_org boolean;
  v_is_member boolean;
  v_result json;
begin
  select * into e from events where id = p_event;
  if not found then return null; end if;
  select * into me from event_participants where event_id = p_event and user_id = v_uid;
  v_is_org := e.organizer_id = v_uid;
  v_is_member := me.status in ('joined', 'attended', 'no_show');

  select json_build_object(
    'event', to_json(e),
    'sport', (select to_json(s) from sports s where s.id = e.sport_id),
    'facility', (select json_build_object('id', f.id, 'name', f.name, 'phone', f.phone)
                 from facilities f where f.id = e.facility_id),
    'organizer', (select json_build_object(
                    'id', p.id, 'full_name', p.full_name,
                    'phone', case when coalesce(v_is_member, false) then p.phone end,
                    'reputation', round(user_reputation(p.id)::numeric, 2))
                  from profiles p where p.id = e.organizer_id),
    'event_level', round(event_level(e.id)::numeric, 2),
    'is_organizer', coalesce(v_is_org, false),
    'is_member', coalesce(v_is_member, false),
    'my_status', me.status,
    'my_paid', coalesce(me.paid, false),
    'my_promoted_at', me.promoted_at,
    'my_refund', case when me.refund_due is not null
                      then json_build_object('amount', me.refund_due, 'done', me.refund_done, 'late', me.late_cancel) end,
    'my_waitlist_position', case when me.status = 'waitlist' then
        (select count(*) from event_participants w where w.event_id = p_event and w.status = 'waitlist'
           and w.waitlisted_at <= me.waitlisted_at) end,
    'my_ratings_done', (select count(*) from ratings where event_id = p_event and rater_id = v_uid),
    'participants', coalesce((
      select json_agg(json_build_object(
               'user_id', ep.user_id, 'full_name', p.full_name, 'status', ep.status,
               'paid', ep.paid, 'team', ep.team, 'source', ep.source, 'joined_at', ep.joined_at,
               'promoted', ep.promoted_at is not null,
               'level', round(user_level(ep.user_id, e.sport_id)::numeric, 2),
               'reputation', round(user_reputation(ep.user_id)::numeric, 2),
               'phone', case when v_is_org then p.phone end)
             order by ep.joined_at)
      from event_participants ep join profiles p on p.id = ep.user_id
      where ep.event_id = p_event and ep.status in ('joined', 'attended', 'no_show')), '[]'::json),
    'waitlist', coalesce((
      select json_agg(json_build_object('user_id', ep.user_id, 'full_name', p.full_name) order by ep.waitlisted_at)
      from event_participants ep join profiles p on p.id = ep.user_id
      where ep.event_id = p_event and ep.status = 'waitlist'), '[]'::json),
    'refunds', case when v_is_org then coalesce((
      select json_agg(json_build_object(
               'user_id', ep.user_id, 'full_name', p.full_name, 'amount', ep.refund_due,
               'done', ep.refund_done, 'late', ep.late_cancel, 'phone', p.phone)
             order by ep.cancelled_at)
      from event_participants ep join profiles p on p.id = ep.user_id
      where ep.event_id = p_event and ep.refund_due is not null), '[]'::json) end
  ) into v_result;
  return v_result;
end $$;

revoke execute on function public.join_waitlist(uuid), public.set_refunded(uuid, uuid, boolean) from public, anon;
grant execute on function public.join_waitlist(uuid), public.set_refunded(uuid, uuid, boolean) to authenticated;
revoke execute on function public.user_reputation(uuid) from public, anon, authenticated;
