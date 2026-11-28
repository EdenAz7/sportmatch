import { useEffect, useState } from 'react'
import { errorText } from '../lib/supabase'
import { disablePush, enablePush, getPushState, sendTestPush, type PushState } from '../lib/push'
import { Button, Card } from './ui'

/** Turn phone notifications on/off for this device, with a test button. */
export default function PushCard({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getPushState().then(setState).catch(() => setState('unsupported'))
  }, [])

  async function run(fn: () => Promise<PushState | void>, done?: string) {
    setBusy(true)
    setMsg('')
    try {
      const next = await fn()
      if (next) setState(next)
      if (done) setMsg(done)
    } catch (e) {
      setMsg(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">📲 התראות לטלפון</div>
        {state === 'on' && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-semibold text-ok">פעיל</span>}
      </div>

      {state === 'off' && (
        <>
          {!compact && (
            <p className="text-sm text-ink-soft">
              קבלו הודעה בטלפון גם כשהאפליקציה סגורה: כשמתפנה לכם מקום, כשמשחק מתבטל, תזכורת לפני משחק ועוד.
            </p>
          )}
          <Button className="w-full" loading={busy} onClick={() => run(enablePush)}>
            הפעלת התראות לטלפון
          </Button>
        </>
      )}

      {state === 'on' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy} onClick={() => run(sendTestPush, 'נשלחה התראת בדיקה. היא אמורה להגיע תוך כמה שניות.')}>
            שליחת התראת בדיקה
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => run(disablePush)}>
            כיבוי
          </Button>
        </div>
      )}

      {state === 'ios-install' && (
        <p className="text-sm text-ink-soft">
          באייפון התראות עובדות רק כשהאפליקציה מותקנת: לוחצים על כפתור השיתוף בספארי, בוחרים "הוספה למסך הבית", פותחים
          את SportMatch מהמסך הבית ומפעילים כאן.
        </p>
      )}
      {state === 'denied' && (
        <p className="text-sm text-ink-soft">
          ההתראות חסומות בדפדפן. כדי לאפשר: בהגדרות האתר בדפדפן ← התראות ← לאפשר, ואז לרענן את הדף.
        </p>
      )}
      {state === 'unsupported' && (
        <p className="text-sm text-ink-soft">הדפדפן הזה לא תומך בהתראות. אפשר לנסות ב-Chrome.</p>
      )}

      {msg && <p className="text-sm text-ink-soft">{msg}</p>}
    </Card>
  )
}
