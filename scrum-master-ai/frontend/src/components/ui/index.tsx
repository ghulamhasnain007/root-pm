import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/**
 * The app's shared visual language. Every page should reach for these
 * instead of hand-writing button/badge/card classes — that's what let
 * "gray-900 + violet-600" and "bg-brand" drift apart across pages in the
 * first place. One place to change padding, radius, or a color role; every
 * screen picks it up.
 */

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand hover:bg-brand-hover active:bg-brand text-white shadow-sm shadow-brand/20',
  secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 hover:border-gray-600',
  danger: 'text-red-400 hover:text-red-300 border border-red-500/25 hover:border-red-500/40 hover:bg-red-500/5',
  ghost: 'text-gray-400 hover:text-gray-200',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-[12px]',
  md: 'px-4 py-2.5 text-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', fullWidth, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors
        disabled:opacity-40 disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950
        ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

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
  );
}

// ── Badge / status dot ───────────────────────────────────────────────────────

type BadgeTone = 'brand' | 'live' | 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_TONE: Record<BadgeTone, { dot: string; text: string }> = {
  brand: { dot: 'bg-brand', text: 'text-brand' },
  live: { dot: 'bg-live', text: 'text-live' },
  success: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
  warning: { dot: 'bg-amber-400', text: 'text-amber-400' },
  danger: { dot: 'bg-red-500', text: 'text-red-400' },
  neutral: { dot: 'bg-gray-600', text: 'text-gray-500' },
};

/** A small dot + label — connection status, "live" indicators, meeting phase. Pulses for 'live'. */
export function StatusBadge({ tone, label, pulse }: { tone: BadgeTone; label: string; pulse?: boolean }) {
  const t = BADGE_TONE[tone];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot} ${pulse || tone === 'live' ? 'animate-pulse' : ''}`} />
      <span className={`text-[11px] font-medium ${t.text}`}>{label}</span>
    </span>
  );
}

/** A filled pill — capability tags, "advanced setup" flags, counts. */
export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'brand' }) {
  const cls = {
    neutral: 'bg-gray-800 text-gray-400',
    warning: 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
    brand: 'bg-brand-subtle text-brand',
  }[tone];
  return <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${cls}`}>{children}</span>;
}

// ── Card / layout ────────────────────────────────────────────────────────────

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-gray-900 rounded-xl border border-gray-800 p-5 ${className}`}>{children}</div>;
}

/** Small uppercase eyebrow used above a section — "TEAM (3)", "REPEATS", etc. One consistent size everywhere. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{children}</span>;
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h1 className="font-display text-xl font-semibold text-gray-100 tracking-tight">{title}</h1>
      {description && <p className="text-[13px] text-gray-500 mt-1 leading-relaxed max-w-2xl">{description}</p>}
    </div>
  );
}

// ── Form field ───────────────────────────────────────────────────────────────

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  required?: boolean;
  helpText?: string;
}

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
  );
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
  );
}

/** A labeled, accessible toggle switch — replaces bare <input type="checkbox"> for on/off settings. */
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
        onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange(!checked); } }}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50
          ${checked ? 'bg-brand' : 'bg-gray-700'}`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-1'}`} />
      </span>
      {label && <span className="text-[12px] text-gray-300 select-none">{label}</span>}
    </label>
  );
}

// ── Banner (inline alert) ────────────────────────────────────────────────────

type BannerTone = 'success' | 'danger' | 'info';

const BANNER_TONE: Record<BannerTone, { bg: string; icon: string; text: string }> = {
  success: { bg: 'bg-emerald-950/40 border-emerald-500/30', icon: 'text-emerald-400', text: 'text-emerald-300' },
  danger: { bg: 'bg-red-950/50 border-red-500/30', icon: 'text-red-400', text: 'text-red-300' },
  info: { bg: 'bg-brand-subtle border-brand/25', icon: 'text-brand', text: 'text-gray-200' },
};

export function Banner({
  tone, icon, children, onDismiss,
}: { tone: BannerTone; icon: ReactNode; children: ReactNode; onDismiss?: () => void }) {
  const t = BANNER_TONE[tone];
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
  );
}

// ── Empty / loading state ────────────────────────────────────────────────────

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
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-gray-500 py-6 justify-center">
      <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-700 border-t-brand animate-spin" />
      {label}
    </div>
  );
}

/** A toggleable pill button — recurrence choice, day/duration pickers,
 *  server/channel quick-select. Same selected/unselected treatment
 *  wherever a choice needs to look like a choice, not a form field. */
export function Chip({ selected, onClick, className = '', children }: {
  selected: boolean; onClick: () => void; className?: string; children: ReactNode;
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
  );
}

// ── Brand mark ───────────────────────────────────────────────────────────────

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
  );
}
