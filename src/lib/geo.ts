export interface LatLng {
  lat: number
  lng: number
}

export interface Place extends LatLng {
  label: string
  city: string
}

export const ISRAEL_CENTER: LatLng = { lat: 32.0853, lng: 34.7818 }

export function getCurrentPosition(timeoutMs = 8000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('הדפדפן לא תומך במיקום'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? 'לא ניתנה הרשאת מיקום' : 'לא הצלחנו לאתר מיקום')),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 },
    )
  })
}

type NominatimAddress = Record<string, string | undefined>

function cityOf(a: NominatimAddress | undefined): string {
  if (!a) return ''
  return a.city || a.town || a.village || a.municipality || a.suburb || a.county || ''
}

// OpenStreetMap Nominatim – free geocoding (light usage, 1 request / second)
export async function searchPlaces(query: string): Promise<Place[]> {
  const params = new URLSearchParams({
    q: query, format: 'jsonv2', addressdetails: '1', countrycodes: 'il', 'accept-language': 'he', limit: '6',
  })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
  if (!res.ok) throw new Error('החיפוש נכשל')
  const data = (await res.json()) as { lat: string; lon: string; display_name: string; name?: string; address?: NominatimAddress }[]
  return data.map((d) => ({
    lat: Number(d.lat),
    lng: Number(d.lon),
    label: d.display_name.split(',').slice(0, 3).join(','),
    city: cityOf(d.address),
  }))
}

export async function reverseGeocode(p: LatLng): Promise<Place> {
  const params = new URLSearchParams({
    lat: String(p.lat), lon: String(p.lng), format: 'jsonv2', addressdetails: '1', 'accept-language': 'he', zoom: '17',
  })
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`)
    const d = (await res.json()) as { display_name?: string; address?: NominatimAddress }
    const a = d.address
    const street = a ? [a.road, a.house_number].filter(Boolean).join(' ') : ''
    const place = a?.leisure || a?.amenity || a?.park || ''
    return { ...p, city: cityOf(a), label: [place, street].filter(Boolean).join(', ') || (d.display_name ?? '').split(',')[0] }
  } catch {
    return { ...p, city: '', label: '' }
  }
}
