import { Link } from 'react-router-dom'
import type { Sport, SportEvent } from '../lib/types'
import { formatDate, formatKm, levelLabel } from '../lib/format'
import { MatchBadge } from './ui'

/** Photo-like banner per sport (gradient + big sport icon), in the spirit of the design mockups */
export const SPORT_THEME: Record<number, { bg: string }> = {
  1: { bg: 'linear-gradient(160deg, #9fc6e4 0%, #dbe9f3 55%, #6f9e5b 56%, #4f8a3f 100%)' }, // football – sky & grass
  2: { bg: 'linear-gradient(160deg, #6f7a86 0%, #a9b2bb 100%)' }, // basketball – grey court
  3: { bg: 'linear-gradient(160deg, #b8481f 0%, #e3874f 100%)' }, // tennis – clay
  4: { bg: 'linear-gradient(160deg, #1f5d99 0%, #5d9bd6 100%)' }, // padel – blue court
  5: { bg: 'linear-gradient(160deg, #e9c37c 0%, #f6e4b8 60%, #7fb6d8 61%, #5d9bc8 100%)' }, // volleyball
  6: { bg: 'linear-gradient(160deg, #c0503a 0%, #e98a64 100%)' }, // running – track
  7: { bg: 'linear-gradient(160deg, #3f7f4f 0%, #8cc49a 100%)' }, // cycling
  8: { bg: 'linear-gradient(160deg, #7cc0e0 0%, #bfe3f2 50%, #ecd39a 51%, #e2bf77 100%)' }, // beach soccer
}

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
  const theme = SPORT_THEME[event.sport_id] ?? SPORT_THEME[1]

  return (
    <Link
      to={`/events/${event.id}${source ? `?src=${source}` : ''}`}
      className="animate-pop block overflow-hidden rounded-2xl bg-white shadow-lg shadow-black/25 transition hover:-translate-y-0.5"
    >
      {/* banner */}
      <div className="relative h-32 overflow-hidden" style={{ background: theme.bg }}>
        <span
          className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 rotate-[-14deg] text-[112px] leading-none drop-shadow-[0_6px_8px_rgba(0,0,0,0.35)] select-none"
          aria-hidden
        >
          {sport?.emoji ?? '🏅'}
        </span>
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
