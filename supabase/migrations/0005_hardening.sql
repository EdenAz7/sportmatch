-- SportMatch – API hardening (Supabase security advisor)

-- fixed search_path everywhere
alter function public.before_event_insert() set search_path = public;
alter function public.protect_event_columns() set search_path = public;
alter function public.haversine_km(float8, float8, float8, float8) set search_path = public;
alter function public.time_slot(timestamptz) set search_path = public;

-- internal helpers and trigger functions are not part of the API
revoke execute on function
  public.user_level(uuid, smallint),
  public.user_reputation(uuid),
  public.event_level(uuid),
  public.event_reputation(uuid),
  public.history_affinity(uuid, uuid),
  public.handle_new_user(),
  public.after_event_insert()
from public, anon, authenticated;

-- signed-in users only (each function also checks auth.uid() / role itself)
revoke execute on function
  public.admin_stats(),
  public.become_facility_owner(),
  public.calibrate_weights(int, float8, float8),
  public.cancel_event(uuid),
  public.get_public_profile(uuid),
  public.join_event(uuid, text),
  public.leave_event(uuid),
  public.recommend_events(float8, float8, smallint, int),
  public.save_teams(uuid, jsonb, float8, float8),
  public.set_attendance(uuid, uuid, boolean),
  public.set_manual_weights(float8, float8, float8, float8, float8, float8, float8, text),
  public.set_paid(uuid, uuid, boolean),
  public.submit_ratings(uuid, jsonb),
  public.touch(),
  public.is_admin(),
  public.is_staff()
from public, anon;

grant execute on function
  public.admin_stats(),
  public.become_facility_owner(),
  public.calibrate_weights(int, float8, float8),
  public.cancel_event(uuid),
  public.get_public_profile(uuid),
  public.join_event(uuid, text),
  public.leave_event(uuid),
  public.recommend_events(float8, float8, smallint, int),
  public.save_teams(uuid, jsonb, float8, float8),
  public.set_attendance(uuid, uuid, boolean),
  public.set_manual_weights(float8, float8, float8, float8, float8, float8, float8, text),
  public.set_paid(uuid, uuid, boolean),
  public.submit_ratings(uuid, jsonb),
  public.touch(),
  public.is_admin(),
  public.is_staff()
to authenticated;

-- get_event_details stays public on purpose: shared event links work before signing up
