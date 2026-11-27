import { Link } from 'react-router-dom'
import type { Sport, SportEvent } from '../lib/types'
import { formatDate, formatKm, levelLabel } from '../lib/format'
import { MatchBadge } from './ui'

/** Photo banner per sport (public/sports/<sport_id>.webp) */
export const sportImage = (sportId: number) =>
  `${import.meta.env.BASE_URL}sports/${sportId >= 1 && sportId <= 8 ? sportId : 1}.webp`

const tz = 'Asia/Jerusalem'

export default function EventCard({
  event,
  sport,
  joinedCount,
  distanceKm,
  matchPct,
  reasons,
  source,
  imIn,
  badge,
}: {
  event: SportEvent
  sport?: Sport
  joinedCount: number
  distanceKm?: number | null
  matchPct?: number
  reasons?: string[]
  source?: 'recommendation' | 'browse'
  imIn?: boolean
  badge?: string
}) {
  const spots = event.max_participants - joinedCount
  const fillPct = Math.min(100, (joinedCount / event.max_participants) * 100)
  const start = new Date(event.starts_at)
  const past = start.getTime() < Date.now()
  const weekday = start.toLocaleDateString('he-IL', { timeZone: tz, weekday: 'long' })
  const dayMonth = start
    .toLocaleDateString('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit' })
    .replace('/', '.')

  return (
    <Link
      to={`/events/${event.id}${source ? `?src=${source}` : ''}`}
      className="animate-pop block overflow-hidden rounded-2xl bg-white shadow-lg shadow-black/25 transition hover:-translate-y-0.5"
    >
      {/* banner */}
      <div className="relative h-40 overflow-hidden bg-neutral-700">
        <img
          src={sportImage(event.sport_id)}
          alt={sport?.name_he ?? ''}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute top-2.5 right-2.5 flex gap-1.5">
          {imIn && <span className="rounded-md bg-ok px-2 py-0.5 text-[11px] font-bold text-white shadow">אני בפנים</span>}
          {badge && <span className="rounded-md bg-ink/85 px-2 py-0.5 text-[11px] font-bold text-white shadow">{badge}</span>}
          {event.status === 'cancelled' && <span className="rounded-md bg-red-700 px-2 py-0.5 text-[11px] font-bold text-white">בוטל</span>}
        </div>
        {matchPct != null && (
          <div className="absolute top-2.5 left-2.5">
            <MatchBadge pct={matchPct} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-3.5 py-2 text-white backdrop-blur-[1px]">
          <span className="font-display text-xl leading-none">{weekday}</span>
          <span className="flex items-center gap-3 font-display text-lg leading-none" dir="ltr">
            <span>{dayMonth}</span>
            <span className="flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
              {joinedCount}/{event.max_participants}
            </span>
          </span>
        </div>
      </div>

      {/* details */}
      <div className="p-3.5">
        <div className="truncate font-semibold">{event.title}</div>
        <div className="truncate text-xs text-ink-soft">
          {formatDate(event.starts_at)} · 📍 {event.city}
          {distanceKm != null && ` · ${formatKm(distanceKm)}`}
          {' · '}רמה {levelLabel(event.level)}
          {event.price_ils > 0 && ` · ₪${Number(event.price_ils)}`}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-mint">
            <div className="h-full rounded-full bg-accent" style={{ width: `${fillPct}%` }} />
          </div>
          <span className="shrink-0 text-xs">
            {event.status === 'cancelled' ? (
              <span className="font-medium text-red-700">בוטל</span>
            ) : past ? (
              <span className="text-ink-soft">הסתיים</span>
            ) : spots > 0 ? (
              <span className={spots <= 2 ? 'font-semibold text-brand' : 'text-ink-soft'}>
                {spots <= 2 ? `נשארו ${spots}!` : `${spots} מקומות`}
              </span>
            ) : (
              <span className="font-medium text-ink-soft">מלא</span>
            )}
          </span>
        </div>
        {reasons && reasons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {reasons.map((r) => (
              <span key={r} className="rounded-full bg-brand-light px-2 py-0.5 text-[11px] text-brand-dark">
                ✓ {r}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
