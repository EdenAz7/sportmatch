import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorText, supabase } from '../lib/supabase'
import { LEVELS, isoToLocalInput, localInputToIso } from '../lib/format'
import type { Place } from '../lib/geo'
import type { Facility } from '../lib/types'
import { track } from '../lib/analytics'
import { MapPicker } from '../components/Maps'
import { Button, Card, Chip, ErrorBox, Field, inputClass } from '../components/ui'

function defaultStart(): string {
  // tomorrow at 19:00 Israel time
  const d = new Date(Date.now() + 86400000)
  const local = isoToLocalInput(d.toISOString())
  return `${local.slice(0, 10)}T19:00`
}

export default function CreateEvent() {
  const { profile, mySports, sports } = useAuth()
  const navigate = useNavigate()
  const [sportId, setSportId] = useState<number>(mySports[0]?.sport_id ?? 1)
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [start, setStart] = useState(defaultStart())
  const [duration, setDuration] = useState(90)
  const [maxP, setMaxP] = useState(10)
  const [level, setLevel] = useState(3)
  const [price, setPrice] = useState('')
  const [bit, setBit] = useState('')
  const [desc, setDesc] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const sport = sports.find((s) => s.id === sportId)

  useEffect(() => {
    if (sport) setMaxP(sport.default_players)
    const mine = mySports.find((s) => s.sport_id === sportId)
    if (mine) setLevel(mine.self_level)
  }, [sport, sportId, mySports])

  useEffect(() => {
    if (!titleTouched && sport) setTitle(`${sport.name_he}${place?.city ? ` ב${place.city}` : ''}`)
  }, [sport, place, titleTouched])

  useEffect(() => {
    supabase
      .from('facilities')
      .select('*')
      .contains('sport_ids', [sportId])
      .then(({ data }) => setFacilities((data as Facility[]) ?? []))
  }, [sportId])

  function chooseFacility(id: string) {
    setFacilityId(id)
    const f = facilities.find((x) => x.id === id)
    if (f) setPlace({ lat: f.lat, lng: f.lng, city: f.city, label: f.name })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setErr('')
    if (!place) return setErr('נא לבחור מיקום למגרש')
    if (!place.city) return setErr('לא זיהינו עיר במיקום שנבחר. נסה לחפש כתובת מדויקת')
    const startsAt = localInputToIso(start)
    if (new Date(startsAt).getTime() < Date.now()) return setErr('מועד האירוע חייב להיות בעתיד')
    if (bit && !/^https:\/\//i.test(bit.trim())) return setErr('קישור התשלום צריך להתחיל ב-https://')
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('events')
        .insert({
          organizer_id: profile.id,
          sport_id: sportId,
          facility_id: facilityId || null,
          title: title.trim(),
          description: desc.trim() || null,
          city: place.city,
          address: place.label || null,
          lat: place.lat,
          lng: place.lng,
          starts_at: startsAt,
          duration_min: duration,
          max_participants: maxP,
          level,
          price_ils: Number(price) || 0,
          bit_link: bit.trim() || null,
        })
        .select('id')
        .single()
      if (error) throw error
      track('event_created', { sport_id: sportId, max: maxP })
      navigate(`/events/${data.id}?created=1`, { replace: true })
    } catch (e2) {
      setErr(errorText(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-2xl font-bold">אירוע חדש</h1>

      <Card className="space-y-3">
        <div className="font-semibold">ענף</div>
        <div className="flex flex-wrap gap-2">
          {sports.map((s) => (
            <Chip key={s.id} active={sportId === s.id} onClick={() => setSportId(s.id)}>
              {s.emoji} {s.name_he}
            </Chip>
          ))}
        </div>
        <Field label="שם האירוע">
          <input
            className={inputClass}
            value={title}
            maxLength={80}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleTouched(true)
            }}
          />
        </Field>
      </Card>

      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="מתי">
            <input type="datetime-local" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="משך (דקות)">
            <select className={inputClass} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[45, 60, 90, 120, 150, 180].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="מספר משתתפים (כולל אותך)">
            <input
              type="number"
              min={2}
              max={100}
              className={inputClass}
              value={maxP}
              onChange={(e) => setMaxP(Math.max(2, Math.min(100, Number(e.target.value))))}
            />
          </Field>
          <Field label="רמה מבוקשת">
            <select className={inputClass} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="font-semibold">איפה</div>
        {facilities.length > 0 && (
          <Field label="מתקן רשום (לא חובה)">
            <select className={inputClass} value={facilityId} onChange={(e) => chooseFacility(e.target.value)}>
              <option value="">— מיקום חופשי —</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.city}
                </option>
              ))}
            </select>
          </Field>
        )}
        <MapPicker value={place} onChange={(p) => { setPlace(p); setFacilityId('') }} emoji={sport?.emoji ?? '📍'} />
      </Card>

      <Card className="space-y-3">
        <div className="font-semibold">תשלום (לא חובה)</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="מחיר למשתתף ₪">
            <input type="number" min={0} className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
          </Field>
          <div className="col-span-2">
            <Field label="קישור לתשלום ב-Bit">
              <input className={inputClass} dir="ltr" value={bit} onChange={(e) => setBit(e.target.value)} placeholder="https://..." />
            </Field>
          </div>
        </div>
        <p className="text-xs text-ink-soft">
          פותחים באפליקציית ביט "בקשת תשלום" עם קישור, ומדביקים כאן. המשתתפים ישלמו דרכו, ואתה תסמן מי שילם.
        </p>
        <Field label="פרטים נוספים">
          <textarea className={inputClass} rows={3} maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="למשל: להביא חולצה לבנה וכהה" />
        </Field>
      </Card>

      <ErrorBox>{err}</ErrorBox>
      <Button type="submit" className="w-full" loading={busy}>
        פרסום האירוע
      </Button>
    </form>
  )
}
