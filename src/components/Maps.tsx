import { useEffect, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { ISRAEL_CENTER, getCurrentPosition, reverseGeocode, searchPlaces, type LatLng, type Place } from '../lib/geo'
import { Button, inputClass } from './ui'

export function emojiIcon(emoji: string) {
  return L.divIcon({ html: `<div class="emoji-marker">${emoji}</div>`, className: '', iconSize: [28, 28], iconAnchor: [14, 26] })
}

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTR = '&copy; OpenStreetMap'

function Recenter({ center, zoom }: { center: LatLng; zoom?: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom ?? map.getZoom())
  }, [center.lat, center.lng, zoom, map])
  return null
}

function ClickHandler({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

export function MapView({
  center,
  markers,
  height = 180,
  zoom = 14,
}: {
  center: LatLng
  markers: { pos: LatLng; emoji: string }[]
  height?: number
  zoom?: number
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line" style={{ height }}>
      <MapContainer center={[center.lat, center.lng]} zoom={zoom} style={{ height: '100%' }} scrollWheelZoom={false}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        {markers.map((m, i) => (
          <Marker key={i} position={[m.pos.lat, m.pos.lng]} icon={emojiIcon(m.emoji)} />
        ))}
        <Recenter center={center} />
      </MapContainer>
    </div>
  )
}

/** Search an address or tap on the map to choose a location */
export function MapPicker({
  value,
  onChange,
  emoji = '📍',
  height = 220,
}: {
  value: Place | null
  onChange: (p: Place) => void
  emoji?: string
  height?: number
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [center, setCenter] = useState<LatLng>(value ?? ISRAEL_CENTER)
  const [zoom, setZoom] = useState(value ? 15 : 12)

  async function runSearch() {
    if (query.trim().length < 2) return
    setBusy(true)
    setErr('')
    try {
      const r = await searchPlaces(query.trim())
      setResults(r)
      if (!r.length) setErr('לא נמצאו תוצאות. נסה כתובת אחרת או סמן על המפה')
    } catch {
      setErr('החיפוש נכשל, אפשר לסמן ידנית על המפה')
    } finally {
      setBusy(false)
    }
  }

  async function pick(p: LatLng) {
    const place = await reverseGeocode(p)
    onChange(place)
  }

  async function useMyLocation() {
    setBusy(true)
    setErr('')
    try {
      const p = await getCurrentPosition()
      setCenter(p)
      setZoom(15)
      await pick(p)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder="חיפוש כתובת, מגרש או פארק"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void runSearch()
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={runSearch} loading={busy}>
          חפש
        </Button>
      </div>
      {results.length > 0 && (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {results.map((r, i) => (
            <button
              type="button"
              key={i}
              className="block w-full px-3 py-2 text-right text-sm hover:bg-mint"
              onClick={() => {
                onChange(r)
                setCenter(r)
                setZoom(16)
                setResults([])
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      <div className="relative overflow-hidden rounded-2xl border border-line" style={{ height }}>
        <MapContainer center={[center.lat, center.lng]} zoom={zoom} style={{ height: '100%' }}>
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
          <ClickHandler onPick={(p) => void pick(p)} />
          {value && <Marker position={[value.lat, value.lng]} icon={emojiIcon(emoji)} />}
          <Recenter center={center} zoom={zoom} />
        </MapContainer>
        <button
          type="button"
          onClick={useMyLocation}
          className="absolute bottom-2 left-2 z-[400] rounded-full bg-white px-3 py-1.5 text-xs font-medium shadow"
        >
          📍 המיקום שלי
        </button>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <p className="text-xs text-ink-soft/80">
        {value ? `נבחר: ${[value.label, value.city].filter(Boolean).join(' · ') || 'מיקום על המפה'}` : 'אפשר גם ללחוץ על המפה כדי לסמן מיקום'}
      </p>
    </div>
  )
}
