import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'
import type { Facility, FacilitySlot } from '../lib/types'
import { Button, Card, Empty, PageLoader } from '../components/ui'

/** Public list of sports facilities, with their next free times */
export default function Facilities() {
  const { profile, sports } = useAuth()
  const [items, setItems] = useState<Facility[]>([])
  const [slots, setSlots] = useState<FacilitySlot[]>([])
  const [loading, setLoading] = useState(true)
  const isOwner = profile?.role === 'facility_owner' || profile?.role === 'admin'

  useEffect(() => {
    Promise.all([
      supabase.from('facilities').select('*').order('verified', { ascending: false }).order('created_at', { ascending: false }),
      supabase.rpc('open_slots'),
    ]).then(([f, s]) => {
      setItems((f.data as Facility[]) ?? [])
      setSlots((s.data as FacilitySlot[]) ?? [])
      setLoading(false)
    })
  }, [])

  const slotsByFacility = useMemo(() => {
    const m = new Map<string, FacilitySlot[]>()
    for (const s of slots) m.set(s.facility_id, [...(m.get(s.facility_id) ?? []), s])
    return m
  }, [slots])

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="page-title">מתקני ספורט</h1>
        {isOwner && (
          <Link to="/my-facilities">
            <Button>🏟️ המתקנים שלי</Button>
          </Link>
        )}
      </div>
      {!isOwner && (
        <Card className="text-sm text-ink-soft">
          יש לך מגרש, מועדון או אולם? בעלי מתקנים מפרסמים כאן את המתקן ואת השעות הפנויות, ומקבלים התראה על כל משחק שנפתח
          אצלם.{' '}
          <Link to="/profile" className="text-brand-dark underline">
            להרשמה כבעל מתקן בדף הפרופיל
          </Link>
        </Card>
      )}
      {loading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <Empty icon="🏟️" title="עוד אין מתקנים רשומים" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((f) => {
            const free = slotsByFacility.get(f.id) ?? []
            return (
              <Card key={f.id} className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                      {f.name}
                      {f.verified && (
                        <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-semibold text-ok">✓ מאומת</span>
                      )}
                    </div>
                    <div className="text-sm text-ink-soft">📍 {[f.address, f.city].filter(Boolean).join(', ')}</div>
                    <div className="mt-1 text-lg">
                      {f.sport_ids.map((id) => sports.find((s) => s.id === id)?.emoji).join(' ')}
                    </div>
                  </div>
                  <div className="shrink-0 text-left text-sm">
                    {f.price_per_hour != null && <div className="font-semibold">₪{f.price_per_hour}/שעה</div>}
                    {f.phone && (
                      <a href={`tel:${f.phone}`} className="text-brand-dark underline">
                        התקשרות
                      </a>
                    )}
                  </div>
                </div>
                {f.description && <p className="text-sm text-ink-soft">{f.description}</p>}
                {free.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="text-sm font-medium">שעות פנויות קרובות</div>
                    <div className="flex flex-wrap gap-2">
                      {free.slice(0, 4).map((s) => (
                        <Link
                          key={s.id}
                          to={`/events/new?facility=${f.id}&slot=${s.id}`}
                          className="rounded-full border border-line bg-white px-3 py-1 text-xs hover:bg-mint"
                        >
                          {formatDate(s.starts_at)}
                        </Link>
                      ))}
                      {free.length > 4 && <span className="px-1 py-1 text-xs text-ink-soft">ועוד {free.length - 4}</span>}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-ink-soft">אין כרגע שעות פנויות שפורסמו</p>
                )}
                <div className="flex gap-2 pt-1">
                  <Link to={`/events/new?facility=${f.id}`} className="flex-1">
                    <Button variant="secondary" className="w-full">
                      פתיחת משחק כאן
                    </Button>
                  </Link>
                  {f.owner_id === profile?.id && (
                    <Link to="/my-facilities">
                      <Button variant="ghost">ניהול</Button>
                    </Link>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
