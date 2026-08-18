import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

/**
 * Shared component library for the merged client — pulls together the
 * scrum-master-ai (voice bot, Tailwind) and agent-bridge (config dashboard,
 * CSS-variable inline styles) component sets.
 *
 * Merge policy actually applied here (deviates from the original merge-plan
 * table in a few places — see notes below each section):
 *   - Genuinely interchangeable APIs were merged into one component
 *     (PageHeader, Spinner).
 *   - Same-purpose-but-different-behavior pairs (Badge/StatusBadge,
 *     Alert/Banner, Empty/EmptyState) were kept as SEPARATE exports rather
 *     than force-merged. The plan's table called for collapsing these, but
 *     on inspection their props aren't actually compatible (e.g. AB's
 *     `Empty` takes a Tabler icon *name string*, SMA's `EmptyState` takes a
 *     rendered ReactNode) — forcing one call site to use the other's shape
 *     would silently render wrong (a literal icon-name string instead of an
 *     icon). Keeping both avoids a visual regression on every existing page
 *     for a cosmetic win; unifying them into one true design language is a
 *     real design task, not a plumbing one — tracked as follow-up.
 *   - Name collisions with incompatible shapes (Card, Field) were resolved
 *     by renaming the agent-bridge version (ConfigCard, ConfigField) rather
 *     than picking a winner, so neither page set's existing usage changes.
 */

// ══════════════════════════════════════════════════════════════════════════
// Buttons
// ══════════════════════════════════════════════════════════════════════════

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand hover:bg-brand-hover active:bg-brand text-white shadow-sm shadow-brand/20',
  secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 hover:border-gray-600',
  danger: 'text-red-400 hover:text-red-300 border border-red-500/25 hover:border-red-500/40 hover:bg-red-500/5',
  ghost: 'text-gray-400 hover:text-gray-200',
  // Merged in from agent-bridge's Btn "subtle" variant — transparent until hovered.
  subtle: 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/60',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-[12px]',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3 text-sm',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  /** Merged in from agent-bridge's Btn — shows a spinner and disables the button. */
  loading?: boolean
}

export function Button({
  variant = 'secondary', size = 'md', fullWidth, loading, disabled, className = '', children, ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors
        disabled:opacity-40 disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950
        ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading && <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />}
      {children}
    </button>
  )
}

/** Back-compat alias — agent-bridge pages import `Btn`. Same component. */
export { Button as Btn }

/** Same visual treatment as Button, but as an <a> — for links that need button styling (OAuth connect, docs). */
export function LinkButton({
  variant = 'primary', size = 'md', fullWidth, className = '', children, ...rest
}: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string; children: ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors cursor-pointer
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950
        ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </a>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Status / badges — kept separate (see file header note)
// ══════════════════════════════════════════════════════════════════════════

type BadgeTone = 'brand' | 'live' | 'success' | 'warning' | 'danger' | 'neutral'

const BADGE_TONE: Record<BadgeTone, { dot: string; text: string }> = {
  brand: { dot: 'bg-brand', text: 'text-brand' },
  live: { dot: 'bg-live', text: 'text-live' },
  success: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
  warning: { dot: 'bg-amber-400', text: 'text-amber-400' },
  danger: { dot: 'bg-red-500', text: 'text-red-400' },
  neutral: { dot: 'bg-gray-600', text: 'text-gray-500' },
}

/** Dot + label — voice pages: connection status, "live" indicators, meeting phase. */
export function StatusBadge({ tone, label, pulse }: { tone: BadgeTone; label: string; pulse?: boolean }) {
  const t = BADGE_TONE[tone]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot} ${pulse || tone === 'live' ? 'animate-pulse' : ''}`} />
      <span className={`text-[11px] font-medium ${t.text}`}>{label}</span>
    </span>
  )
}

/** Filled pill tag — capability tags, "advanced setup" flags, counts (voice pages). */
export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'brand' }) {
  const cls = {
    neutral: 'bg-gray-800 text-gray-400',
    warning: 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
    brand: 'bg-brand-subtle text-brand',
  }[tone]
  return <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${cls}`}>{children}</span>
}

