import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorText, supabase } from '../lib/supabase'
import { LEVELS, isoToLocalInput, localInputToIso } from '../lib/format'
import type { Place } from '../lib/geo'
import type { Facility, SportEvent } from '../lib/types'
import { track } from '../lib/analytics'
import { MapPicker } from '../components/Maps'
import { Button, Card, Chip, ErrorBox, Field, PageLoader, inputClass } from '../components/ui'

function defaultStart(): string {
  // tomorrow at 19:00 Israel time
  const d = new Date(Date.now() + 86400000)
  const local = isoToLocalInput(d.toISOString())
  return `${local.slice(0, 10)}T19:00`
}

/** Create a new event, or edit an existing one at /events/:id/edit (organizer only) */
export default function CreateEvent() {
  const { id: editId } = useParams<{ id: string }>()
  const isEdit = !!editId
  const { profile, mySports, sports } = useAuth()
  const navigate = useNavigate()

  const firstSport = mySports[0]?.sport_id ?? 1
  const [loading, setLoading] = useState(isEdit)
  const [sportId, setSportId] = useState<number>(firstSport)
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(isEdit)
  const [start, setStart] = useState(defaultStart())
  const [duration, setDuration] = useState(90)
  const [maxP, setMaxP] = useState(sports.find((s) => s.id === firstSport)?.default_players ?? 10)
  const [have, setHave] = useState(1) // players the organizer already has, including himself
  const [appJoined, setAppJoined] = useState(0) // registered participants other than the organizer (edit mode)
  const [level, setLevel] = useState(Number(mySports.find((s) => s.sport_id === firstSport)?.self_level ?? 3.5))
  const [price, setPrice] = useState('')
  const [bit, setBit] = useState('')
  const [desc, setDesc] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [facilityId, setFacilityId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const sport = sports.find((s) => s.id === sportId)

  // edit mode: load the event
  useEffect(() => {
    if (!editId) return
    ;(async () => {
      const [{ data, error }, { count }] = await Promise.all([
        supabase.from('events').select('*').eq('id', editId).single(),
        supabase
          .from('event_participants')
          .select('user_id', { count: 'exact', head: true })
          .eq('event_id', editId)
          .eq('status', 'joined'),
      ])
      if (error || !data) {
        setErr('האירוע לא נמצא')
        setLoading(false)
        return
      }
      const e = data as SportEvent
      if (e.organizer_id !== profile?.id) {
        navigate(`/events/${e.id}`, { replace: true })
        return
      }
      setSportId(e.sport_id)
      setTitle(e.title)
      setStart(isoToLocalInput(e.starts_at))
      setDuration(e.duration_min)
      setMaxP(e.max_participants)
      setHave(e.guest_count + 1)
      setAppJoined(Math.max(0, (count ?? 1) - 1))
      setLevel(Number(e.level))
      setPrice(Number(e.price_ils) > 0 ? String(Number(e.price_ils)) : '')
      setBit(e.bit_link ?? '')
      setDesc(e.description ?? '')
      setPlace({ lat: e.lat, lng: e.lng, city: e.city, label: e.address ?? '' })
      setFacilityId(e.facility_id ?? '')
      setLoading(false)
    })()
  }, [editId, profile?.id, navigate])

  // suggested title (until the user types their own)
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

  function chooseSport(id: number) {
    setSportId(id)
    if (!isEdit) {
      const s = sports.find((x) => x.id === id)
      if (s) setMaxP(s.default_players)
      const mine = mySports.find((x) => x.sport_id === id)
      if (mine) setLevel(Number(mine.self_level))
    }
  }

  function chooseFacility(id: string) {
    setFacilityId(id)
    const f = facilities.find((x) => x.id === id)
    if (f) setPlace({ lat: f.lat, lng: f.lng, city: f.city, label: f.name })
  }

  const taken = have + appJoined
  const missing = Math.max(0, maxP - taken)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setErr('')
    if (!place) return setErr('נא לבחור מיקום למגרש')
    if (!place.city) return setErr('לא זיהינו עיר במיקום שנבחר. נסה לחפש כתובת מדויקת')
    const startsAt = localInputToIso(start)
    if (new Date(startsAt).getTime() < Date.now()) return setErr('מועד האירוע חייב להיות בעתיד')
    if (bit && !/^https:\/\//i.test(bit.trim())) return setErr('קישור התשלום צריך להתחיל ב-https://')
    if (have < 1) return setErr('מספר השחקנים שיש לך כולל אותך – לפחות 1')
    if (taken > maxP) return setErr(`כבר יש ${taken} שחקנים – הגדל את מספר המשתתפים או הקטן את מספר השחקנים שיש לך`)
    const payload = {
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
      guest_count: have - 1,
      level,
      price_ils: Number(price) || 0,
      bit_link: bit.trim() || null,
    }
    setBusy(true)
    try {
      if (isEdit) {
        const { error } = await supabase.from('events').update(payload).eq('id', editId)
        if (error) throw error
        track('event_edited', { event_id: editId })
        navigate(`/events/${editId}`, { replace: true })
      } else {
        const { data, error } = await supabase
          .from('events')
          .insert({ ...payload, organizer_id: profile.id })
          .select('id')
          .single()
        if (error) throw error
        track('event_created', { sport_id: sportId, max: maxP, have })
        navigate(`/events/${data.id}?created=1`, { replace: true })
      }
    } catch (e2) {
      setErr(errorText(e2))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <PageLoader />

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-end justify-between gap-2">
        <h1 className="page-title">{isEdit ? 'עריכת אירוע' : 'אירוע חדש'}</h1>
        {isEdit && (
          <Link to={`/events/${editId}`} className="pb-1 text-sm text-ink-soft underline">
            חזרה לאירוע
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card className="space-y-3">
            <div className="font-semibold">ענף</div>
            <div className="flex flex-wrap gap-2">
              {sports.map((s) => (
                <Chip key={s.id} active={sportId === s.id} onClick={() => chooseSport(s.id)}>
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
              <Field label="סה״כ משתתפים">
                <input
                  type="number"
                  min={2}
                  max={100}
                  className={inputClass}
                  value={maxP}
                  onChange={(e) => setMaxP(Math.max(2, Math.min(100, Number(e.target.value) || 2)))}
                />
              </Field>
              <Field label="יש לך כרגע (כולל אותך)">
                <input
                  type="number"
                  min={1}
                  max={maxP}
                  className={inputClass}
                  value={have}
                  onChange={(e) => setHave(Math.max(1, Math.min(maxP, Number(e.target.value) || 1)))}
                />
              </Field>
            </div>
            <div className={`rounded-xl px-3 py-2 text-sm ${missing > 0 ? 'bg-brand-light text-brand-dark' : 'bg-ok/15 text-ok'}`}>
              {missing > 0 ? (
                <>
                  👥 יש {taken} מתוך {maxP}
                  {appJoined > 0 && ` (${appJoined} נרשמו דרך האפליקציה)`} · <b>מחפשים עוד {missing} שחקנים</b>
                </>
              ) : (
                <>✓ יש לך את כל השחקנים – האירוע יסומן כמלא</>
              )}
            </div>
            <Field label="רמה מבוקשת">
              <select className={inputClass} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label} · {l.hint}
                  </option>
                ))}
              </select>
            </Field>
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
          </Card>
        </div>

        <div className="space-y-4">
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
            <MapPicker
              value={place}
              onChange={(p) => {
                setPlace(p)
                setFacilityId('')
              }}
              emoji={sport?.emoji ?? '📍'}
              height={260}
            />
          </Card>
          <Card>
            <Field label="פרטים נוספים">
              <textarea
                className={inputClass}
                rows={4}
                maxLength={1000}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="למשל: להביא חולצה לבנה וכהה"
              />
            </Field>
          </Card>
        </div>
      </div>

      <ErrorBox>{err}</ErrorBox>
      <div className="flex justify-center pt-1">
        <Button type="submit" variant="hero" className="w-64 py-3.5 text-lg" loading={busy}>
          {isEdit ? 'שמירת שינויים' : 'פרסום האירוע'}
        </Button>
      </div>
      <p className="text-center text-xs text-white/80">
        {isEdit ? 'המשתתפים הרשומים יקבלו התראה אם המועד, המיקום או המחיר השתנו' : 'אתה נספר כמשתתף הראשון'}
      </p>
    </form>
  )
}
