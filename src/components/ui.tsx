import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark disabled:bg-brand/50',
  secondary: 'bg-white text-ink border border-line hover:bg-mint disabled:opacity-50',
  ghost: 'bg-transparent text-ink-soft hover:bg-black/5 disabled:opacity-50',
  danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50',
  dark: 'bg-ink text-white hover:bg-ink-soft disabled:opacity-50',
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
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-medium transition active:scale-[0.98] disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-white p-4 shadow-sm ${className}`}>{children}</div>
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
      <Spinner />
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft/70">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-line bg-white px-3 py-2.5 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20'

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
        active ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:border-brand/50'
      }`}
    >
      {children}
    </button>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null
  return <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div>
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="py-10 text-center">
      <div className="mb-2 text-4xl">{icon}</div>
      <div className="font-medium">{title}</div>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  )
}

export function MatchBadge({ pct }: { pct: number }) {
  const color = pct >= 75 ? 'bg-brand text-white' : pct >= 50 ? 'bg-brand-light text-brand-dark' : 'bg-mint text-ink-soft'
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl px-2.5 py-1.5 ${color}`}>
      <span className="text-lg font-bold leading-none">{pct}%</span>
      <span className="text-[10px] leading-tight">התאמה</span>
    </div>
  )
}

export function LevelDots({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5 align-middle" title={`רמה ${level.toFixed(1)}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${level >= i - 0.25 ? 'bg-brand' : 'bg-line'}`}
        />
      ))}
    </span>
  )
}
