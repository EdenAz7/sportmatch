/** Levels are ranges on the same 1..5 scale as the star ratings; stored as the midpoint */
export const LEVELS = [
  { value: 1.5, label: '1-2', hint: 'מתחיל – משחק לפעמים, לומד את הבסיס' },
  { value: 2.5, label: '2-3', hint: 'חובב – משחק מדי פעם בשביל הכיף' },
  { value: 3.5, label: '3-4', hint: 'משחק באופן קבוע ומכיר את המשחק' },
  { value: 4.5, label: '4-5', hint: 'שחקן חזק / רקע תחרותי' },
]

/** 3.4 -> "3-4" */
export function levelLabel(level: number): string {
  const band = Math.min(4, Math.max(1, Math.floor(Number(level))))
  return `${band}-${band + 1}`
}

export function levelHint(level: number): string {
  const band = Math.min(4, Math.max(1, Math.floor(Number(level))))
  return LEVELS[band - 1].hint
}

export const SLOTS = [
  { value: 0, label: 'בוקר', group: 'אמצע שבוע' },
  { value: 1, label: 'צהריים', group: 'אמצע שבוע' },
  { value: 2, label: 'ערב', group: 'אמצע שבוע' },
  { value: 3, label: 'בוקר', group: 'סופ"ש' },
  { value: 4, label: 'צהריים', group: 'סופ"ש' },
  { value: 5, label: 'ערב', group: 'סופ"ש' },
]

const tz = 'Asia/Jerusalem'

export function formatDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(Date.now() + 86400000)
  const sameDay = (a: Date, b: Date) =>
    a.toLocaleDateString('en-CA', { timeZone: tz }) === b.toLocaleDateString('en-CA', { timeZone: tz })
  const time = d.toLocaleTimeString('he-IL', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  if (sameDay(d, today)) return `היום, ${time}`
  if (sameDay(d, tomorrow)) return `מחר, ${time}`
  const day = d.toLocaleDateString('he-IL', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'numeric' })
  return `${day}, ${time}`
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', { timeZone: tz, day: 'numeric', month: 'numeric', year: '2-digit' })
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'עכשיו'
  if (s < 3600) return `לפני ${Math.floor(s / 60)} דק'`
  if (s < 86400) return `לפני ${Math.floor(s / 3600)} שע'`
  return `לפני ${Math.floor(s / 86400)} ימים`
}

export function formatKm(km: number | null | undefined): string {
  if (km == null) return ''
  if (km < 1) return `${Math.round(km * 1000)} מ'`
  return `${km.toFixed(km < 10 ? 1 : 0)} ק"מ`
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (x: number) => (x * Math.PI) / 180
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Normalise an Israeli phone number for wa.me links */
export function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('972')) return digits
  if (digits.startsWith('0')) return '972' + digits.slice(1)
  return digits
}

export function isValidIsraeliPhone(phone: string): boolean {
  const d = phone.replace(/[\s-]/g, '')
  return /^(05\d{8}|\+9725\d{8}|9725\d{8})$/.test(d)
}

/** "2026-11-29T19:00" in Israel time -> ISO */
export function localInputToIso(value: string): string {
  // value is wall-clock time in Israel; compute the offset for that date
  const [date, time] = value.split('T')
  const guess = new Date(`${date}T${time}:00Z`)
  const asIsrael = new Date(guess.toLocaleString('en-US', { timeZone: tz }))
  const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offsetMs = asIsrael.getTime() - asUtc.getTime()
  return new Date(guess.getTime() - offsetMs).toISOString()
}

export function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`
}

export function googleCalendarUrl(title: string, startIso: string, durationMin: number, location: string): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const start = new Date(startIso)
  const end = new Date(start.getTime() + durationMin * 60000)
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${fmt(start)}/${fmt(end)}`, location })
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}
