import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { errorText, supabase } from '../lib/supabase'
import type { Facility } from '../lib/types'
import type { Place } from '../lib/geo'
import { track } from '../lib/analytics'
import { MapPicker } from './Maps'
import { Button, Card, Chip, ErrorBox, Field, inputClass } from './ui'

/** Add a new facility, or edit one (when `initial` is given). */
export default function FacilityForm({ initial, onDone }: { initial?: Facility; onDone: (saved: boolean) => void }) {
  const { profile, sports } = useAuth()
  const [name, setName] = useState(initial?.name ?? '')
  const [place, setPlace] = useState<Place | null>(
    initial ? { lat: initial.lat, lng: initial.lng, city: initial.city, label: initial.address ?? initial.name } : null,
  )
  const [sportIds, setSportIds] = useState<number[]>(initial?.sport_ids ?? [])
  const [phone, setPhone] = useState(initial?.phone ?? profile?.phone ?? '')
  const [price, setPrice] = useState(initial?.price_per_hour != null ? String(initial.price_per_hour) : '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    if (name.trim().length < 2) return setErr('נא להזין שם')
    if (!place?.city) return setErr('נא לבחור מיקום עם עיר')
    if (!sportIds.length) return setErr('נא לבחור לפחות ענף אחד')
    const row = {
      name: name.trim(),
      city: place.city,
      address: place.label || null,
      lat: place.lat,
      lng: place.lng,
      sport_ids: sportIds,
      phone: phone || null,
      price_per_hour: price ? Number(price) : null,
      description: desc || null,
    }
    setBusy(true)
    const { error } = initial
      ? await supabase.from('facilities').update(row).eq('id', initial.id)
      : await supabase.from('facilities').insert({ ...row, owner_id: profile.id })
    setBusy(false)
    if (error) return setErr(errorText(error))
    track(initial ? 'facility_updated' : 'facility_created')
    onDone(true)
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div className="font-semibold">{initial ? 'עריכת מתקן' : 'מתקן חדש'}</div>
        <Field label="שם המתקן">
          <input className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {sports.map((s) => (
            <Chip
              key={s.id}
              active={sportIds.includes(s.id)}
              onClick={() => setSportIds((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))}
            >
              {s.emoji} {s.name_he}
            </Chip>
          ))}
        </div>
        <MapPicker value={place} onChange={setPlace} emoji="🏟️" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="טלפון">
            <input className={inputClass} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="מחיר לשעה ₪">
            <input type="number" min={0} className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <Field label="תיאור">
          <textarea className={inputClass} rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <ErrorBox>{err}</ErrorBox>
        <div className="flex gap-2">
          <Button type="submit" loading={busy} className="flex-1">
            שמירה
          </Button>
          <Button type="button" variant="secondary" onClick={() => onDone(false)}>
            ביטול
          </Button>
        </div>
      </form>
    </Card>
  )
}
