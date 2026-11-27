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
const HOUR = 3600000
const money = (n: number) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(2))

/** Cancellation policy, mirrored from the database (leave_event) */
function cancellationState(d: EventDetails) {
  const start = new Date(d.event.starts_at).getTime()
  const promotedRecently = !!d.my_promoted_at && new Date(d.my_promoted_at).getTime() >= start - 24 * HOUR
  const left = start - Date.now()
  const locked = !promotedRecently && left < 3 * HOUR
  const late = !promotedRecently && left < 24 * HOUR
  const price = Number(d.event.price_ils)
  const refund = d.my_paid && price > 0 ? (late ? Math.round(price * 50) / 100 : price) : 0
  return { locked, late, refund, price, promotedRecently }
}

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
  const [confirmLeave, setConfirmLeave] = useState(false)

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
  const onWaitlist = d.my_status === 'waitlist'
  const guests = e.guest_count ?? 0
  const taken = joined.length + guests
  const spots = e.max_participants - taken
  const price = Number(e.price_ils)
  const shareUrl = `${window.location.origin}${window.location.pathname}#/events/${e.id}`
  const shareText = `${d.sport.emoji} ${e.title}\n${formatDate(e.starts_at)} · ${e.city}\n${
    spots > 0 ? `נשארו ${spots} מקומות` : 'מלא – אפשר להירשם לרשימת ההמתנה'
  } – הצטרפו ב-SportMatch:\n${shareUrl}`
  const hasTeams = joined.some((p) => p.team != null)
  const cancel = cancellationState(d)

  async function act(fn: () => PromiseLike<{ error: unknown }>, event?: string) {
    setBusy(true)
    setErr('')
    const { error } = await fn()
    setBusy(false)
    if (error) return setErr(errorText(error))
    if (event) track(event, { event_id: e.id, source: src })
    await load()
  }

  function requireLogin(): boolean {
    if (session) return true
    navigate(`/login?next=${encodeURIComponent(`/events/${e.id}?src=${src}`)}`)
    return false
  }

  function join() {
    if (requireLogin()) void act(() => supabase.rpc('join_event', { p_event: e.id, p_source: src }), 'join_event')
  }

  function joinWaitlist() {
    if (requireLogin()) void act(() => supabase.rpc('join_waitlist', { p_event: e.id }), 'join_waitlist')
  }

  async function leave() {
    setConfirmLeave(false)
    await act(() => supabase.rpc('leave_event', { p_event: e.id }), onWaitlist ? 'leave_waitlist' : 'leave_event')
  }

  function computeTeams() {
    const players = joined.map((p) => ({ id: p.user_id, name: p.full_name, level: Number(p.level) }))
    // the organizer's own players are not registered: assume the event's target level
    for (let i = 1; i <= guests; i++) players.push({ id: `guest-${i}`, name: `חבר של המארגן ${i}`, level: Number(e.level) })
    setPreview(balanceTeams(players, Math.max(2, d!.sport.team_count)))
  }

  async function saveTeams() {
    if (!preview) return
    const payload = preview.teams.flatMap((t, i) =>
      t.filter((p) => !p.id.startsWith('guest-')).map((p) => ({ user_id: p.id, team: i + 1 })),
    )
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
    <div className="mx-auto max-w-5xl space-y-4">
      {justCreated && (
        <div className="rounded-2xl bg-ok p-4 text-white shadow-md">
          <div className="font-semibold">🎉 האירוע פורסם!</div>
          <div className="text-sm text-white/90">מנוע ההתאמה כבר ממליץ עליו לשחקנים מתאימים. כדאי גם לשתף בוואטסאפ:</div>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-ok"
          >
            שיתוף בוואטסאפ
          </a>
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl shadow-md">{d.sport.emoji}</div>
        <div className="min-w-0">
          <h1 className="page-title text-[1.6rem]">{e.title}</h1>
          <div className="text-sm text-ink-soft">
            {d.sport.name_he} · רמה {levelLabel(e.level)}
            {e.status === 'cancelled' && <span className="mr-2 font-semibold text-red-700">· בוטל</span>}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <div className="space-y-4">
          <Card className="space-y-2 text-sm">
            <div>🗓️ {formatDate(e.starts_at)} · {e.duration_min} דק'</div>
            <div>📍 {[e.address, e.city].filter(Boolean).join(', ')}</div>
            {d.facility && <div>🏟️ {d.facility.name}</div>}
            <div>
              👥 {taken}/{e.max_participants} משתתפים{guests > 0 && ` (כולל ${guests} של המארגן)`}
              {d.waitlist.length > 0 && ` · ${d.waitlist.length} ברשימת המתנה`}
            </div>
            <div>
              📶 רמה ממוצעת {Number(d.event_level).toFixed(1)} (טווח {levelLabel(d.event_level)}) <LevelDots level={d.event_level} />
            </div>
            <div>💰 {price > 0 ? `₪${money(price)} למשתתף` : 'ללא תשלום'}</div>
            <div>
              🧑‍💼 מארגן: {d.organizer.full_name} · ⭐ {(1 + d.organizer.reputation * 4).toFixed(1)}
              {d.organizer.phone && !d.is_organizer && (
                <a className="mr-2 text-brand underline" href={`https://wa.me/${waNumber(d.organizer.phone)}`} target="_blank" rel="noreferrer">
                  וואטסאפ
                </a>
              )}
            </div>
            {e.description && <div className="rounded-xl bg-mint p-2 whitespace-pre-line">{e.description}</div>}
          </Card>

          <MapView
            center={{ lat: e.lat, lng: e.lng }}
            markers={[{ pos: { lat: e.lat, lng: e.lng }, emoji: d.sport.emoji }]}
            height={typeof window !== 'undefined' && window.innerWidth >= 1024 ? 260 : 170}
          />

          <ErrorBox>{err}</ErrorBox>

          {/* refund owed to me after cancelling */}
          {d.my_status === 'left' && d.my_refund && (
            <Card className="text-sm">
              {d.my_refund.done ? (
                <>✓ המארגן סימן שהחזיר לך ₪{money(d.my_refund.amount)}</>
              ) : (
                <>
                  ביטלת את ההשתתפות{d.my_refund.late && ' (ביטול מאוחר)'}. המארגן צריך להחזיר לך <b>₪{money(d.my_refund.amount)}</b> ב-Bit.
                </>
              )}
            </Card>
          )}

          {/* main action */}
          {e.status !== 'cancelled' && !past && (
            <div className="space-y-2">
              {iAmIn ? (
                <div className="rounded-full bg-ok p-3 text-center font-semibold text-white shadow-md">
                  {d.is_organizer ? 'אתה המארגן של האירוע' : 'אתה רשום לאירוע ✓'}
                </div>
              ) : onWaitlist ? (
                <div className="rounded-2xl bg-white p-3 text-center shadow-md">
                  <div className="font-display text-xl text-brand">אתה במקום #{d.my_waitlist_position} ברשימת ההמתנה</div>
                  <div className="text-xs text-ink-soft">כשמתפנה מקום תיכנס אוטומטית ותקבל התראה{price > 0 && ' – ואז תשלם'}</div>
                </div>
              ) : spots > 0 ? (
                <Button variant="hero" className="w-full py-3.5 text-lg" onClick={join} loading={busy}>
                  {session ? 'אני בפנים! 🙌' : 'התחברות והצטרפות'}
                </Button>
              ) : (
                <div className="space-y-1">
                  <Button variant="hero" className="w-full py-3.5 text-lg" onClick={joinWaitlist} loading={busy}>
                    האירוע מלא – הצטרפות לרשימת ההמתנה
                  </Button>
                  <p className="text-center text-xs text-white/85">בלי תשלום. כשמתפנה מקום תיכנס אוטומטית ותקבל התראה</p>
                </div>
              )}

              {iAmIn && !d.is_organizer && price > 0 && e.bit_link && (
                d.my_paid ? (
                  <div className="text-center text-sm font-medium text-white">שילמת ✓</div>
                ) : (
                  <a href={e.bit_link} target="_blank" rel="noreferrer" onClick={() => track('bit_click', { event_id: e.id })}>
                    <Button variant="dark" className="w-full">
                      תשלום ₪{money(price)} ב-Bit
                    </Button>
                  </a>
                )
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

              {/* cancellation */}
              {(iAmIn && !d.is_organizer) || onWaitlist ? (
                confirmLeave ? (
                  <Card className="animate-pop space-y-2 text-sm">
                    <div className="font-semibold">{onWaitlist ? 'לצאת מרשימת ההמתנה?' : 'לבטל את ההשתתפות?'}</div>
                    {!onWaitlist &&
                      (cancel.late ? (
                        <div className="rounded-xl bg-brand-light p-2 text-brand-dark">
                          ⚠️ ביטול פחות מ-24 שעות לפני המשחק:
                          {cancel.refund > 0 ? ` תקבל בחזרה רק ₪${money(cancel.refund)} (50%),` : ''} והדירוג שלך יירד.
                        </div>
                      ) : (
                        <div className="rounded-xl bg-mint p-2">
                          {cancel.refund > 0 ? `ביטול חינם – המארגן יחזיר לך ₪${money(cancel.refund)}.` : 'ביטול חינם.'}
                          {cancel.promotedRecently && ' (נכנסת מרשימת ההמתנה, אז אין קנס)'}
                        </div>
                      ))}
                    <div className="flex gap-2">
                      <Button variant="danger" className="flex-1" onClick={leave} loading={busy}>
                        {onWaitlist ? 'כן, לצאת' : 'כן, לבטל'}
                      </Button>
                      <Button variant="secondary" className="flex-1" onClick={() => setConfirmLeave(false)}>
                        חזרה
                      </Button>
                    </div>
                  </Card>
                ) : !onWaitlist && cancel.locked ? (
                  <p className="text-center text-xs text-white/85">
                    אי אפשר לבטל ב-3 השעות האחרונות לפני המשחק. אם לא תגיע, המארגן יסמן אי-הגעה.
                  </p>
                ) : (
                  <Button variant="onDark" className="w-full text-sm" onClick={() => setConfirmLeave(true)}>
                    {onWaitlist ? 'יציאה מרשימת ההמתנה' : 'ביטול השתתפות'}
                  </Button>
                )
              ) : null}

              {!d.is_organizer && !onWaitlist && (
                <p className="text-center text-[11px] leading-relaxed text-white/75">
                  מדיניות ביטול: חינם עד 24 שעות לפני המשחק · פחות מ-24 שעות: החזר של 50% וירידה בדירוג · ב-3 השעות האחרונות אין ביטול
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* participants */}
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold">משתתפים</div>
              {hasTeams && <span className="text-xs text-ink-soft">מחולקים לקבוצות ⚖️</span>}
            </div>
            <ParticipantList d={d} busy={busy} act={act} />
            {d.waitlist.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1 text-sm font-semibold">רשימת המתנה ({d.waitlist.length})</div>
                <ol className="space-y-0.5 text-sm text-ink-soft">
                  {d.waitlist.map((w, i) => (
                    <li key={w.user_id}>
                      {i + 1}. {w.full_name || 'שחקן'}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>

          {/* refunds the organizer owes */}
          {d.is_organizer && d.refunds && d.refunds.length > 0 && (
            <Card className="space-y-2">
              <div className="font-semibold">החזרים כספיים</div>
              <div className="text-xs text-ink-soft">מי שביטל אחרי ששילם. מחזירים ב-Bit ומסמנים כאן</div>
              {d.refunds.map((r) => (
                <div key={r.user_id} className="flex items-center gap-2 border-t border-line pt-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{r.full_name}</span> · ₪{money(r.amount)}
                    {r.late && <span className="mr-1 text-xs text-brand">(ביטול מאוחר – 50%)</span>}
                  </div>
                  {r.phone && (
                    <a href={`https://wa.me/${waNumber(r.phone)}`} target="_blank" rel="noreferrer" className="text-lg" aria-label="וואטסאפ">
                      💬
                    </a>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => act(() => supabase.rpc('set_refunded', { p_event: e.id, p_user: r.user_id, p_done: !r.done }))}
                    className={`rounded-lg px-2 py-1 text-xs ${r.done ? 'bg-ok/15 text-ok' : 'bg-mint text-ink-soft'}`}
                  >
                    {r.done ? 'הוחזר ✓' : 'סמן שהוחזר'}
                  </button>
                </div>
              ))}
            </Card>
          )}

          {/* organizer tools */}
          {d.is_organizer && e.status !== 'cancelled' && (
            <Card className="space-y-3">
              <div className="font-semibold">כלי מארגן</div>
              {!past && (
                <Link to={`/events/${e.id}/edit`} className="block">
                  <Button variant="secondary" className="w-full border-ink/20">
                    ✏️ עריכת האירוע
                  </Button>
                </Link>
              )}
              {d.sport.team_count >= 2 && taken >= 2 && (
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
                    if (window.confirm('לבטל את האירוע? כל המשתתפים יקבלו הודעה, ומי ששילם יסומן להחזר מלא')) {
                      void act(() => supabase.rpc('cancel_event', { p_event: e.id }), 'cancel_event')
                    }
                  }}
                >
                  ביטול האירוע
                </Button>
              )}
            </Card>
          )}

          {/* ratings after the game */}
          {past && iAmIn && joined.length > 1 && e.status !== 'cancelled' && <RatingForm d={d} onDone={load} />}
        </div>
      </div>

      <div className="pb-2 text-center">
        <Link to="/" className="text-sm text-white/85 underline">
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
              {p.promoted && <span className="mr-1 text-xs text-ink-soft">(מרשימת ההמתנה)</span>}
              {p.status === 'no_show' && <span className="mr-1 text-xs text-red-700">(לא הגיע)</span>}
            </div>
            <div className="text-xs text-ink-soft">
              <LevelDots level={Number(p.level)} /> רמה {Number(p.level).toFixed(1)} · ⭐ {(1 + Number(p.reputation) * 4).toFixed(1)}
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
      {d.event.guest_count > 0 && (
        <div className="flex items-center gap-2 py-2 text-sm text-ink-soft">
          <span className="rounded-md bg-mint px-1.5 py-0.5 text-[11px] font-semibold" dir="ltr">
            +{d.event.guest_count}
          </span>
          חברים של המארגן (לא רשומים באפליקציה)
        </div>
      )}
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
        {improvement > 0 && (
          <>
            {' '}
            · <b className="text-brand-dark">{improvement}% יותר מאוזן</b>
          </>
        )}
        <br />
        שיטה: {r.method === 'exact' ? 'חיפוש מלא (אופטימלי)' : 'חמדני + שיפור בהחלפות'}
      </div>
      <Button className="w-full" onClick={onSave} loading={busy}>
        שמירה ושליחה למשתתפים
      </Button>
    </div>
  )
}

const SKILL_TEXT = ['', 'רמה 1 – מתחיל', 'רמה 2 – חובב', 'רמה 3 – משחק קבוע', 'רמה 4 – שחקן חזק', 'רמה 5 – מקצועני']
const SPORT_TEXT = ['', 'לא הוגן', 'יש מה לשפר', 'בסדר', 'שחקן קבוצתי', 'מצוין, תענוג לשחק איתו']

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} כוכבים`}
          className={`text-[28px] leading-none transition active:scale-90 ${n <= value ? 'text-amber-400 drop-shadow-sm' : 'text-black/15'}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

/** Post-game rating: skill (1..5 – same scale as levels) and sportsmanship (1..5) per player */
function RatingForm({ d, onDone }: { d: EventDetails; onDone: () => Promise<void> }) {
  const { session } = useAuth()
  const others = d.participants.filter((p) => p.user_id !== session?.user.id && p.status !== 'no_show')
  const [vals, setVals] = useState<Record<string, { skill?: number; sportsmanship?: number }>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  if (d.my_ratings_done >= others.length && others.length > 0) {
    return (
      <Card className="text-center">
        <div className="text-3xl">🙏</div>
        <div className="font-display text-lg text-brand">תודה על הדירוג!</div>
        <div className="text-sm text-ink-soft">הדירוגים מעדכנים את הרמה והאמינות של השחקנים ומשפרים את ההתאמות של כולם</div>
      </Card>
    )
  }

  async function submit() {
    const ratings = Object.entries(vals)
      .filter(([, v]) => v.skill || v.sportsmanship)
      .map(([user_id, v]) => ({ user_id, skill: v.skill ?? 3, sportsmanship: v.sportsmanship ?? 4 }))
    if (!ratings.length) return setMsg('בחר/י כוכבים לפחות לשחקן אחד')
    setBusy(true)
    const { error } = await supabase.rpc('submit_ratings', { p_event: d.event.id, p_ratings: ratings })
    setBusy(false)
    if (error) return setMsg(errorText(error))
    track('ratings_submitted', { n: ratings.length })
    await onDone()
  }

  const rated = Object.values(vals).filter((v) => v.skill || v.sportsmanship).length

  return (
    <Card className="space-y-3">
      <div className="text-center">
        <div className="font-display text-2xl text-brand">איך היה המשחק?</div>
        <div className="text-sm text-ink-soft">דרג/י את השחקנים. הדירוג אנונימי, ואפשר לדלג על מי שלא זוכרים</div>
      </div>
      {others.map((p) => {
        const v = vals[p.user_id] ?? {}
        const set = (field: 'skill' | 'sportsmanship', n: number) =>
          setVals((prev) => ({ ...prev, [p.user_id]: { ...prev[p.user_id], [field]: n } }))
        return (
          <div key={p.user_id} className="rounded-2xl bg-mint p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand font-display text-white">
                {(p.full_name || '?').trim().charAt(0)}
              </span>
              <div>
                <div className="text-sm font-semibold">{p.full_name}</div>
                <div className="text-[11px] text-ink-soft">רמה נוכחית {levelLabel(Number(p.level))}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <span className="text-xs text-ink-soft">רמת משחק</span>
              <Stars value={v.skill ?? 0} onChange={(n) => set('skill', n)} />
            </div>
            <div className="mb-1 h-4 text-left text-[11px] text-brand-dark">{v.skill ? SKILL_TEXT[v.skill] : ''}</div>
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <span className="text-xs text-ink-soft">ספורטיביות</span>
              <Stars value={v.sportsmanship ?? 0} onChange={(n) => set('sportsmanship', n)} />
            </div>
            <div className="h-4 text-left text-[11px] text-brand-dark">{v.sportsmanship ? SPORT_TEXT[v.sportsmanship] : ''}</div>
          </div>
        )
      })}
      {msg && <div className="text-sm text-red-700">{msg}</div>}
      <Button className="w-full" onClick={submit} loading={busy}>
        שליחת הדירוג{rated > 0 ? ` (${rated} שחקנים)` : ''}
      </Button>
    </Card>
  )
}
