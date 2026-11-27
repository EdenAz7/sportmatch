import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { errorText, supabase } from '../lib/supabase'
import { formatShortDate } from '../lib/format'
import { FEATURE_LABELS } from '../engine/explain'
import { Button, Card, ErrorBox, PageLoader } from '../components/ui'

interface Stats {
  users_total: number
  users_onboarded: number
  active_7d: number
  active_30d: number
  events_total: number
  events_upcoming: number
  events_cancelled: number
  past_events: number
  fill_rate: number | null
  avg_occupancy: number | null
  avg_hours_to_fill: number | null
  joins_total: number
  joins_from_recommendation: number
  impressions: number
  impressions_joined: number
  ratings_total: number
  teams_balanced: number
  avg_team_imbalance: number | null
  avg_team_imbalance_random: number | null
  retention_30d: number | null
  page_views_7d: number
  weekly: { week: string; signups: number; events: number; joins: number }[]
  by_sport: { name_he: string; emoji: string; events: number }[]
}

interface WeightsRow {
  id: number
  bias: number
  w_sport: number
  w_level: number
  w_distance: number
  w_time: number
  w_rating: number
  w_history: number
  method: string
  training_size: number | null
  positives: number | null
  log_loss: number | null
  baseline_log_loss: number | null
  auc: number | null
  baseline_auc: number | null
  accuracy: number | null
  note: string | null
  created_at: string
  active: boolean
}

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`)

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-3">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-[11px] text-ink-soft">{sub}</div>}
    </div>
  )
}

export default function Admin() {
  const { profile } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [weights, setWeights] = useState<WeightsRow[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const isAdmin = profile?.role === 'admin'

  const load = useCallback(async () => {
    const [{ data, error }, { data: w }] = await Promise.all([
      supabase.rpc('admin_stats'),
      supabase.from('match_weights').select('*').order('id', { ascending: false }),
    ])
    if (error) setErr(errorText(error))
    setStats(data as Stats)
    setWeights((w as WeightsRow[]) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function calibrate() {
    setBusy(true)
    setErr('')
    const { error } = await supabase.rpc('calibrate_weights', {})
    setBusy(false)
    if (error) return setErr(errorText(error))
    await load()
  }

  async function rollback(w: WeightsRow) {
    setBusy(true)
    const { error } = await supabase.rpc('set_manual_weights', {
      p_bias: w.bias, p_sport: w.w_sport, p_level: w.w_level, p_distance: w.w_distance,
      p_time: w.w_time, p_rating: w.w_rating, p_history: w.w_history, p_note: `שחזור לגרסה #${w.id}`,
    })
    setBusy(false)
    if (error) return setErr(errorText(error))
    await load()
  }

  if (!stats && !err) return <PageLoader />
  const maxWeekly = Math.max(1, ...(stats?.weekly ?? []).map((w) => Math.max(w.signups, w.events, w.joins)))
  const active = weights.find((w) => w.active)
  const recConversion = stats && stats.impressions > 0 ? stats.impressions_joined / stats.impressions : null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">לוח ניהול</h1>
        <p className="text-sm text-ink-soft">{isAdmin ? 'מנהל מערכת' : 'מבקר מערכת – צפייה בלבד'}</p>
      </div>
      <ErrorBox>{err}</ErrorBox>

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="משתמשים רשומים" value={stats.users_total} sub={`${stats.users_onboarded} השלימו פרופיל`} />
            <Kpi label="פעילים ב-7 ימים" value={stats.active_7d} sub={`${stats.active_30d} ב-30 ימים`} />
            <Kpi label="אירועים שנוצרו" value={stats.events_total} sub={`${stats.events_upcoming} קרובים · ${stats.events_cancelled} בוטלו`} />
            <Kpi label="אחוז אירועים שהתמלאו" value={pct(stats.fill_rate)} sub={`תפוסה ממוצעת ${pct(stats.avg_occupancy)}`} />
            <Kpi label="הצטרפויות" value={stats.joins_total} sub={`${stats.joins_from_recommendation} דרך המלצה`} />
            <Kpi label="המרת המלצות" value={pct(recConversion)} sub={`${stats.impressions_joined} מתוך ${stats.impressions} שהוצגו`} />
            <Kpi label="זמן ממוצע עד מילוי" value={stats.avg_hours_to_fill != null ? `${stats.avg_hours_to_fill} ש'` : '—'} />
            <Kpi label="חזרו להשתתף תוך 30 יום" value={pct(stats.retention_30d)} />
            <Kpi
              label="פער בין קבוצות"
              value={stats.avg_team_imbalance ?? '—'}
              sub={stats.avg_team_imbalance_random != null ? `אקראי: ${stats.avg_team_imbalance_random} · ${stats.teams_balanced} חלוקות` : undefined}
            />
            <Kpi label="צפיות בדפים (7 ימים)" value={stats.page_views_7d} sub={`${stats.ratings_total} דירוגים`} />
          </div>

          <Card>
            <div className="mb-2 font-semibold">פעילות שבועית</div>
            <div className="flex h-32 items-end gap-1.5" dir="ltr">
              {stats.weekly.map((w) => (
                <div key={w.week} className="flex flex-1 flex-col items-center gap-0.5">
                  <div className="flex h-24 w-full items-end gap-px">
                    <div className="flex-1 rounded-t bg-ink" style={{ height: `${(w.signups / maxWeekly) * 100}%` }} title={`הרשמות ${w.signups}`} />
                    <div className="flex-1 rounded-t bg-brand" style={{ height: `${(w.events / maxWeekly) * 100}%` }} title={`אירועים ${w.events}`} />
                    <div className="flex-1 rounded-t bg-accent" style={{ height: `${(w.joins / maxWeekly) * 100}%` }} title={`הצטרפויות ${w.joins}`} />
                  </div>
                  <span className="text-[9px] text-ink-soft">{w.week}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-center gap-3 text-[11px] text-ink-soft">
              <span>⬛ הרשמות</span>
              <span className="text-brand">■ אירועים</span>
              <span className="text-accent">■ הצטרפויות</span>
            </div>
          </Card>

          <Card>
            <div className="mb-2 font-semibold">אירועים לפי ענף</div>
            {stats.by_sport.map((s) => (
              <div key={s.name_he} className="flex items-center gap-2 py-0.5 text-sm">
                <span className="w-28 truncate">
                  {s.emoji} {s.name_he}
                </span>
                <div className="h-2 flex-1 rounded-full bg-mint">
                  <div
                    className="h-2 rounded-full bg-brand"
                    style={{ width: `${(s.events / Math.max(1, stats.events_total)) * 100}%` }}
                  />
                </div>
                <span className="w-6 text-left text-xs">{s.events}</span>
              </div>
            ))}
          </Card>
        </>
      )}

      <Card className="space-y-3">
        <div>
          <div className="font-semibold">מנוע ההתאמה – משקלים</div>
          <div className="text-xs text-ink-soft">
            כיול = רגרסיה לוגיסטית על כל ההמלצות שהוצגו: מי הצטרף ומי לא. המשקלים החדשים נכנסים לתוקף מיד.
          </div>
        </div>
        {active && (
          <div className="grid grid-cols-3 gap-2 text-center">
            {(['w_sport', 'w_level', 'w_distance', 'w_time', 'w_rating', 'w_history'] as const).map((k) => (
              <div key={k} className="rounded-xl bg-mint p-2">
                <div className="text-[11px] text-ink-soft">{FEATURE_LABELS[('f_' + k.slice(2)) as keyof typeof FEATURE_LABELS]}</div>
                <div className="font-bold">{active[k].toFixed(2)}</div>
              </div>
            ))}
          </div>
        )}
        {isAdmin && (
          <Button className="w-full" onClick={calibrate} loading={busy}>
            🧠 כיול משקלים מהנתונים
          </Button>
        )}
        <div className="space-y-2">
          {weights.map((w) => (
            <div key={w.id} className={`rounded-xl border p-2 text-xs ${w.active ? 'border-brand bg-brand-light/40' : 'border-line'}`}>
              <div className="flex justify-between">
                <span className="font-semibold">
                  #{w.id} · {w.method === 'calibrated' ? 'מכויל' : 'ידני'} {w.active && '· פעיל'}
                </span>
                <span className="text-ink-soft">{formatShortDate(w.created_at)}</span>
              </div>
              <div className="text-ink-soft" dir="ltr">
                b={w.bias.toFixed(2)} · S={w.w_sport.toFixed(2)} L={w.w_level.toFixed(2)} D={w.w_distance.toFixed(2)} T=
                {w.w_time.toFixed(2)} R={w.w_rating.toFixed(2)} H={w.w_history.toFixed(2)}
              </div>
              {w.method === 'calibrated' && (
                <div>
                  {w.note} · Log-loss {w.baseline_log_loss?.toFixed(3)} → <b>{w.log_loss?.toFixed(3)}</b> · AUC{' '}
                  {w.baseline_auc?.toFixed(3)} → <b>{w.auc?.toFixed(3)}</b> · דיוק {pct(w.accuracy)}
                </div>
              )}
              {isAdmin && !w.active && (
                <button className="mt-1 text-brand-dark underline" onClick={() => rollback(w)} disabled={busy}>
                  החזרה לגרסה זו
                </button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
