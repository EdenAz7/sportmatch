import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorText, supabase } from '../lib/supabase'
import { LEVELS, SLOTS, isValidIsraeliPhone } from '../lib/format'
import type { Place } from '../lib/geo'
import { track } from '../lib/analytics'
import { MapPicker } from '../components/Maps'
import { Button, Card, Chip, ErrorBox, Field, inputClass } from '../components/ui'

export default function ProfilePage({ onboarding = false }: { onboarding?: boolean }) {
  const { profile, mySports, sports, refresh, signOut, session } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  const [levels, setLevels] = useState<Record<number, number>>({})
  const [slots, setSlots] = useState<number[]>([])
  const [maxKm, setMaxKm] = useState(20)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!profile) return
    setName(profile.full_name)
    setPhone(profile.phone ?? '')
    if (profile.home_lat != null && profile.home_lng != null) {
      setPlace({ lat: profile.home_lat, lng: profile.home_lng, city: profile.city ?? '', label: '' })
    }
    setSlots(profile.pref_slots ?? [])
    setMaxKm(profile.max_distance_km)
  }, [profile])

  useEffect(() => {
    setLevels(Object.fromEntries(mySports.map((s) => [s.sport_id, s.self_level])))
  }, [mySports])

  function toggleSport(id: number) {
    setLevels((prev) => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = 3
      return next
    })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setErr('')
    setSaved(false)
    if (name.trim().length < 2) return setErr('נא להזין שם מלא')
    if (!isValidIsraeliPhone(phone)) return setErr('נא להזין מספר נייד תקין (למשל 0501234567)')
    if (!place) return setErr('נא לבחור אזור מגורים – כך נמליץ על אירועים קרובים')
    if (Object.keys(levels).length === 0) return setErr('נא לבחור לפחות ענף אחד')
    setBusy(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: name.trim(),
          phone: phone.replace(/[\s-]/g, ''),
          city: place.city || null,
          home_lat: place.lat,
          home_lng: place.lng,
          pref_slots: slots,
          max_distance_km: maxKm,
          onboarded: true,
        })
        .eq('id', profile.id)
      if (error) throw error

      const chosen = Object.entries(levels).map(([sport_id, self_level]) => ({
        user_id: profile.id,
        sport_id: Number(sport_id),
        self_level,
      }))
      const { error: e2 } = await supabase.from('user_sports').upsert(chosen)
      if (e2) throw e2
      const removed = mySports.filter((s) => !levels[s.sport_id]).map((s) => s.sport_id)
      if (removed.length) {
        const { error: e3 } = await supabase.from('user_sports').delete().eq('user_id', profile.id).in('sport_id', removed)
        if (e3) throw e3
      }
      await refresh()
      if (onboarding) {
        track('onboarding_complete', { sports: chosen.length })
        navigate('/', { replace: true })
      } else {
        setSaved(true)
      }
    } catch (e3) {
      setErr(errorText(e3))
    } finally {
      setBusy(false)
    }
  }

  async function becomeOwner() {
    const { error } = await supabase.rpc('become_facility_owner')
    if (error) return setErr(errorText(error))
    await refresh()
    navigate('/facilities')
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{onboarding ? 'נעים להכיר 👋' : 'הפרופיל שלי'}</h1>
        {onboarding && (
          <p className="text-sm text-ink-soft">
            כמה פרטים קצרים, ומנוע ההתאמה ימצא לך משחקים ברמה שלך, קרוב אליך ובשעות שנוחות לך.
          </p>
        )}
      </div>

      <Card className="space-y-3">
        <Field label="שם מלא">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="טלפון נייד" hint="יוצג רק למארגן של אירוע שהצטרפת אליו, ולך כשאתה המארגן">
          <input className={inputClass} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-1234567" />
        </Field>
      </Card>

      <Card className="space-y-3">
        <div>
          <div className="font-semibold">באילו ענפים אתה משחק?</div>
          <div className="text-xs text-ink-soft">ובאיזו רמה. הרמה מתעדכנת אוטומטית לפי הדירוגים שתקבל משחקנים אחרים</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {sports.map((s) => (
            <Chip key={s.id} active={!!levels[s.id]} onClick={() => toggleSport(s.id)}>
              {s.emoji} {s.name_he}
            </Chip>
          ))}
        </div>
        {sports
          .filter((s) => levels[s.id])
          .map((s) => (
            <div key={s.id} className="rounded-xl bg-mint p-3">
              <div className="mb-2 text-sm font-medium">
                {s.emoji} {s.name_he} · {LEVELS[levels[s.id] - 1].label}
              </div>
              <div className="grid grid-cols-5 gap-1">
                {LEVELS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setLevels((p) => ({ ...p, [s.id]: l.value }))}
                    className={`rounded-lg py-1.5 text-xs ${
                      levels[s.id] === l.value ? 'bg-brand text-white' : 'bg-white text-ink-soft'
                    }`}
                    title={l.hint}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-ink-soft">{LEVELS[levels[s.id] - 1].hint}</div>
            </div>
          ))}
      </Card>

      <Card className="space-y-3">
        <div className="font-semibold">איפה אתה גר / משחק בדרך כלל?</div>
        <MapPicker value={place} onChange={setPlace} emoji="🏠" height={200} />
        <Field label={`מרחק מקסימלי לאירועים: ${maxKm} ק"מ`}>
          <input
            type="range"
            min={2}
            max={60}
            step={1}
            value={maxKm}
            onChange={(e) => setMaxKm(Number(e.target.value))}
            className="w-full accent-[var(--color-brand)]"
          />
        </Field>
      </Card>

      <Card className="space-y-2">
        <div className="font-semibold">מתי נוח לך לשחק?</div>
        {['אמצע שבוע', 'סופ"ש'].map((group) => (
          <div key={group} className="flex items-center gap-2">
            <span className="w-20 text-sm text-ink-soft">{group}</span>
            {SLOTS.filter((s) => s.group === group).map((s) => (
              <Chip
                key={s.value}
                active={slots.includes(s.value)}
                onClick={() => setSlots((p) => (p.includes(s.value) ? p.filter((x) => x !== s.value) : [...p, s.value]))}
              >
                {s.label}
              </Chip>
            ))}
          </div>
        ))}
        <div className="text-xs text-ink-soft">בלי בחירה – נתייחס לכל השעות באופן שווה</div>
      </Card>

      <ErrorBox>{err}</ErrorBox>
      {saved && <div className="rounded-xl bg-brand-light px-3 py-2 text-sm text-brand-dark">נשמר ✓</div>}
      <Button type="submit" className="w-full" loading={busy}>
        {onboarding ? 'סיום והתחלה' : 'שמירה'}
      </Button>

      {!onboarding && (
        <Card className="space-y-2">
          <div className="text-sm text-ink-soft">מחובר כ-{session?.user.email}</div>
          {profile?.role === 'user' && (
            <Button type="button" variant="secondary" className="w-full" onClick={becomeOwner}>
              🏟️ יש לי מתקן ספורט – הרשמה כבעל מתקן
            </Button>
          )}
          <Link to="/about" className="block py-1 text-center text-sm text-brand-dark underline">
            איך עובד מנוע ההתאמה?
          </Link>
          <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()}>
            התנתקות
          </Button>
        </Card>
      )}
    </form>
  )
}
