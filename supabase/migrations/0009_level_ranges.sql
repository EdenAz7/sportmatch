-- SportMatch – levels as ranges 1-2 / 2-3 / 3-4 / 4-5 on the same 1..5 scale as the star ratings.
-- A range is stored as its midpoint (1.5, 2.5, 3.5, 4.5), so the Match Engine keeps working on 1..5:
-- peer skill ratings (1..5 stars) pull the estimate up or down continuously.

drop view private.user_sport_levels;

alter table public.user_sports
  alter column self_level type numeric(2, 1) using (least(4, self_level) + 0.5);

alter table public.events
  alter column level type numeric(2, 1) using (least(4, level) + 0.5),
  alter column level set default 3.5;

create view private.user_sport_levels as
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
