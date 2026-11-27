import { supabase } from './supabase'

/**
 * Usage analytics:
 *  1. Google Analytics 4 – enabled when VITE_GA_ID is set (e.g. G-XXXXXXX)
 *  2. Internal app_events table – always on, feeds the admin dashboard
 */
// Google Analytics 4 property "SportMatch" (web stream SportMatch Web)
const GA_ID = (import.meta.env.VITE_GA_ID as string | undefined) ?? 'G-ZFHC0GV5K2'

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

export function initAnalytics() {
  if (!GA_ID || window.gtag) return
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(s)
  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', GA_ID, { send_page_view: false })
}

let currentUserId: string | null = null
export function setAnalyticsUser(id: string | null) {
  currentUserId = id
  if (GA_ID && window.gtag && id) window.gtag('config', GA_ID, { user_id: id, send_page_view: false })
}

export function track(name: string, props: Record<string, unknown> = {}) {
  if (GA_ID && window.gtag) window.gtag('event', name, props)
  void supabase
    .from('app_events')
    .insert({ name, props, user_id: currentUserId })
    .then(() => undefined)
}

/** Human-readable screen name, so GA reports show "דף אירוע" instead of "SportMatch" for every view */
export function screenName(path: string): string {
  if (path === '/' || path === '') return 'בית – המלצות'
  if (/^\/events\/new/.test(path)) return 'יצירת אירוע'
  if (/^\/events\/[^/]+\/edit/.test(path)) return 'עריכת אירוע'
  if (/^\/events\/[^/]+/.test(path)) return 'דף אירוע'
  const map: Record<string, string> = {
    '/login': 'התחברות',
    '/welcome': 'הרשמה – פרופיל',
    '/my': 'האירועים שלי',
    '/notifications': 'התראות',
    '/profile': 'הפרופיל שלי',
    '/facilities': 'מתקנים',
    '/admin': 'לוח ניהול',
    '/about': 'אודות',
  }
  return map[path] ?? path
}

/** The app uses hash routing, so report a clean virtual URL per screen, e.g. /sportmatch/events/123 */
export function trackPage(path: string) {
  const title = `${screenName(path)} · SportMatch`
  document.title = title
  if (GA_ID && window.gtag) {
    const virtual = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`
    window.gtag('event', 'page_view', { page_location: virtual, page_path: path, page_title: title })
  }
  void supabase
    .from('app_events')
    .insert({ name: 'page_view', props: { path }, user_id: currentUserId })
    .then(() => undefined)
}
