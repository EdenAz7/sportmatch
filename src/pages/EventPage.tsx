import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorText, supabase } from '../lib/supabase'
import { formatDate, googleCalendarUrl, levelLabel, waNumber } from '../lib/format'
import type { EventDetails, Participant } from '../lib/types'
import { balanceTeams, type BalanceResult } from '../engine/teams'
import { track } from '../lib/analytics'
import { MapView } from '../components/Maps'
import { Button, Card, ErrorBox, LevelDots, PageLoader } from '../components/ui'

const TEAM_COLORS = ['bg-sky-100 text-sky-800', 'bg-orange-100 text-orange-800', 'bg-violet-100 text-violet-800', 'bg-lime-100 text-lime-800']

export default function EventPage() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const src = (params.get('src') as 'recommendation' | 'browse' | null) ?? 'link'
  const justCreated = params.get('created') === '1'

  const [d, setD] = useState<EventDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState<BalanceResult | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_event_details', { p_event: id })
    if (error) setErr(errorText(error))
    setD(data as EventDetails | null)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <PageLoader />
  if (!d) return <div className="py-10 text-center">האירוע לא נמצא</div>

  const e = d.event
  const joined = d.participants.filter((p) => p.status === 'joined' || p.status === 'attended' || p.status === 'no_show')
  const past = new Date(e.starts_at).getTime() < Date.now()
  const iAmIn = d.my_status === 'joined' || d.my_status === 'attended'
  const spots = e.max_participants - joined.length
  const shareUrl = `${window.location.origin}${window.location.pathname}#/events/${e.id}`
  const shareText = `${d.sport.emoji} ${e.title}\n${formatDate(e.starts_at)} · ${e.city}\nנשארו ${Math.max(0, spots)} מקומות – הצטרפו ב-SportMatch:\n${shareUrl}`
  const hasTeams = joined.some((p) => p.team != null)

  async function act(fn: () => PromiseLike<{ error: unknown }>, event?: string) {
    setBusy(true)
    setErr('')
    const { error } = await fn()
    setBusy(false)
    if (error) return setErr(errorText(error))
    if (event) track(event, { event_id: e.id, source: src })
    await load()
  }

  function join() {
    if (!session) {
      navigate(`/login?next=${encodeURIComponent(`/events/${e.id}?src=${src}`)}`)
      return
    }
    void act(() => supabase.rpc('join_event', { p_event: e.id, p_source: src }), 'join_event')
  }

  function computeTeams() {
    const players = joined.map((p) => ({ id: p.user_id, name: p.full_name, level: Number(p.level) }))
    setPreview(balanceTeams(players, Math.max(2, d!.sport.team_count)))
  }

  async function saveTeams() {
    if (!preview) return
    const payload = preview.teams.flatMap((t, i) => t.map((p) => ({ user_id: p.id, team: i + 1 })))
    await act(
      () =>
        supabase.rpc('save_teams', {
          p_event: e.id,
          p_teams: payload,
          p_imbalance: preview.imbalance,
          p_imbalance_random: preview.randomImbalance,
        }),
      'teams_saved',
    )
    setPreview(null)
  }

  return (
    <div className="space-y-4">
      {justCreated && (
        <div className="rounded-2xl bg-brand p-4 text-white">
          <div className="font-semibold">🎉 האירוע פורסם!</div>
          <div className="text-sm text-white/90">מנוע ההתאמה כבר ממליץ עליו לשחקנים מתאימים. כדאי גם לשתף בוואטסאפ:</div>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-brand-dark"
          >
            שיתוף בוואטסאפ
          </a>
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl shadow-sm">{d.sport.emoji}</div>
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-bold">{e.title}</h1>
          <div className="text-sm text-ink-soft">
            {d.sport.name_he} · רמה {levelLabel(e.level)}
            {e.status === 'cancelled' && <span className="mr-2 font-semibold text-red-600">· בוטל</span>}
          </div>
        </div>
      </div>

      <Card className="space-y-2 text-sm">
        <div>🗓️ {formatDate(e.starts_at)} · {e.duration_min} דק'</div>
        <div>📍 {[e.address, e.city].filter(Boolean).join(', ')}</div>
        {d.facility && <div>🏟️ {d.facility.name}</div>}
        <div>
          👥 {joined.length}/{e.max_participants} משתתפים · רמה ממוצעת {d.event_level.toFixed(1)} <LevelDots level={d.event_level} />
        </div>
        <div>💰 {Number(e.price_ils) > 0 ? `₪${Number(e.price_ils)} למשתתף` : 'ללא תשלום'}</div>
        <div>
          🧑‍💼 מארגן: {d.organizer.full_name} · ⭐ {(1 + d.organizer.reputation * 4).toFixed(1)}
          {d.organizer.phone && !d.is_organizer && (
            <a
              className="mr-2 text-brand-dark underline"
              href={`https://wa.me/${waNumber(d.organizer.phone)}`}
              target="_blank"
              rel="noreferrer"
            >
              וואטסאפ
            </a>
          )}
        </div>
        {e.description && <div className="rounded-xl bg-mint p-2 whitespace-pre-line">{e.description}</div>}
      </Card>

      <MapView center={{ lat: e.lat, lng: e.lng }} markers={[{ pos: { lat: e.lat, lng: e.lng }, emoji: d.sport.emoji }]} height={170} />

      <ErrorBox>{err}</ErrorBox>

      {/* Main action */}
      {e.status !== 'cancelled' && !past && (
        <div className="space-y-2">
          {!iAmIn ? (
            <Button className="w-full py-3 text-lg" onClick={join} loading={busy} disabled={spots <= 0}>
              {spots <= 0 ? 'האירוע מלא' : session ? 'אני בפנים! 🙌' : 'התחברות והצטרפות'}
            </Button>
          ) : (
            <div className="rounded-2xl bg-brand-light p-3 text-center font-medium text-brand-dark">
              {d.is_organizer ? 'אתה המארגן של האירוע' : 'אתה רשום לאירוע ✓'}
            </div>
          )}
          {iAmIn && !d.is_organizer && Number(e.price_ils) > 0 && e.bit_link && (
            <a href={e.bit_link} target="_blank" rel="noreferrer" onClick={() => track('bit_click', { event_id: e.id })}>
              <Button variant="dark" className="w-full">
                תשלום ₪{Number(e.price_ils)} ב-Bit
              </Button>
            </a>
          )}
          <div className="grid grid-cols-2 gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
              <Button variant="secondary" className="w-full text-sm">
                📤 שיתוף
              </Button>
            </a>
            <a href={googleCalendarUrl(e.title, e.starts_at, e.duration_min, `${e.address ?? ''} ${e.city}`)} target="_blank" rel="noreferrer">
              <Button variant="secondary" className="w-full text-sm">
                📅 ליומן
              </Button>
            </a>
          </div>
          {iAmIn && !d.is_organizer && (
            <Button variant="ghost" className="w-full text-sm" onClick={() => act(() => supabase.rpc('leave_event', { p_event: e.id }), 'leave_event')}>
              ביטול השתתפות
            </Button>
          )}
        </div>
      )}

      {/* Participants */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold">משתתפים</div>
          {hasTeams && <span className="text-xs text-ink-soft">מחולקים לקבוצות ⚖️</span>}
        </div>
        <ParticipantList d={d} busy={busy} act={act} />
      </Card>

      {/* Organizer tools */}
      {d.is_organizer && e.status !== 'cancelled' && (
        <Card className="space-y-3">
          <div className="font-semibold">כלי מארגן</div>
          {d.sport.team_count >= 2 && joined.length >= 2 && (
            <div className="space-y-2">
              <Button variant="dark" className="w-full" onClick={computeTeams}>
                ⚖️ {hasTeams ? 'חלוקה מחדש לקבוצות מאוזנות' : 'חלוקה לקבוצות מאוזנות'}
              </Button>
              {preview && <TeamsPreview r={preview} onSave={saveTeams} busy={busy} />}
            </div>
          )}
          {!past && (
            <Button
              variant="danger"
              className="w-full text-sm"
              onClick={() => {
                if (window.confirm('לבטל את האירוע? כל המשתתפים יקבלו הודעה')) {
                  void act(() => supabase.rpc('cancel_event', { p_event: e.id }), 'cancel_event')
                }
              }}
            >
              ביטול האירוע
            </Button>
          )}
        </Card>
      )}

      {/* Ratings after the game */}
      {past && iAmIn && joined.length > 1 && e.status !== 'cancelled' && (
        <RatingForm d={d} onDone={load} />
      )}
      <div className="pb-2 text-center">
        <Link to="/" className="text-sm text-ink-soft underline">
          חזרה לדף הבית
        </Link>
      </div>
    </div>
  )
}

function ParticipantList({
  d,
  busy,
  act,
}: {
  d: EventDetails
  busy: boolean
  act: (fn: () => PromiseLike<{ error: unknown }>) => Promise<void>
}) {
  const past = new Date(d.event.starts_at).getTime() < Date.now()
  const list = [...d.participants].sort((a, b) => (a.team ?? 0) - (b.team ?? 0))
  return (
    <div className="divide-y divide-line">
      {list.map((p: Participant) => (
        <div key={p.user_id} className="flex items-center gap-2 py-2">
          {p.team != null && (
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${TEAM_COLORS[(p.team - 1) % 4]}`}>{p.team}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {p.full_name || 'שחקן'}
              {p.user_id === d.organizer.id && <span className="mr-1 text-xs text-ink-soft">(מארגן)</span>}
              {p.status === 'no_show' && <span className="mr-1 text-xs text-red-600">(לא הגיע)</span>}
            </div>
            <div className="text-xs text-ink-soft">
              <LevelDots level={Number(p.level)} /> {Number(p.level).toFixed(1)} · ⭐ {(1 + Number(p.reputation) * 4).toFixed(1)}
            </div>
          </div>
          {d.is_organizer && p.user_id !== d.organizer.id && (
            <div className="flex items-center gap-1">
              {p.phone && (
                <a href={`https://wa.me/${waNumber(p.phone)}`} target="_blank" rel="noreferrer" className="px-1 text-lg" aria-label="וואטסאפ">
                  💬
                </a>
              )}
              {Number(d.event.price_ils) > 0 && (
                <button
                  disabled={busy}
                  onClick={() => act(() => supabase.rpc('set_paid', { p_event: d.event.id, p_user: p.user_id, p_paid: !p.paid }))}
                  className={`rounded-lg px-2 py-1 text-xs ${p.paid ? 'bg-brand-light text-brand-dark' : 'bg-mint text-ink-soft'}`}
                >
                  {p.paid ? 'שילם ✓' : 'לא שילם'}
                </button>
              )}
              {past && (
                <button
                  disabled={busy}
                  onClick={() =>
                    act(() => supabase.rpc('set_attendance', { p_event: d.event.id, p_user: p.user_id, p_attended: p.status === 'no_show' }))
                  }
                  className="rounded-lg bg-mint px-2 py-1 text-xs text-ink-soft"
                >
                  {p.status === 'no_show' ? 'סמן הגיע' : 'לא הגיע?'}
                </button>
              )}
            </div>
          )}
          {!d.is_organizer && Number(d.event.price_ils) > 0 && (
            <span className={`text-xs ${p.paid ? 'text-brand-dark' : 'text-ink-soft/60'}`}>{p.paid ? 'שילם' : ''}</span>
          )}
        </div>
      ))}
    </div>
  )
}

