import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { errorText, supabase } from '../lib/supabase'
import { track } from '../lib/analytics'
import { Button, ErrorBox, Field, inputClass } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const next = new URLSearchParams(location.search).get('next') || '/'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (mode === 'signup') {
        if (name.trim().length < 2) throw new Error('נא להזין שם מלא')
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        })
        if (error) throw error
        track('sign_up')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
        track('login')
      }
      navigate(next, { replace: true })
    } catch (e2) {
      setErr(errorText(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="mx-auto max-w-md px-6 pt-14 pb-10">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-4xl shadow-lg">⚽</div>
          <h1 className="text-3xl font-bold" dir="ltr">
            Sport<span className="text-brand">Match</span>
          </h1>
          <p className="mt-2 text-white/75">מוצאים משחק ברמה שלך, קרוב אליך, תוך דקות</p>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-2 text-center text-xs text-white/80">
          <div className="rounded-xl bg-white/5 p-3">
            <div className="text-xl">🎯</div>התאמה חכמה
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <div className="text-xl">⚖️</div>קבוצות מאוזנות
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <div className="text-xl">⭐</div>דירוג שחקנים
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-5 text-ink shadow-xl">
          <div className="mb-2 grid grid-cols-2 rounded-xl bg-mint p-1 text-sm">
            {(['signup', 'signin'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-lg py-2 font-medium ${mode === m ? 'bg-white shadow-sm' : 'text-ink-soft'}`}
              >
                {m === 'signup' ? 'הרשמה' : 'התחברות'}
              </button>
            ))}
          </div>
          {mode === 'signup' && (
            <Field label="שם מלא">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
          )}
          <Field label="אימייל">
            <input
              className={inputClass}
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </Field>
          <Field label="סיסמה" hint={mode === 'signup' ? 'לפחות 6 תווים' : undefined}>
            <input
              className={inputClass}
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={6}
              required
            />
          </Field>
          <ErrorBox>{err}</ErrorBox>
          <Button type="submit" className="w-full" loading={busy}>
            {mode === 'signup' ? 'יאללה, נרשמים' : 'כניסה'}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-white/50">פרויקט סטודנטים · ניתוח ותכנון מערכות מידע</p>
      </div>
    </div>
  )
}
