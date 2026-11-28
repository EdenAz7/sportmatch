// SportMatch service worker: network-first for the app shell, never caches API calls.
const CACHE = 'sportmatch-v2'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy))
        return res
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./'))),
  )
})

// Push notifications from the server (see supabase/functions/send-push)
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'SportMatch'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      dir: 'rtl',
      lang: 'he',
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url: data.url || './' },
    }),
  )
})

// Tapping the notification opens (or focuses) the app on the right screen
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || './'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate ? c.navigate(url).catch(() => {}) : null
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
