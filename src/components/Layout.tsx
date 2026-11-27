import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { trackPage } from '../lib/analytics'
import { Logo, NavIcon } from './ui'

function useUnreadCount() {
  const { session } = useAuth()
  const location = useLocation()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!session) return
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('read', false)
      .then(({ count: c }) => setCount(c ?? 0))
  }, [session, location.pathname])
  return count
}

const tabs = [
  { to: '/', label: 'בית', icon: 'home', end: true },
  { to: '/events/new', label: 'יצירה', icon: 'create' },
  { to: '/my', label: 'האירועים שלי', icon: 'events' },
  { to: '/profile', label: 'פרופיל', icon: 'profile' },
] as const

export default function Layout({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const location = useLocation()
  const unread = useUnreadCount()

  useEffect(() => {
    trackPage(location.pathname)
    window.scrollTo(0, 0)
  }, [location.pathname])

  const isStaff = profile?.role === 'admin' || profile?.role === 'auditor'

  return (
    <div className="app-bg mx-auto flex min-h-screen max-w-lg flex-col lg:max-w-none">
      <header className="sticky top-0 z-20 bg-[#e6e6e6]/90 backdrop-blur lg:shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-2.5 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo size={46} />
            <span className="font-display text-xl text-brand" dir="ltr">
              SportMatch
            </span>
          </Link>
          {session && (
            <nav className="hidden flex-1 items-center gap-1 lg:flex">
              {tabs.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={'end' in t ? t.end : false}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                      isActive ? 'bg-brand font-semibold text-white shadow' : 'text-ink hover:bg-black/5'
                    }`
                  }
                >
                  <NavIcon name={t.icon} />
                  {t.label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="flex items-center gap-1 text-ink">
            {isStaff && (
              <Link to="/admin" className="rounded-full px-2.5 py-1 text-sm font-medium hover:bg-black/5">
                📊 ניהול
              </Link>
            )}
            <Link to="/facilities" className="rounded-full px-2 py-1 text-lg hover:bg-black/5" aria-label="מתקנים">
              🏟️
            </Link>
            {session && (
              <Link to="/notifications" className="relative rounded-full px-2 py-1 text-lg hover:bg-black/5" aria-label="התראות">
                🔔
                {unread > 0 && (
                  <span className="absolute -top-0.5 -left-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-3 pb-28 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>

      {session && (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-[#1d1d1d] shadow-[0_-4px_16px_rgba(0,0,0,0.25)] lg:hidden">
          <div className="grid grid-cols-4">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={'end' in t ? t.end : false}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] ${isActive ? 'font-semibold text-accent' : 'text-white/80'}`
                }
              >
                <NavIcon name={t.icon} />
                {t.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}