function TeamsPreview({ r, onSave, busy }: { r: BalanceResult; onSave: () => void; busy: boolean }) {
  const improvement = r.randomImbalance > 0 ? Math.round((1 - r.imbalance / r.randomImbalance) * 100) : 0
  return (
    <div className="animate-pop space-y-2 rounded-xl bg-mint p-3">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${r.teams.length}, minmax(0, 1fr))` }}>
        {r.teams.map((t, i) => (
          <div key={i} className="rounded-lg bg-white p-2">
            <div className={`mb-1 rounded-md px-1.5 py-0.5 text-center text-xs font-semibold ${TEAM_COLORS[i % 4]}`}>
              קבוצה {i + 1} · {r.sums[i].toFixed(1)}
            </div>
            {t.map((p) => (
              <div key={p.id} className="flex justify-between text-xs">
                <span className="truncate">{p.name}</span>
                <span className="text-ink-soft">{p.level.toFixed(1)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="text-xs text-ink-soft">
        פער בין הקבוצות: <b>{r.imbalance.toFixed(2)}</b> (בחלוקה אקראית: {r.randomImbalance.toFixed(2)})
        {improvement > 0 && <> · <b className="text-brand-dark">{improvement}% יותר מאוזן</b></>}
        <br />
        שיטה: {r.method === 'exact' ? 'חיפוש מלא (אופטימלי)' : 'חמדני + שיפור בהחלפות'}
      </div>
      <Button className="w-full" onClick={onSave} loading={busy}>
        שמירה ושליחה למשתתפים
      </Button>
    </div>
  )
}

function RatingForm({ d, onDone }: { d: EventDetails; onDone: () => Promise<void> }) {
  const { session } = useAuth()
  const others = d.participants.filter((p) => p.user_id !== session?.user.id && p.status !== 'no_show')
  const [vals, setVals] = useState<Record<string, { skill: number; sportsmanship: number }>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  if (d.my_ratings_done >= others.length && others.length > 0) {
    return (
      <Card className="text-center text-sm text-ink-soft">
        תודה! דירגת את כל השחקנים ⭐ הדירוגים משפרים את ההתאמות של כולם
      </Card>
    )
  }

  async function submit() {
    const ratings = Object.entries(vals).map(([user_id, v]) => ({ user_id, ...v }))
    if (!ratings.length) return setMsg('בחר דירוג לפחות לשחקן אחד')
    setBusy(true)
    const { error } = await supabase.rpc('submit_ratings', { p_event: d.event.id, p_ratings: ratings })
    setBusy(false)
    if (error) return setMsg(errorText(error))
    track('ratings_submitted', { n: ratings.length })
    await onDone()
  }

  const Stars = ({ uid, field }: { uid: string; field: 'skill' | 'sportsmanship' }) => (
    <div className="flex gap-0.5" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() =>
            setVals((p) => ({ ...p, [uid]: { skill: p[uid]?.skill ?? 3, sportsmanship: p[uid]?.sportsmanship ?? 4, [field]: n } }))
          }
          className={`text-lg ${n <= (vals[uid]?.[field] ?? 0) ? '' : 'opacity-25 grayscale'}`}
        >
          ⭐
        </button>
      ))}
    </div>
  )

  return (
    <Card className="space-y-3">
      <div>
        <div className="font-semibold">איך היה המשחק? דרג את השחקנים</div>
        <div className="text-xs text-ink-soft">הדירוג אנונימי ומשפר את הערכת הרמה ואת ההתאמות</div>
      </div>
      {others.map((p) => (
        <div key={p.user_id} className="rounded-xl bg-mint p-2">
          <div className="mb-1 text-sm font-medium">{p.full_name}</div>
          <div className="flex items-center justify-between text-xs text-ink-soft">
            <span>רמת משחק</span>
            <Stars uid={p.user_id} field="skill" />
          </div>
          <div className="flex items-center justify-between text-xs text-ink-soft">
            <span>ספורטיביות</span>
            <Stars uid={p.user_id} field="sportsmanship" />
          </div>
        </div>
      ))}
      {msg && <div className="text-sm text-red-600">{msg}</div>}
      <Button className="w-full" onClick={submit} loading={busy}>
        שליחת דירוג
      </Button>
    </Card>
  )
}
