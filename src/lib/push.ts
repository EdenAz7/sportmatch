// Phone push notifications (Web Push).
// Flow: the user taps "enable" → the browser asks for permission → we subscribe this device with our
// public VAPID key → the subscription is saved in Supabase (push_subscriptions).
// From then on every in-app notification is also pushed by the database → Edge Function "send-push".
import { supabase } from './supabase'
import { track } from './analytics'

/** Public half of the VAPID key pair (safe to publish; the private half lives only on the server). */
export const VAPID_PUBLIC_KEY =
  'BIirg7W8OsG7MBFnblZHTX9_p_Cn-H6K2CO7niDRSonUZSyEUy1MZZr1kq08l1KCBpd_-tdB1uTqJ30ELHBxBaM'

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on'

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return existing
  return navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
}

export async function getPushState(): Promise<PushState> {
  // On iPhone, push works only for an app added to the home screen (iOS 16.4+)
  if (isIos() && !isStandalone()) return 'ios-install'
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

function keyToBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** Must be called from a tap (browsers only show the permission prompt after a user gesture). */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const reg = await registration()
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) as BufferSource,
    })
  }
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent,
  })
  if (error) throw error
  track('push_enabled')
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint })
    await sub.unsubscribe()
  }
  track('push_disabled')
  return 'off'
}

/** Re-save the subscription after login (the same phone may have switched account). */
export async function refreshPushSubscription(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent,
  })
}

export async function sendTestPush(): Promise<void> {
  const { error } = await supabase.rpc('send_test_push')
  if (error) throw error
  track('push_test')
}
