import { useState, type FormEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { errorText, supabase } from '../lib/supabase'
import { track } from '../lib/analytics'
import { Button, ErrorBox, Logo } from '../components/ui'

function PillInput({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center rounded-full border-[2.5px] border-ink bg-white/95 shadow-sm">
      <span className="flex w-14 shrink-0 justify-center text-ink">{icon}</span>
      <span className="h-7 w-[2.5px] shrink-0 bg-ink" />
      {children}
    </div>
  )
}

const pill = 'w-full bg-transparent px-4 py-3 outline-none placeholder:text-ink-soft/70'

const icons = {
  user: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  mail: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6 8.5 7 8.5-7" />
    </svg>
  ),
  lock: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  ),
}

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
    <div className="app-bg min-h-screen">
      <div className="mx-auto max-w-sm px-7 pt-10 pb-10">
        <div className="mb-5 flex justify-center">
          <Logo size={150} />
        </div>
        <h1 className="mb-1 text-center font-display text-5xl text-brand">{mode === 'signup' ? 'הרשמה' : 'התחברות'}</h1>
        <p className="mb-8 text-center text-sm text-ink-soft">מוצאים משחק ברמה שלך, קרוב אליך, תוך דקות</p>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && (
            <PillInput icon={icons.user}>
              <input className={pill} placeholder="שם מלא" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </PillInput>
          )}
          <PillInput icon={icons.mail}>
            <input
              className={pill}
              type="email"
              dir="ltr"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </PillInput>
          <PillInput icon={icons.lock}>
            <input
              className={pill}
              type="password"
              dir="ltr"
              placeholder={mode === 'signup' ? 'Password (6+)' : 'Password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={6}
              required
            />
          </PillInput>

          <p className="pt-2 text-center text-sm font-medium text-white">
            {mode === 'signup' ? 'כבר יש לך חשבון? ' : 'אין לך חשבון? '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signup' ? 'signin' : 'signup')
                setErr('')
              }}
              className="font-semibold text-[#c9a9ff] underline-offset-2 hover:underline"
            >
              {mode === 'signup' ? 'התחברות' : 'הרשמה'}
            </button>
          </p>

          <ErrorBox>{err}</ErrorBox>

          <div className="flex justify-center pt-2">
            <Button type="submit" variant="hero" className="w-56 py-3.5 text-lg tracking-wide" loading={busy}>
              {mode === 'signup' ? 'יאללה, נרשמים' : 'כניסה'}
            </Button>
          </div>
          <p className="pt-3 text-center text-xs text-white/80">
            {mode === 'signup' ? 'בהרשמה הראשונה נבקש טלפון ואזור כדי להתאים לך משחקים' : 'פרויקט סטודנטים · ניתוח ותכנון מערכות מידע'}
          </p>
        </form>
      </div>
    </div>
  )
}