type BadgeColor = 'blue' | 'green' | 'amber' | 'red' | 'neutral' | 'violet'

/** Filled color box — config dashboard pages: connection status, small labels.
 * Visually distinct from StatusBadge (box vs dot) by design — this is what
 * agent-bridge pages already render, unchanged. */
export function Badge({ children, color = 'blue' }: { children: ReactNode; color?: BadgeColor }) {
  const map: Record<BadgeColor, { bg: string; color: string; border: string }> = {
    blue: { bg: 'var(--c-blue-lo)', color: 'var(--c-blue)', border: 'rgba(59,130,246,.25)' },
    green: { bg: 'var(--c-green-lo)', color: 'var(--c-green)', border: 'rgba(16,185,129,.25)' },
    amber: { bg: 'var(--c-amber-lo)', color: 'var(--c-amber)', border: 'rgba(245,158,11,.25)' },
    red: { bg: 'var(--c-red-lo)', color: 'var(--c-red)', border: 'rgba(239,68,68,.25)' },
    neutral: { bg: 'var(--c-raised)', color: 'var(--t-lo)', border: 'var(--c-border2)' },
    violet: { bg: 'rgba(139,92,246,.12)', color: 'var(--c-violet)', border: 'rgba(139,92,246,.25)' },
  }
  const s = map[color] || map.neutral
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 500, padding: '2px 8px',
      borderRadius: 4, background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
    }}>
      {children}
    </span>
  )
}

export function TierBadge({ tier }: { tier: 'admin' | 'write' | 'read' | 'none' | string }) {
  const map: Record<string, BadgeColor> = { admin: 'violet', write: 'blue', read: 'green', none: 'neutral' }
  return <Badge color={map[tier] || 'neutral'}>{tier}</Badge>
}

// ══════════════════════════════════════════════════════════════════════════
// Cards — ConfigCard (agent-bridge, header/body split) kept distinct from
// Card (voice bot, single wrapper) — see file header note.
// ══════════════════════════════════════════════════════════════════════════

/** Simple card wrapper — voice pages. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-gray-900 rounded-xl border border-gray-800 p-5 ${className}`}>{children}</div>
}

/** Header/body-split card — config dashboard pages. Renamed from agent-bridge's
 * `Card` to avoid colliding with the voice bot's simpler `Card` above. */
export function ConfigCard({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--c-base)', border: '1px solid var(--c-border)',
      borderRadius: 'var(--r-xl)', overflow: 'hidden',
      marginBottom: 16, ...style,
    }}>
      {children}
    </div>
  )
}

export function CardHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div style={{
      padding: '14px 20px', borderBottom: '1px solid var(--c-border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, fontSize: 13 }}>
        {children}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  )
}

