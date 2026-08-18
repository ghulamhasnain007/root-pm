import { useState, useEffect, useRef } from 'react'
import { api } from '../../lib/configApi'
import { useToast } from '../../components/ui/Toast'
import { ConfigCard, CardHeader, Btn, PageHeader, Badge } from '../../components/ui/index'

const LEVELS = ['INFO', 'WARN', 'ERROR', 'DEBUG']
const LEVEL_COLOR = {
  INFO:  'var(--c-blue)',
  WARN:  'var(--c-amber)',
  ERROR: 'var(--c-red)',
  DEBUG: 'var(--t-lo)',
}
const LEVEL_BADGE = { INFO: 'blue', WARN: 'amber', ERROR: 'red', DEBUG: 'neutral' }

// Fallback demo logs when backend is offline
const DEMO_LOGS = [
  { timestamp: new Date().toISOString(), level: 'INFO',  source: 'api',            message: 'Backend not connected — showing demo logs' },
  { timestamp: new Date().toISOString(), level: 'INFO',  source: 'store',          message: 'Config loaded from localStorage' },
  { timestamp: new Date().toISOString(), level: 'DEBUG', source: 'config-context', message: 'Syncing state with localStorage' },
  { timestamp: new Date().toISOString(), level: 'WARN',  source: 'connection',     message: 'Backend offline — operating in local mode' },
  { timestamp: new Date().toISOString(), level: 'INFO',  source: 'shell',          message: 'UI mounted successfully' },
]

function LogLine({ entry, index }) {
  const t = new Date(entry.timestamp)
  const time = isNaN(t.getTime()) ? entry.timestamp : t.toISOString().slice(11, 23)
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '90px 50px 110px 1fr',
      gap: 0, padding: '3px 16px',
      borderBottom: '1px solid rgba(255,255,255,.03)',
      fontSize: 11, lineHeight: 1.8,
      fontFamily: 'var(--mono)',
      animation: index === 0 ? 'fadeIn .2s ease' : 'none',
    }}>
      <span style={{ color: 'var(--t-lo)' }}>{time}</span>
      <span style={{ color: LEVEL_COLOR[entry.level] || 'var(--t-mid)', fontWeight: 600 }}>{entry.level}</span>
      <span style={{ color: 'var(--c-violet)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {entry.source}
      </span>
      <span style={{ color: 'var(--t-mid)' }}>{entry.message}</span>
    </div>
  )
}

export default function LogsPage() {
  const toast = useToast()
  const [logs, setLogs] = useState(DEMO_LOGS)
  const [filter, setFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [paused, setPaused] = useState(false)
  const [online, setOnline] = useState(false)
  const consoleRef = useRef(null)

  const load = async () => {
    if (paused) return
    try {
      const data = await api.getLogs(200)
      setLogs(data)
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [paused])

  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleClear = async () => {
    try { await api.clearLogs() } catch {}
    setLogs([])
    toast('Logs cleared')
  }

  const filtered = filter ? logs.filter(l => l.level === filter) : logs
  const counts = LEVELS.reduce((acc, l) => ({ ...acc, [l]: logs.filter(x => x.level === l).length }), {})

  return (
    <div>
      <PageHeader
        title="Activity log"
        description="Live log stream from the Agent Bridge backend. Refreshes every 4 seconds."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant={paused ? 'primary' : 'ghost'} onClick={() => setPaused(p => !p)}>
              <i className={`ti ti-${paused ? 'player-play' : 'player-pause'}`} />
              {paused ? 'Resume' : 'Pause'}
            </Btn>
            <Btn variant="danger" onClick={handleClear}><i className="ti ti-trash" />Clear</Btn>
          </div>
        }
      />

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {LEVELS.map(l => (
          <div key={l} onClick={() => setFilter(f => f === l ? '' : l)} style={{
            background: filter === l ? `${LEVEL_COLOR[l]}12` : 'var(--c-base)',
            border: `1px solid ${filter === l ? LEVEL_COLOR[l] + '44' : 'var(--c-border)'}`,
            borderRadius: 'var(--r-lg)', padding: '12px 14px', cursor: 'pointer',
            transition: 'all .15s',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: counts[l] > 0 ? LEVEL_COLOR[l] : 'var(--t-lo)' }}>
              {counts[l]}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-lo)', marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>

      <ConfigCard>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ti ti-terminal" style={{ color: 'var(--t-lo)' }} />
            Console
            <Badge color={online ? 'green' : 'neutral'}>{online ? 'Live' : 'Offline'}</Badge>
            {paused && <Badge color="amber">Paused</Badge>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {LEVELS.map(l => (
              <button key={l} onClick={() => setFilter(f => f === l ? '' : l)} style={{
                padding: '3px 8px', fontSize: 10, fontWeight: 600,
                borderRadius: 4, cursor: 'pointer', border: '1px solid',
                fontFamily: 'var(--mono)', transition: 'all .12s',
                background: filter === l ? `${LEVEL_COLOR[l]}15` : 'transparent',
                borderColor: filter === l ? LEVEL_COLOR[l] + '44' : 'var(--c-border2)',
                color: filter === l ? LEVEL_COLOR[l] : 'var(--t-lo)',
              }}>{l}</button>
            ))}
            <div style={{ width: 1, background: 'var(--c-border2)', margin: '0 2px' }} />
            <button onClick={() => setAutoScroll(v => !v)} style={{
              padding: '3px 8px', fontSize: 10, fontWeight: 600,
              borderRadius: 4, cursor: 'pointer', border: '1px solid',
              background: autoScroll ? 'var(--c-blue-lo)' : 'transparent',
              borderColor: autoScroll ? 'rgba(59,130,246,.35)' : 'var(--c-border2)',
              color: autoScroll ? 'var(--c-blue)' : 'var(--t-lo)',
            }}>
              <i className="ti ti-arrow-down" style={{ fontSize: 11 }} /> Auto-scroll
            </button>
          </div>
        </CardHeader>

        {/* Console header row */}
        <div style={{
          display: 'grid', gridTemplateColumns: '90px 50px 110px 1fr',
          padding: '6px 16px', borderBottom: '1px solid var(--c-border)',
          background: 'var(--c-raised)',
        }}>
          {['Time', 'Level', 'Source', 'Message'].map((h, i) => (
            <span key={i} style={{ fontSize: 10, fontWeight: 600, color: 'var(--t-lo)', letterSpacing: '.06em', fontFamily: 'var(--mono)' }}>{h}</span>
          ))}
        </div>

        {/* Log body */}
        <div ref={consoleRef} onScroll={e => {
          const el = e.currentTarget
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 10
          setAutoScroll(atBottom)
        }} style={{
          background: '#0A0C12',
          maxHeight: 440,
          overflowY: 'auto',
          borderRadius: '0 0 var(--r-xl) var(--r-xl)',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--t-lo)', fontFamily: 'var(--mono)', fontSize: 12 }}>
              {filter ? `No ${filter} log entries` : 'No log entries yet'}
            </div>
          ) : (
            filtered.map((entry, i) => <LogLine key={i} entry={entry} index={i === 0 ? 0 : -1} />)
          )}
        </div>
      </ConfigCard>
    </div>
  )
}
