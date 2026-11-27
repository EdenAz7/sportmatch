import { supabase } from './supabase'

/**
 * Usage analytics:
 *  1. Google Analytics 4 – enabled when VITE_GA_ID is set (e.g. G-XXXXXXX)
 *  2. Internal app_events table – always on, feeds the admin dashboard
 */
const GA_ID = import.meta.env.VITE_GA_ID as string | undefined

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

export function trackPage(path: string) {
  if (GA_ID && window.gtag) {
    window.gtag('event', 'page_view', { page_path: path, page_location: window.location.href })
  }
  void supabase
    .from('app_events')
    .insert({ name: 'page_view', props: { path }, user_id: currentUserId })
    .then(() => undefined)
}