export function CardBody({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={{ padding: '18px 20px', ...style }}>{children}</div>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{children}</span>
}

// ══════════════════════════════════════════════════════════════════════════
// Page header — genuinely merged (SMA's Tailwind rendering + AB's optional
// `action` slot; every existing call site on both sides already passes a
// prop subset of {title, description, action}, so this is a true
// backward-compatible superset — no call sites needed to change).
// ══════════════════════════════════════════════════════════════════════════

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-gray-100 tracking-tight">{title}</h1>
        {description && <p className="text-[13px] text-gray-500 mt-1 leading-relaxed max-w-2xl">{description}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Form fields — ConfigField (agent-bridge, wraps arbitrary children) kept
// distinct from Field (voice bot, renders the <input> itself) — see file
// header note. SelectField and Switch have no agent-bridge equivalent.
// ══════════════════════════════════════════════════════════════════════════

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  required?: boolean
  helpText?: string
}

/** Self-contained labeled input — voice pages. */
export function Field({ label, required, helpText, className = '', ...rest }: FieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-gray-400">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-[13px] text-gray-100 placeholder-gray-600
          focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors ${className}`}
        {...rest}
      />
      {helpText && <p className="text-[10px] text-gray-600 leading-relaxed">{helpText}</p>}
    </div>
  )
}

/** Label + hint/error wrapper around arbitrary children (input, select, custom
 * control) — config dashboard pages. Renamed from agent-bridge's `Field` to
 * avoid colliding with the voice bot's self-contained `Field` above. */
export function ConfigField({
  label, required, hint, error, children, style,
}: { label?: string; required?: boolean; hint?: ReactNode; error?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      {label && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 12, fontWeight: 500, color: 'var(--t-mid)',
          marginBottom: 6,
        }}>
          {label}
          {required && <span style={{ color: 'var(--c-red)', fontSize: 10 }}>required</span>}
        </label>
      )}
      {children}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 11, color: 'var(--c-red)' }}>
          <i className="ti ti-alert-circle" style={{ fontSize: 12 }} />{error}
        </div>
      )}
      {hint && !error && (
        <div style={{ marginTop: 5, fontSize: 11, color: 'var(--t-lo)', lineHeight: 1.5 }}>{hint}</div>
      )}
    </div>
  )
}

export function SelectField({
  label, required, children, ...rest
}: { label: string; required?: boolean; children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-gray-400">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <select
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-[13px] text-gray-100
          focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors disabled:opacity-40"
        {...rest}
      >
        {children}
      </select>
    </div>
  )
}

/** Labeled, accessible toggle switch — replaces bare <input type="checkbox"> for on/off settings. */
export function Switch({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange(!checked) } }}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50
          ${checked ? 'bg-brand' : 'bg-gray-700'}`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-1'}`} />
      </span>
      {label && <span className="text-[12px] text-gray-300 select-none">{label}</span>}
    </label>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Alerts — kept separate (see file header note)
// ══════════════════════════════════════════════════════════════════════════

type BannerTone = 'success' | 'danger' | 'info'

const BANNER_TONE: Record<BannerTone, { bg: string; icon: string; text: string }> = {
  success: { bg: 'bg-emerald-950/40 border-emerald-500/30', icon: 'text-emerald-400', text: 'text-emerald-300' },
  danger: { bg: 'bg-red-950/50 border-red-500/30', icon: 'text-red-400', text: 'text-red-300' },
  info: { bg: 'bg-brand-subtle border-brand/25', icon: 'text-brand', text: 'text-gray-200' },
}

/** Inline alert with caller-provided icon and optional dismiss — voice pages. */
export function Banner({
  tone, icon, children, onDismiss,
}: { tone: BannerTone; icon: ReactNode; children: ReactNode; onDismiss?: () => void }) {
  const t = BANNER_TONE[tone]
  return (
    <div className={`anim-in rounded-xl border px-4 py-3 flex items-start gap-2.5 ${t.bg}`}>
      <span className={`flex-shrink-0 mt-0.5 ${t.icon}`}>{icon}</span>
      <div className={`text-sm flex-1 ${t.text}`}>{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-xs opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
        >
          ✕
        </button>
      )}
    </div>
  )
}

type AlertType = 'success' | 'error' | 'warn' | 'info'

/** Inline alert with a built-in icon-by-type mapping (no caller icon needed)
 * — config dashboard pages, unchanged from agent-bridge. */
export function Alert({ type = 'info', children }: { type?: AlertType; children: ReactNode }) {
  const map: Record<AlertType, { bg: string; border: string; icon: string; color: string }> = {
    success: { bg: 'var(--c-green-lo)', border: 'rgba(16,185,129,.3)', icon: 'circle-check', color: 'var(--c-green)' },
    error: { bg: 'var(--c-red-lo)', border: 'rgba(239,68,68,.3)', icon: 'alert-circle', color: 'var(--c-red)' },
    warn: { bg: 'var(--c-amber-lo)', border: 'rgba(245,158,11,.3)', icon: 'alert-triangle', color: 'var(--c-amber)' },
    info: { bg: 'var(--c-blue-lo)', border: 'rgba(59,130,246,.3)', icon: 'info-circle', color: 'var(--c-blue)' },
  }
  const s = map[type]
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '10px 14px',
      borderRadius: 'var(--r)', background: s.bg,
      border: `1px solid ${s.border}`, marginBottom: 14,
    }}>
      <i className={`ti ti-${s.icon}`} style={{ color: s.color, fontSize: 15, flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 12, color: 'var(--t-hi)', lineHeight: 1.6 }}>{children}</span>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Empty / loading states — Empty (agent-bridge) kept separate from
