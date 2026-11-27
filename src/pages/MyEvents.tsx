import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { SportEvent } from '../lib/types'
import EventCard from '../components/EventCard'
import { Button, Empty, PageLoader, Segmented } from '../components/ui'

interface Row {
  status: string
  events: SportEvent & { event_participants: { status: string }[] }
}

export default function MyEvents() {
  const { session, sports } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')

  useEffect(() => {
    if (!session) return
    supabase
      .from('event_participants')
      .select('status, events(*, event_participants(status))')
      .eq('user_id', session.user.id)
      .in('status', ['joined', 'attended', 'no_show'])
      .then(({ data }) => {
        setRows(((data as unknown as Row[]) ?? []).filter((r) => r.events))
        setLoading(false)
      })
  }, [session])

  const now = Date.now()
  const list = rows
    .filter((r) => (tab === 'upcoming' ? new Date(r.events.starts_at).getTime() >= now : new Date(r.events.starts_at).getTime() < now))
    .sort((a, b) =>
      tab === 'upcoming'
        ? a.events.starts_at.localeCompare(b.events.starts_at)
        : b.events.starts_at.localeCompare(a.events.starts_at),
    )

  return (
    <div className="space-y-4">
      <h1 className="page-title">האירועים שלי</h1>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          ['upcoming', 'קרובים'],
          ['past', 'עברו'],
        ] as const}
      />
      {loading ? (
        <PageLoader />
      ) : list.length === 0 ? (
        <Empty icon={tab === 'upcoming' ? '📅' : '🏁'} title={tab === 'upcoming' ? 'אין אירועים קרובים' : 'עוד לא השתתפת באירועים'}>
          {tab === 'upcoming' && (
            <div className="mt-4 flex justify-center gap-2">
              <Link to="/">
                <Button variant="secondary">חיפוש משחק</Button>
              </Link>
              <Link to="/events/new">
                <Button>יצירת אירוע</Button>
              </Link>
            </div>
          )}
        </Empty>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <EventCard
              key={r.events.id}
              event={r.events}
              sport={sports.find((s) => s.id === r.events.sport_id)}
              joinedCount={r.events.event_participants.filter((p) => p.status !== 'left').length}
              imIn
              badge={r.events.organizer_id === session?.user.id ? 'מארגן' : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
