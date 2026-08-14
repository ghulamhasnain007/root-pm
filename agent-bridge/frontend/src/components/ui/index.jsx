// ── Button ─────────────────────────────────────────────────────────────────
export function Btn({ children, variant = 'ghost', size = 'md', disabled, loading, onClick, style, type = 'button' }) {
  const sizes = {
    sm: { height: 28, padding: '0 10px', fontSize: 11 },
    md: { height: 34, padding: '0 14px', fontSize: 12 },
    lg: { height: 40, padding: '0 18px', fontSize: 13 },
  }
  const variants = {
    primary: {
      background: 'var(--c-blue)', border: '1px solid var(--c-blue)',
      color: '#fff',
    },
    ghost: {
      background: 'var(--c-raised)', border: '1px solid var(--c-border2)',
      color: 'var(--t-hi)',
    },
    danger: {
      background: 'transparent', border: '1px solid rgba(239,68,68,.3)',
      color: 'var(--c-red)',
    },
    subtle: {
      background: 'transparent', border: '1px solid transparent',
      color: 'var(--t-mid)',
    },
    success: {
      background: 'var(--c-green-lo)', border: '1px solid rgba(16,185,129,.3)',
      color: 'var(--c-green)',
    },
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled || loading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        borderRadius: 'var(--r)', fontFamily: 'var(--font)',
        fontWeight: 500, cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1, transition: 'all .12s',
        whiteSpace: 'nowrap', flexShrink: 0,
        ...sizes[size], ...variants[variant], ...style,
      }}
      onMouseEnter={e => {
        if (!disabled && !loading) {
          if (variant === 'ghost') e.currentTarget.style.background = 'var(--c-hover)'
          if (variant === 'subtle') e.currentTarget.style.background = 'var(--c-raised)'
          if (variant === 'danger') e.currentTarget.style.background = 'var(--c-red-lo)'
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = variants[variant].background
      }}
    >
      {loading
        ? <i className="ti ti-loader-2" style={{ fontSize: 14, animation: 'spin .7s linear infinite' }} />
        : null}
      {children}
    </button>
  )
}

// ── Card ───────────────────────────────────────────────────────────────────
export function Card({ children, style }) {
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

export function CardHeader({ children, action }) {
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

export function CardBody({ children, style }) {
  return <div style={{ padding: '18px 20px', ...style }}>{children}</div>
}

// ── Field ──────────────────────────────────────────────────────────────────
export function Field({ label, required, hint, error, children, style }) {
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

// ── Badge ──────────────────────────────────────────────────────────────────
export function Badge({ children, color = 'blue' }) {
  const map = {
    blue:   { bg: 'var(--c-blue-lo)',   color: 'var(--c-blue)',  border: 'rgba(59,130,246,.25)'  },
    green:  { bg: 'var(--c-green-lo)',  color: 'var(--c-green)', border: 'rgba(16,185,129,.25)'  },
    amber:  { bg: 'var(--c-amber-lo)',  color: 'var(--c-amber)', border: 'rgba(245,158,11,.25)'  },
    red:    { bg: 'var(--c-red-lo)',    color: 'var(--c-red)',   border: 'rgba(239,68,68,.25)'   },
    neutral:{ bg: 'var(--c-raised)',    color: 'var(--t-lo)',    border: 'var(--c-border2)'      },
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

// ── Tier Badge ─────────────────────────────────────────────────────────────
export function TierBadge({ tier }) {
  const map = { admin: 'violet', write: 'blue', read: 'green', none: 'neutral' }
  return <Badge color={map[tier] || 'neutral'}>{tier}</Badge>
}

// ── Spinner ────────────────────────────────────────────────────────────────
export function Spinner({ size = 16 }) {
  return (
    <i className="ti ti-loader-2"
      style={{ fontSize: size, animation: 'spin .7s linear infinite', color: 'var(--c-blue)' }} />
  )
}

// ── Divider ────────────────────────────────────────────────────────────────
export function Divider({ style }) {
  return <div style={{ height: 1, background: 'var(--c-border)', margin: '16px 0', ...style }} />
}

// ── Two-col grid ───────────────────────────────────────────────────────────
export function Grid2({ children, gap = 14 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap }}>{children}</div>
  )
}

// ── Inline alert ───────────────────────────────────────────────────────────
export function Alert({ type = 'info', children }) {
  const map = {
    success: { bg: 'var(--c-green-lo)', border: 'rgba(16,185,129,.3)',  icon: 'circle-check',   color: 'var(--c-green)' },
    error:   { bg: 'var(--c-red-lo)',   border: 'rgba(239,68,68,.3)',   icon: 'alert-circle',   color: 'var(--c-red)'   },
    warn:    { bg: 'var(--c-amber-lo)', border: 'rgba(245,158,11,.3)',  icon: 'alert-triangle',  color: 'var(--c-amber)' },
    info:    { bg: 'var(--c-blue-lo)',  border: 'rgba(59,130,246,.3)',  icon: 'info-circle',    color: 'var(--c-blue)'  },
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

// ── Page header ────────────────────────────────────────────────────────────
export function PageHeader({ title, description, action }) {
  return (
    <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-.03em', marginBottom: 4, color: 'var(--t-hi)' }}>
          {title}
        </h1>
        {description && (
          <p style={{ fontSize: 13, color: 'var(--t-mid)', lineHeight: 1.6 }}>{description}</p>
        )}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────
export function Empty({ icon = 'mood-empty', title, description, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t-lo)' }}>
      <i className={`ti ti-${icon}`} style={{ fontSize: 32, display: 'block', marginBottom: 12, color: 'var(--c-border2)' }} />
      {title && <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--t-mid)', marginBottom: 6 }}>{title}</div>}
      {description && <div style={{ fontSize: 12, marginBottom: action ? 16 : 0, lineHeight: 1.6 }}>{description}</div>}
      {action}
    </div>
  )
}

// ── Mono text ──────────────────────────────────────────────────────────────
export function Mono({ children, style }) {
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t-mid)', ...style }}>
      {children}
    </span>
  )
}
