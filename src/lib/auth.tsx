import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile, Sport, UserSport } from './types'
import { setAnalyticsUser } from './analytics'

interface AuthState {
  session: Session | null
  profile: Profile | null
  mySports: UserSport[]
  sports: Sport[]
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [mySports, setMySports] = useState<UserSport[]>([])
  const [sports, setSports] = useState<Sport[]>([])
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null)
      setMySports([])
      setAnalyticsUser(null)
      return
    }
    const [{ data: p }, { data: us }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.from('user_sports').select('*').eq('user_id', s.user.id),
    ])
    setProfile((p as Profile) ?? null)
    setMySports((us as UserSport[]) ?? [])
    setAnalyticsUser(s.user.id)
    void supabase.rpc('touch')
  }, [])

  useEffect(() => {
    let mounted = true
    supabase
      .from('sports')
      .select('*')
      .order('id')
      .then(({ data }) => mounted && setSports((data as Sport[]) ?? []))
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      await loadProfile(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // defer DB calls out of the auth callback
      setTimeout(() => void loadProfile(s), 0)
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const refresh = useCallback(() => loadProfile(session), [loadProfile, session])
  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider value={{ session, profile, mySports, sports, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSport(id: number | undefined): Sport | undefined {
  const { sports } = useAuth()
  return sports.find((s) => s.id === id)
}
