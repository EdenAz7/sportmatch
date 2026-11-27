import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { trackPage } from '../lib/analytics'

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
  { to: '/', label: 'בית', icon: '🏠', end: true },
  { to: '/events/new', label: 'יצירה', icon: '➕' },
  { to: '/my', label: 'האירועים שלי', icon: '📅' },
  { to: '/profile', label: 'פרופיל', icon: '👤' },
]

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
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-mint">
      <header className="sticky top-0 z-20 bg-ink text-white shadow">
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-lg">⚽</span>
            <span className="text-lg font-bold tracking-tight" dir="ltr">
              Sport<span className="text-brand">Match</span>
            </span>
          </Link>
          <div className="flex items-center gap-1">
            {isStaff && (
              <Link to="/admin" className="rounded-lg px-2 py-1 text-sm text-white/80 hover:bg-white/10">
                📊 ניהול
              </Link>
            )}
            <Link to="/facilities" className="rounded-lg px-2 py-1 text-sm text-white/80 hover:bg-white/10">
              🏟️
            </Link>
            {session && (
              <Link to="/notifications" className="relative rounded-lg px-2 py-1 text-lg hover:bg-white/10" aria-label="התראות">
                🔔
                {unread > 0 && (
                  <span className="absolute -top-0.5 -left-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-24">{children}</main>

      {session && (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-line bg-white">
          <div className="grid grid-cols-4">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'font-semibold text-brand' : 'text-ink-soft'}`
                }
              >
                <span className="text-xl leading-none">{t.icon}</span>
                {t.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}
