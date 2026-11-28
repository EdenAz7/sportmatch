// SportMatch – send a Web Push message to every device of a user.
// Called by the database (pg_net) right after a row is inserted into public.notifications.
// It connects to the database directly (SUPABASE_DB_URL is provided by Supabase to every function)
// and reads its settings from private.app_config: push_secret, vapid_public, vapid_private.
// No key is stored in this code.
import webpush from 'npm:web-push@3.6.7'
import postgres from 'npm:postgres@3.4.5'

const APP_URL = 'https://edenaz7.github.io/sportmatch/'

const TITLES: Record<string, string> = {
  promoted: 'התפנה לך מקום!',
  joined: 'שחקן חדש הצטרף',
  left: 'שחקן ביטל השתתפות',
  full: 'המשחק התמלא',
  cancelled: 'משחק בוטל',
  updated: 'עדכון במשחק',
  teams: 'הקבוצות נקבעו',
  reminder: 'תזכורת למשחק',
  rate: 'איך היה המשחק?',
  facility_booked: 'משחק חדש במתקן שלך',
  facility_cancelled: 'משחק במתקן שלך בוטל',
  facility_updated: 'שינוי במשחק במתקן שלך',
  test: 'SportMatch',
}

function linkFor(kind: string, eventId: string | null): string {
  if (kind.startsWith('facility_')) return `${APP_URL}#/my-facilities`
  if (eventId) return `${APP_URL}#/events/${eventId}`
  return `${APP_URL}#/notifications`
}

type Body = { user_id?: string; kind?: string; message?: string; event_id?: string | null; notification_id?: number }

Deno.serve(async (req) => {
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false })
  try {
    const rows = await sql<{ key: string; value: string }[]>`
      select key, value from private.app_config where key in ('push_secret', 'vapid_public', 'vapid_private')`
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    if (!cfg.push_secret || req.headers.get('x-push-secret') !== cfg.push_secret) {
      return new Response('forbidden', { status: 403 })
    }

    let body: Body
    try {
      body = await req.json()
    } catch {
      return new Response('bad json', { status: 400 })
    }
    if (!body.user_id || !body.message) return new Response('missing fields', { status: 400 })

    webpush.setVapidDetails(APP_URL, cfg.vapid_public, cfg.vapid_private)
    const subs = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
      select id, endpoint, p256dh, auth from public.push_subscriptions where user_id = ${body.user_id}`

    const kind = body.kind ?? 'test'
    const payload = JSON.stringify({
      title: TITLES[kind] ?? 'SportMatch',
      body: body.message,
      url: linkFor(kind, body.event_id ?? null),
      tag: body.event_id ? `ev-${body.event_id}` : `n-${body.notification_id ?? Date.now()}`,
    })

    let sent = 0
    let removed = 0
    const failed: string[] = []
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 60 * 60 * 24,
          urgency: kind === 'promoted' || kind === 'cancelled' ? 'high' : 'normal',
        })
        sent++
        await sql`update public.push_subscriptions set last_success_at = now() where id = ${s.id}`
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          removed++
          await sql`delete from public.push_subscriptions where id = ${s.id}`
        } else {
          failed.push(`${status ?? ''} ${(e as Error).message ?? e}`.trim())
        }
      }
    }
    return Response.json({ sent, removed, failed })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  } finally {
    await sql.end({ timeout: 2 })
  }
})
