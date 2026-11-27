import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorText, supabase } from '../lib/supabase'
import { getCurrentPosition, type LatLng } from '../lib/geo'
import { haversineKm } from '../lib/format'
import type { Recommendation, SportEvent } from '../lib/types'
import { reasons, type Weights } from '../engine/explain'
import EventCard from '../components/EventCard'
import { Button, Chip, Empty, ErrorBox, PageLoader, Segmented } from '../components/ui'

type Tab = 'recommended' | 'all'

interface BrowseRow extends SportEvent {
  event_participants: { status: string; user_id: string }[]
}

export default function Home() {
  const { profile, sports } = useAuth()
  const [tab, setTab] = useState<Tab>('recommended')
  const [sportFilter, setSportFilter] = useState<number | null>(null)
  const [pos, setPos] = useState<LatLng | null>(null)
  const [locating, setLocating] = useState(true)
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [recEvents, setRecEvents] = useState<Record<string, SportEvent>>({})
  const [weights, setWeights] = useState<Weights | null>(null)
  const [all, setAll] = useState<BrowseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // live location if allowed, otherwise the home location from the profile
  useEffect(() => {
    getCurrentPosition(6000)
      .then(setPos)
      .catch(() => undefined)
      .finally(() => setLocating(false))
  }, [])

  const homeLat = profile?.home_lat
  const homeLng = profile?.home_lng
  const origin: LatLng | null = useMemo(
    () => pos ?? (homeLat != null && homeLng != null ? { lat: homeLat, lng: homeLng } : null),
    [pos, homeLat, homeLng],
  )

  const loadRecommended = useCallback(async () => {
    const [{ data, error }, { data: w }] = await Promise.all([
      supabase.rpc('recommend_events', {
        p_lat: origin?.lat ?? null,
        p_lng: origin?.lng ?? null,
        p_sport: sportFilter,
        p_limit: 20,
      }),
      supabase.from('match_weights').select('*').eq('active', true).maybeSingle(),
    ])
    if (error) throw error
    const list = (data as Recommendation[]) ?? []
    setRecs(list)
    setWeights(w as Weights)
    if (list.length) {
      const { data: evs, error: e2 } = await supabase.from('events').select('*').in('id', list.map((r) => r.event_id))
      if (e2) throw e2
      setRecEvents(Object.fromEntries(((evs as SportEvent[]) ?? []).map((e) => [e.id, e])))
    }
  }, [origin?.lat, origin?.lng, sportFilter])

  const loadAll = useCallback(async () => {
    let q = supabase
      .from('events')
      .select('*, event_participants(status, user_id)')
      .in('status', ['open', 'full'])
      .gt('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(60)
    if (sportFilter) q = q.eq('sport_id', sportFilter)
    const { data, error } = await q
    if (error) throw error
    setAll((data as BrowseRow[]) ?? [])
  }, [sportFilter])

  useEffect(() => {
    if (locating) return
    setLoading(true)
    setErr('')
    const run = tab === 'recommended' ? loadRecommended : loadAll
    run()
      .catch((e) => setErr(errorText(e)))
      .finally(() => setLoading(false))
  }, [tab, locating, loadRecommended, loadAll])

  const allSorted = useMemo(
    () =>
      all.map((e) => ({
        e,
        joined: e.event_participants.filter((p) => p.status === 'joined').length + (e.guest_count ?? 0),
        imIn: e.event_participants.some((p) => p.status === 'joined' && p.user_id === profile?.id),
        km: origin ? haversineKm(origin.lat, origin.lng, e.lat, e.lng) : null,
      })),
    [all, origin, profile?.id],
  )

  const firstName = profile?.full_name.split(' ')[0]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">היי {firstName} 👋</h1>
        <p className="text-sm text-ink-soft">
          {pos ? 'לפי המיקום הנוכחי שלך' : profile?.city ? `לפי האזור שלך: ${profile.city}` : 'אירועים קרובים'}
        </p>
      </div>

      <div className="lg:max-w-md">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          ['recommended', '🎯 מומלצים עבורך'],
          ['all', '📋 כל האירועים'],
        ] as const}
      />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={sportFilter === null} onClick={() => setSportFilter(null)}>
          הכול
        </Chip>
        {sports.map((s) => (
          <Chip key={s.id} active={sportFilter === s.id} onClick={() => setSportFilter(s.id)}>
            {s.emoji} {s.name_he}
          </Chip>
        ))}
      </div>

      <ErrorBox>{err}</ErrorBox>

      {loading ? (
        <PageLoader />
      ) : tab === 'recommended' ? (
        recs.length === 0 ? (
          <Empty icon="🔍" title="אין כרגע אירועים שמתאימים לך">
            אפשר להגדיל את המרחק בפרופיל, לבדוק את "כל האירועים", או לפתוח אירוע בעצמך
            <div className="mt-4">
              <Link to="/events/new">
                <Button>➕ יצירת אירוע</Button>
              </Link>
            </div>
          </Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recs
              .filter((r) => recEvents[r.event_id])
              .map((r) => (
                <EventCard
                  key={r.event_id}
                  event={recEvents[r.event_id]}
                  sport={sports.find((s) => s.id === recEvents[r.event_id].sport_id)}
                  joinedCount={r.joined_count}
                  distanceKm={r.distance_km}
                  matchPct={r.match_pct}
                  reasons={weights ? reasons(r, weights) : []}
                  source="recommendation"
                />
              ))}
            <p className="pt-1 text-center text-xs text-white/85 sm:col-span-2 lg:col-span-3">
              הדירוג מחושב ע"י מנוע ההתאמה ·{' '}
              <Link to="/about" className="underline">
                איך זה עובד?
              </Link>
            </p>
          </div>
        )
      ) : allSorted.length === 0 ? (
        <Empty icon="📭" title="אין אירועים קרובים">
          היה הראשון לפתוח משחק!
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allSorted.map(({ e, joined, km, imIn }) => (
            <EventCard
              key={e.id}
              event={e}
              sport={sports.find((s) => s.id === e.sport_id)}
              joinedCount={joined}
              distanceKm={km}
              imIn={imIn}
              source="browse"
            />
          ))}
        </div>
      )}
    </div>
  )
}
