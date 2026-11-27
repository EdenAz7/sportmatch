import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { errorText, supabase } from '../lib/supabase'
import type { Facility } from '../lib/types'
import type { Place } from '../lib/geo'
import { MapPicker } from '../components/Maps'
import { Button, Card, Chip, Empty, ErrorBox, Field, PageLoader, inputClass } from '../components/ui'

export default function Facilities() {
  const { profile, sports } = useAuth()
  const [items, setItems] = useState<Facility[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const canAdd = profile?.role === 'facility_owner' || profile?.role === 'admin'

  async function load() {
    const { data } = await supabase.from('facilities').select('*').order('created_at', { ascending: false })
    setItems((data as Facility[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">מתקני ספורט</h1>
        {canAdd && !adding && <Button onClick={() => setAdding(true)}>➕ מתקן</Button>}
      </div>
      {!canAdd && (
        <p className="text-sm text-ink-soft">
          בעלי מתקנים יכולים להירשם בדף הפרופיל, לפרסם את המגרשים שלהם ולקבל אירועים שנפתחים אצלם.
        </p>
      )}
      {adding && <FacilityForm onDone={() => { setAdding(false); void load() }} />}
      {loading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <Empty icon="🏟️" title="עוד אין מתקנים רשומים" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((f) => (
            <Card key={f.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{f.name}</div>
                  <div className="text-sm text-ink-soft">📍 {[f.address, f.city].filter(Boolean).join(', ')}</div>
                  <div className="mt-1 text-lg">{f.sport_ids.map((id) => sports.find((s) => s.id === id)?.emoji).join(' ')}</div>
                </div>
                <div className="text-left text-sm">
                  {f.price_per_hour != null && <div className="font-semibold">₪{f.price_per_hour}/שעה</div>}
                  {f.phone && (
                    <a href={`tel:${f.phone}`} className="text-brand-dark underline">
                      התקשרות
                    </a>
                  )}
                </div>
              </div>
              {f.description && <p className="mt-2 text-sm text-ink-soft">{f.description}</p>}
              {f.owner_id === profile?.id && (
                <button
                  className="mt-2 text-xs text-red-600"
                  onClick={async () => {
                    if (!window.confirm('למחוק את המתקן?')) return
                    await supabase.from('facilities').delete().eq('id', f.id)
                    void load()
                  }}
                >
                  מחיקה
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function FacilityForm({ onDone }: { onDone: () => void }) {
  const { profile, sports } = useAuth()
  const [name, setName] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  const [sportIds, setSportIds] = useState<number[]>([])
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [price, setPrice] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    if (name.trim().length < 2) return setErr('נא להזין שם')
    if (!place?.city) return setErr('נא לבחור מיקום עם עיר')
    if (!sportIds.length) return setErr('נא לבחור לפחות ענף אחד')
    setBusy(true)
    const { error } = await supabase.from('facilities').insert({
      owner_id: profile.id,
      name: name.trim(),
      city: place.city,
      address: place.label || null,
      lat: place.lat,
      lng: place.lng,
      sport_ids: sportIds,
      phone: phone || null,
      price_per_hour: price ? Number(price) : null,
      description: desc || null,
    })
    setBusy(false)
    if (error) return setErr(errorText(error))
    onDone()
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <Field label="שם המתקן">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
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
          <Button type="button" variant="secondary" onClick={onDone}>
            ביטול
          </Button>
        </div>
      </form>
    </Card>
  )
}
