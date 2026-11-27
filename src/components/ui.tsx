import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'hero' | 'secondary' | 'ghost' | 'onDark' | 'danger' | 'dark'

const variants: Record<Variant, string> = {
  // red filled – for use inside white cards
  primary: 'rounded-xl bg-brand text-white hover:bg-brand-dark disabled:bg-brand/50',
  // white pill with red text – main actions on the red background (as in the design)
  hero: 'rounded-full bg-white text-brand font-bold shadow-lg shadow-black/25 hover:bg-white/90 disabled:opacity-60',
  secondary: 'rounded-full bg-white text-ink border border-line hover:bg-mint disabled:opacity-50',
  ghost: 'rounded-xl bg-transparent text-ink-soft hover:bg-black/5 disabled:opacity-50',
  onDark: 'rounded-full bg-transparent text-white/85 hover:bg-white/10 disabled:opacity-50',
  danger: 'rounded-xl bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:opacity-50',
  dark: 'rounded-full bg-ink text-white hover:bg-black disabled:opacity-50',
}

export function Button({
  variant = 'primary',
  className = '',
  loading = false,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 font-medium transition active:scale-[0.98] disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 shadow-md shadow-black/10 ${className}`}>{children}</div>
}

export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${small ? 'h-4 w-4' : 'h-8 w-8 text-brand'}`}
      aria-label="טוען"
    />
  )
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-16">
      <span className="rounded-full bg-white p-3 shadow-md">
        <Spinner />
      </span>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft/75">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-transparent bg-mint px-3 py-2.5 font-medium outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15'

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${
        active ? 'border-brand bg-brand text-white shadow-sm' : 'border-black/10 bg-white text-ink hover:border-brand/50'
      }`}
    >
      {children}
    </button>
  )
}

/** Segmented control (tabs) */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string])[]
}) {
  return (
    <div className="grid rounded-full bg-white p-1 text-sm shadow-sm" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-full py-2 font-medium transition ${value === v ? 'bg-brand text-white shadow' : 'text-ink-soft'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null
  return <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-sm">{children}</div>
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-md shadow-black/10">
      <div className="mb-2 text-4xl">{icon}</div>
      <div className="font-display text-lg text-brand">{title}</div>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  )
}

export function MatchBadge({ pct }: { pct: number }) {
  const color = pct >= 75 ? 'bg-ok text-white' : pct >= 50 ? 'bg-accent text-white' : 'bg-white text-ink-soft'
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl px-2.5 py-1 shadow ${color}`}>
      <span className="font-display text-lg leading-none">{pct}%</span>
      <span className="text-[10px] leading-tight">התאמה</span>
    </div>
  )
}

export function LevelDots({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5 align-middle" title={`רמה ${level.toFixed(1)}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${level >= i - 0.25 ? 'bg-accent' : 'bg-line'}`} />
      ))}
    </span>
  )
}

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.webp`}
      alt="SportMatch"
      width={size}
      height={size}
      className="rounded-[22%] shadow-md shadow-black/20"
      style={{ width: size, height: size }}
    />
  )
}

/** Outline icons for the bottom navigation (as in the design) */
export function NavIcon({ name }: { name: 'home' | 'create' | 'events' | 'profile' }) {
  const common = { width: 24, height: 24, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
        </svg>
      )
    case 'create':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      )
    case 'events':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      )
    case 'profile':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      )
  }
}