// EmptyState (voice bot) — see file header note. Spinner genuinely merged.
// ══════════════════════════════════════════════════════════════════════════

export function EmptyState({
  icon, title, description, action,
}: { icon: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="w-10 h-10 mx-auto rounded-xl bg-gray-800 flex items-center justify-center text-lg mb-3">{icon}</div>
      <p className="text-[13px] font-medium text-gray-300">{title}</p>
      {description && <p className="text-[12px] text-gray-600 mt-1 max-w-xs mx-auto leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Takes a Tabler icon *name* (e.g. "mood-empty"), not a rendered node —
 * config dashboard pages, unchanged from agent-bridge. */
export function Empty({
  icon = 'mood-empty', title, description, action,
}: { icon?: string; title?: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t-lo)' }}>
      <i className={`ti ti-${icon}`} style={{ fontSize: 32, display: 'block', marginBottom: 12, color: 'var(--c-border2)' }} />
      {title && <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--t-mid)', marginBottom: 6 }}>{title}</div>}
      {description && <div style={{ fontSize: 12, marginBottom: action ? 16 : 0, lineHeight: 1.6 }}>{description}</div>}
      {action}
    </div>
  )
}

/** Genuinely merged — both call sites (`<Spinner size={16}/>` on config
 * pages, `<Spinner label="..."/>` on voice pages) pass disjoint optional
 * props, so this is a true backward-compatible superset. */
export function Spinner({ size = 14, label }: { size?: number; label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-gray-500 py-6 justify-center">
      <span
        className="rounded-full border-2 border-gray-700 border-t-brand animate-spin"
        style={{ width: size, height: size }}
      />
      {label}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Misc — no collisions, ported as-is from their respective source kits
// ══════════════════════════════════════════════════════════════════════════

/** Toggleable pill button — voice pages (task filters, weekday picker). */
export function Chip({ selected, onClick, className = '', children }: {
  selected: boolean; onClick: () => void; className?: string; children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg text-[12px] font-medium border transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50
        ${selected ? 'bg-brand-subtle border-brand/40 text-brand' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}
        ${className}`}
    >
      {children}
    </button>
  )
}

/** Voice bot brand mark — used on voice pages that want their own header mark.
 * The app-level mark lives in <Shell>. */
export function Logo({ tagline }: { tagline?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-brand-subtle border border-brand/25 flex items-center justify-center text-sm flex-shrink-0">
        🤖
      </div>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-display font-semibold text-[15px] text-gray-100 tracking-tight">Scrum Master AI</span>
        {tagline && <span className="text-gray-600 text-xs hidden sm:inline truncate">{tagline}</span>}
      </div>
    </div>
  )
}

export function Mono({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t-mid)', ...style }}>
      {children}
    </span>
  )
}

export function Grid2({ children, gap = 14 }: { children: ReactNode; gap?: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap }}>{children}</div>
}

export function Divider({ style }: { style?: React.CSSProperties }) {
  return <div style={{ height: 1, background: 'var(--c-border)', margin: '16px 0', ...style }} />
}
