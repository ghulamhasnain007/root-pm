import { createContext, useContext, useCallback, useState } from 'react'

const Ctx = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const show = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  const dismiss = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  return (
    <Ctx.Provider value={show}>
      {children}
      <div style={{
        position: 'fixed', bottom: 24, right: 24,
        display: 'flex', flexDirection: 'column', gap: 8,
        zIndex: 9999, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} onClick={() => dismiss(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '11px 16px', borderRadius: 8,
              background: 'var(--c-raised)',
              border: `1px solid ${t.type === 'error' ? 'rgba(239,68,68,.35)' : t.type === 'warn' ? 'rgba(245,158,11,.35)' : 'rgba(16,185,129,.35)'}`,
              boxShadow: '0 8px 32px rgba(0,0,0,.4)',
              fontSize: 13, fontWeight: 500, color: 'var(--t-hi)',
              minWidth: 240, maxWidth: 380,
              pointerEvents: 'auto', cursor: 'pointer',
              animation: 'slideUp 0.2s ease both',
            }}>
            <i className={`ti ti-${t.type === 'error' ? 'alert-circle' : t.type === 'warn' ? 'alert-triangle' : 'circle-check'}`}
              style={{ fontSize: 16, color: t.type === 'error' ? 'var(--c-red)' : t.type === 'warn' ? 'var(--c-amber)' : 'var(--c-green)', flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx
}
