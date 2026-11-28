import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import { PageLoader } from './components/ui'
import Login from './pages/Login'
import Home from './pages/Home'
import ProfilePage from './pages/ProfilePage'
import CreateEvent from './pages/CreateEvent'
import EventPage from './pages/EventPage'
import MyEvents from './pages/MyEvents'
import Notifications from './pages/Notifications'
import Facilities from './pages/Facilities'
import MyFacilities from './pages/MyFacilities'
import Admin from './pages/Admin'
import About from './pages/About'

/** Requires a session and a completed profile */
function Protected({ children, allowNotOnboarded = false }: { children: ReactNode; allowNotOnboarded?: boolean }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()
  if (loading || (session && !profile)) return <PageLoader />
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (!profile?.onboarded && !allowNotOnboarded) return <Navigate to="/welcome" replace />
  return <>{children}</>
}

function StaffOnly({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  if (profile?.role !== 'admin' && profile?.role !== 'auditor') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { session, loading } = useAuth()
  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <PageLoader /> : session ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/welcome"
        element={
          <Protected allowNotOnboarded>
            <Layout>
              <ProfilePage onboarding />
            </Layout>
          </Protected>
        }
      />
      {/* event pages are public so shared links work before signing up */}
      <Route
        path="/events/:id"
        element={
          <Layout>
            <EventPage />
          </Layout>
        }
      />
      <Route
        path="/about"
        element={
          <Layout>
            <About />
          </Layout>
        }
      />
      <Route
        path="/facilities"
        element={
          <Layout>
            <Facilities />
          </Layout>
        }
      />
      {(
        [
          ['/', <Home />],
          ['/events/new', <CreateEvent />],
          ['/events/:id/edit', <CreateEvent />],
          ['/my-facilities', <MyFacilities />],
          ['/my', <MyEvents />],
          ['/profile', <ProfilePage />],
          ['/notifications', <Notifications />],
          ['/admin', <StaffOnly><Admin /></StaffOnly>],
        ] as const
      ).map(([path, el]) => (
        <Route
          key={path}
          path={path}
          element={
            <Protected>
              <Layout>{el}</Layout>
            </Protected>
          }
        />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
