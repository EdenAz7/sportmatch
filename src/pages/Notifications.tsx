import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/format'
import type { Notification } from '../lib/types'
import { Empty, PageLoader } from '../components/ui'
import PushCard from '../components/PushCard'

const ICONS: Record<string, string> = {
  joined: '🙋',
  left: '👋',
  full: '🎉',
  cancelled: '❌',
  teams: '⚖️',
  reminder: '⏰',
  rate: '⭐',
  promoted: '🎟️',
  updated: '✏️',
  facility_booked: '🏟️',
  facility_cancelled: '🏟️',
  facility_updated: '🏟️',
  test: '📲',
}

function linkFor(n: Notification): string {
  if (n.kind.startsWith('facility_')) return '/my-facilities'
  return n.event_id ? `/events/${n.event_id}` : '/notifications'
}

export default function Notifications() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(async ({ data }) => {
        const list = (data as Notification[]) ?? []
        setItems(list)
        setLoading(false)
        const unread = list.filter((n) => !n.read).map((n) => n.id)
        if (unread.length) await supabase.from('notifications').update({ read: true }).in('id', unread)
      })
  }, [])

  if (loading) return <PageLoader />
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="page-title">התראות</h1>
      <PushCard compact={items.length > 0} />
      {items.length === 0 ? (
        <Empty icon="🔔" title="אין התראות עדיין" />
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {items.map((n) => (
            <Link
              key={n.id}
              to={linkFor(n)}
              className={`flex gap-3 px-4 py-3 ${n.read ? '' : 'bg-brand-light/40'}`}
            >
              <span className="text-xl">{ICONS[n.kind] ?? '🔔'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{n.message}</div>
                <div className="text-xs text-ink-soft">{timeAgo(n.created_at)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
