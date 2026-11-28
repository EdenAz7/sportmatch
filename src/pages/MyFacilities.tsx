import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorText, supabase } from '../lib/supabase'
import { formatDate, isoToLocalInput, localInputToIso, waNumber } from '../lib/format'
import { track } from '../lib/analytics'
import type { EventStatus, OwnerFacility } from '../lib/types'
import FacilityForm from '../components/FacilityForm'
import PushCard from '../components/PushCard'
import { Button, Card, Empty, ErrorBox, Field, PageLoader, Segmented, inputClass } from '../components/ui'

const STATUS_TEXT: Record<EventStatus, string> = {
  open: 'פתוח להרשמה',
  full: 'מלא',
  cancelled: 'בוטל',
  completed: 'הסתיים',
}

/** Business area for facility owners: their facilities, free times, games and numbers */
export default function MyFacilities() {
  const { profile, refresh } = useAuth()
  const [items, setItems] = useState<OwnerFacility[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  const isOwner = profile?.role === 'facility_owner' || profile?.role === 'admin'

  async function load() {
    const { data, error } = await supabase.rpc('get_my_facilities')
    if (error) setErr(errorText(error))
    setItems((data as OwnerFacility[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    if (isOwner) void load()
    else setLoading(false)
  }, [isOwner])

  async function becomeOwner() {
    const { error } = await supabase.rpc('become_facility_owner')
    if (error) return setErr(errorText(error))
    track('became_facility_owner')
    await refresh()
  }

  if (loading) return <PageLoader />

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="page-title">המתקנים שלי</h1>
        <Card className="space-y-3">
          <p className="text-sm">
            יש לך מגרש, מועדון או אולם? אחרי ההרשמה כבעל מתקן אפשר לפרסם את המתקן ואת השעות הפנויות בו. מארגנים יוכלו
            לפתוח משחק בשעה פנויה, ואתה תקבל התראה על כל משחק שנפתח אצלך.
          </p>
          <ErrorBox>{err}</ErrorBox>
          <Button className="w-full" onClick={becomeOwner}>
            🏟️ הרשמה כבעל מתקן
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="page-title">המתקנים שלי</h1>
        {!adding && <Button onClick={() => setAdding(true)}>➕ מתקן חדש</Button>}
      </div>
      <ErrorBox>{err}</ErrorBox>
      {adding && (
        <FacilityForm
          onDone={(saved) => {
            setAdding(false)
            if (saved) void load()
          }}
        />
      )}
      {items.length === 0 && !adding ? (
        <Empty icon="🏟️" title="עוד לא הוספת מתקן">
          <p className="text-sm text-ink-soft">לוחצים על "מתקן חדש", ממלאים שם, מיקום וענפים, ואז מוסיפים שעות פנויות.</p>
        </Empty>
      ) : (
        items.map((it) => <FacilityPanel key={it.facility.id} data={it} onChange={load} />)
      )}
      <div className="mx-auto max-w-md">
        <PushCard compact />
      </div>
    </div>
  )
}

function FacilityPanel({ data, onChange }: { data: OwnerFacility; onChange: () => Promise<void> }) {
  const { sports } = useAuth()
  const f = data.facility
  const [tab, setTab] = useState<'slots' | 'games' | 'edit'>('slots')
  const upcoming = data.events.filter((e) => new Date(e.starts_at).getTime() > Date.now() - 3 * 3600_000)
  const past = data.events.filter((e) => new Date(e.starts_at).getTime() <= Date.now() - 3 * 3600_000)

  async function remove() {
    if (!window.confirm(`למחוק את "${f.name}"? השעות הפנויות שלו יימחקו, והמשחקים שכבר נקבעו יישארו בלי קישור למתקן.`)) return
    const { error } = await supabase.from('facilities').delete().eq('id', f.id)
    if (error) return window.alert(errorText(error))
    await onChange()
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {f.name}
            {f.verified ? (
              <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-semibold text-ok">✓ מאומת</span>
            ) : (
              <span className="rounded-full bg-mint px-2 py-0.5 text-xs text-ink-soft">ממתין לאימות</span>
            )}
          </div>
          <div className="text-sm text-ink-soft">
            📍 {[f.address, f.city].filter(Boolean).join(', ')} ·{' '}
            {f.sport_ids.map((id) => sports.find((s) => s.id === id)?.emoji).join(' ')}
            {f.price_per_hour != null && ` · ₪${f.price_per_hour}/שעה`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="משחקים קרובים" value={data.stats.games_upcoming} />
        <Stat label="משחקים בסה״כ" value={data.stats.games_total} />
        <Stat label="שחקנים שהגיעו דרכנו" value={data.stats.players_total} />
        <Stat label="שעות שהוזמנו" value={`${data.stats.slots_booked}/${data.stats.slots_offered}`} />
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          ['slots', 'שעות פנויות'],
          ['games', `משחקים (${upcoming.length})`],
          ['edit', 'עריכה'],
        ] as const}
      />

      {tab === 'slots' && <SlotsTab data={data} onChange={onChange} />}

      {tab === 'games' && (
        <div className="space-y-3">
          {upcoming.length === 0 && <p className="text-sm text-ink-soft">אין משחקים קרובים במתקן.</p>}
          {upcoming.map((e) => (
            <div key={e.id} className="rounded-xl border border-line p-3">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/events/${e.id}`} className="font-medium text-brand-dark underline">
                  {sports.find((s) => s.id === e.sport_id)?.emoji} {e.title}
                </Link>
                <span className="shrink-0 text-xs text-ink-soft">{STATUS_TEXT[e.status]}</span>
              </div>
              <div className="text-sm text-ink-soft">
                {formatDate(e.starts_at)} · {e.taken}/{e.max_participants} שחקנים
                {e.from_slot && ' · נקבע בשעה פנויה'}
              </div>
              <div className="text-sm">
                מארגן: {e.organizer_name}
                {e.organizer_phone && (
                  <>
                    {' · '}
                    <a href={`tel:${e.organizer_phone}`} className="text-brand-dark underline">
                      {e.organizer_phone}
                    </a>
                    {' · '}
                    <a href={`https://wa.me/${waNumber(e.organizer_phone)}`} target="_blank" rel="noreferrer" className="text-brand-dark underline">
                      וואטסאפ
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}
          {past.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-soft">משחקים מהחודש האחרון ({past.length})</summary>
              <ul className="mt-2 space-y-1">
                {past.map((e) => (
                  <li key={e.id}>
                    <Link to={`/events/${e.id}`} className="underline">
                      {e.title}
                    </Link>{' '}
                    · {formatDate(e.starts_at)} · {STATUS_TEXT[e.status]} · {e.taken} שחקנים
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {tab === 'edit' && (
        <div className="space-y-2">
          <FacilityForm
            initial={f}
            onDone={(saved) => {
              if (saved) void onChange()
              setTab('slots')
            }}
          />
          <button type="button" className="text-xs text-red-600 underline" onClick={remove}>
            מחיקת המתקן
          </button>
        </div>
      )}
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-mint px-3 py-2 text-center">
      <div className="text-xl font-bold text-brand-dark">{value}</div>
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  )
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function SlotsTab({ data, onChange }: { data: OwnerFacility; onChange: () => Promise<void> }) {
  const f = data.facility
  const tomorrow = isoToLocalInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 10)
  const [date, setDate] = useState(tomorrow)
  const [time, setTime] = useState('19:00')
  const [duration, setDuration] = useState(90)
  const [price, setPrice] = useState('')
  const [weeks, setWeeks] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const upcoming = data.slots.filter((s) => new Date(s.starts_at).getTime() > Date.now())

  async function add(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setNote('')
    const rows = Array.from({ length: weeks }, (_, i) => ({
      facility_id: f.id,
      starts_at: localInputToIso(`${addDays(date, 7 * i)}T${time}`),
      duration_min: duration,
      price_ils: price ? Number(price) : null,
    }))
    if (new Date(rows[0].starts_at).getTime() <= Date.now()) return setErr('השעה חייבת להיות בעתיד')
    setBusy(true)
    const { error } = await supabase.from('facility_slots').insert(rows)
    setBusy(false)
    if (error) return setErr(errorText(error))
    track('slots_created', { count: rows.length })
    setNote(rows.length === 1 ? 'השעה נוספה' : `נוספו ${rows.length} שעות (פעם בשבוע)`)
    await onChange()
  }

  async function removeSlot(id: string) {
    const { error } = await supabase.from('facility_slots').delete().eq('id', id)
    if (error) return setErr(errorText(error))
    await onChange()
  }

  const priceOf = (p: number | null, min: number) =>
    p != null ? `₪${p}` : f.price_per_hour != null ? `₪${Math.round((f.price_per_hour * min) / 60)}` : ''

  return (
    <div className="space-y-3">
      <form onSubmit={add} className="space-y-2 rounded-xl bg-mint p-3">
        <div className="text-sm font-medium">הוספת שעה פנויה</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Field label="תאריך">
            <input type="date" className={inputClass} value={date} min={tomorrow.slice(0, 10)} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="שעה">
            <input type="time" className={inputClass} value={time} step={900} onChange={(e) => setTime(e.target.value)} required />
          </Field>
          <Field label="משך">
            <select className={inputClass} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[60, 90, 120, 180].map((m) => (
                <option key={m} value={m}>
                  {m} דק׳
                </option>
              ))}
            </select>
          </Field>
          <Field label="מחיר (לא חובה)">
            <input
              type="number"
              min={0}
              className={inputClass}
              value={price}
              placeholder={f.price_per_hour != null ? String(Math.round((f.price_per_hour * duration) / 60)) : ''}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label="חזרה">
            <select className={inputClass} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
              <option value={1}>פעם אחת</option>
              <option value={4}>כל שבוע, 4 שבועות</option>
              <option value={8}>כל שבוע, 8 שבועות</option>
            </select>
          </Field>
        </div>
        <ErrorBox>{err}</ErrorBox>
        <div className="flex items-center gap-3">
          <Button type="submit" loading={busy}>
            הוספה
          </Button>
          {note && <span className="text-sm text-ok">{note}</span>}
        </div>
      </form>

      {upcoming.length === 0 ? (
        <p className="text-sm text-ink-soft">עוד אין שעות פנויות. שעה שמתפרסמת כאן מופיעה לכל מי שפותח משחק במתקן.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {upcoming.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <div>
                  {formatDate(s.starts_at)} · {s.duration_min} דק׳ {priceOf(s.price_ils, s.duration_min) && `· ${priceOf(s.price_ils, s.duration_min)}`}
                </div>
                {s.event ? (
                  <Link to={`/events/${s.event.id}`} className="text-xs text-brand-dark underline">
                    תפוס: {s.event.title}
                  </Link>
                ) : (
                  <span className="text-xs text-ok">פנוי</span>
                )}
              </div>
              {!s.event && (
                <button type="button" className="text-xs text-red-600 underline" onClick={() => removeSlot(s.id)}>
                  הסרה
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
