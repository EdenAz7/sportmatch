import { Link } from 'react-router-dom'
import type { Sport, SportEvent } from '../lib/types'
import { formatDate, formatKm, levelLabel } from '../lib/format'
import { MatchBadge } from './ui'

export default function EventCard({
  event,
  sport,
  joinedCount,
  distanceKm,
  matchPct,
  reasons,
  source,
}: {
  event: SportEvent
  sport?: Sport
  joinedCount: number
  distanceKm?: number | null
  matchPct?: number
  reasons?: string[]
  source?: 'recommendation' | 'browse'
}) {
  const spots = event.max_participants - joinedCount
  const fillPct = Math.min(100, (joinedCount / event.max_participants) * 100)
  const past = new Date(event.starts_at).getTime() < Date.now()
  return (
    <Link
      to={`/events/${event.id}${source ? `?src=${source}` : ''}`}
      className="animate-pop block rounded-2xl border border-line bg-white p-3.5 shadow-sm transition hover:border-brand/40 hover:shadow"
    >
      <div className="flex gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-mint text-2xl">
          {sport?.emoji ?? '🏅'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{event.title}</div>
          <div className="text-sm text-ink-soft">{formatDate(event.starts_at)}</div>
          <div className="truncate text-xs text-ink-soft/80">
            📍 {event.city}
            {distanceKm != null && ` · ${formatKm(distanceKm)}`}
            {' · '}רמה {levelLabel(event.level)}
            {event.price_ils > 0 && ` · ₪${Number(event.price_ils)}`}
          </div>
        </div>
        {matchPct != null && <MatchBadge pct={matchPct} />}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-ink-soft">
            {joinedCount}/{event.max_participants} משתתפים
          </span>
          {event.status === 'cancelled' ? (
            <span className="font-medium text-red-600">בוטל</span>
          ) : past ? (
            <span className="text-ink-soft">הסתיים</span>
          ) : spots > 0 ? (
            <span className={spots <= 2 ? 'font-medium text-accent' : 'text-brand-dark'}>
              {spots <= 2 ? `נשארו ${spots} מקומות!` : `${spots} מקומות פנויים`}
            </span>
          ) : (
            <span className="font-medium text-ink-soft">מלא</span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-mint">
          <div className="h-full rounded-full bg-brand" style={{ width: `${fillPct}%` }} />
        </div>
      </div>

      {reasons && reasons.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {reasons.map((r) => (
            <span key={r} className="rounded-full bg-brand-light px-2 py-0.5 text-[11px] text-brand-dark">
              ✓ {r}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}
