import { createClient } from '@supabase/supabase-js'

// Public (publishable) values – safe to ship in the browser. Data is protected by RLS.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://emzovncbgklcfggxtkbw.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_PfEYtoHltLFd9c3cNLCeBw_q71JcuSV'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

/** Turn a Supabase/Postgres error into a readable Hebrew message */
export function errorText(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err)
  if (/Invalid login credentials/i.test(msg)) return 'אימייל או סיסמה שגויים'
  if (/User already registered/i.test(msg)) return 'המשתמש כבר רשום – נסה להתחבר'
  if (/Password should be at least/i.test(msg)) return 'הסיסמה צריכה להכיל לפחות 6 תווים'
  if (/Unable to validate email|invalid format/i.test(msg)) return 'כתובת האימייל לא תקינה'
  if (/rate limit/i.test(msg)) return 'יותר מדי ניסיונות, נסה שוב בעוד כמה דקות'
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'אין חיבור לשרת. בדוק את החיבור לאינטרנט'
  return msg
}
