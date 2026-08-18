import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import './index.css'

import { ToastProvider } from './components/ui/Toast'
import { ConfigProvider } from './store/ConfigContext'
import Shell from './components/Shell'

// Config dashboard pages (from agent-bridge)
import OverviewPage from './pages/config/OverviewPage'
import PlatformsPage from './pages/config/PlatformsPage'
import ChannelsPage from './pages/config/ChannelsPage'
import PermissionsPage from './pages/config/PermissionsPage'
import LLMPage from './pages/config/LLMPage'
import AdvancedPage from './pages/config/AdvancedPage'
import LogsPage from './pages/config/LogsPage'

// Voice bot pages (from scrum-master-ai)
import { SchedulePage } from './pages/voice/SchedulePage'
import { AmbientPage } from './pages/voice/AmbientPage'
import { IntegrationsPage } from './pages/voice/IntegrationsPage'

/**
 * Every meeting-platform OAuth flow (Discord, Zoom, Google Meet, Teams)
 * redirects back to the frontend with `?integration=<provider>&status=...`
 * in the query string. The old scrum-master-ai app read this directly in
 * App.tsx's initial useState. In the merged app the entry point is the
 * router, so this has to run as an effect that redirects to the voice
 * integrations page — otherwise the callback lands on whatever the default
 * route is (`/overview`) with the params in the URL and nothing visibly
 * happens, making the integration look like it silently failed.
 */
function OAuthCallbackRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('integration')) {
      navigate('/voice/integrations' + window.location.search, { replace: true })
    }
    // Intentionally empty deps — only ever needs to run once, on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfigProvider>
        <BrowserRouter>
          <OAuthCallbackRedirect />
          <Routes>
            <Route path="/" element={<Shell />}>
              <Route index element={<Navigate to="/overview" replace />} />

              {/* Config dashboard routes (agent-bridge) */}
              <Route path="overview" element={<OverviewPage />} />
              <Route path="platforms" element={<PlatformsPage />} />
              <Route path="channels" element={<ChannelsPage />} />
              <Route path="permissions" element={<PermissionsPage />} />
              <Route path="llm" element={<LLMPage />} />
              <Route path="advanced" element={<AdvancedPage />} />
              <Route path="logs" element={<LogsPage />} />

              {/* Voice bot routes (scrum-master-ai) */}
              <Route path="voice/schedule" element={<SchedulePage />} />
              <Route path="voice/ambient" element={<AmbientPage />} />
              <Route path="voice/integrations" element={<IntegrationsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfigProvider>
    </ToastProvider>
  </React.StrictMode>
)
