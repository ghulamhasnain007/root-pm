import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'

import { ToastProvider }  from './components/ui/Toast'
import { ConfigProvider } from './store/ConfigContext'
import Shell              from './components/Shell'
import OverviewPage       from './pages/OverviewPage'
import PlatformsPage      from './pages/PlatformsPage'
import ChannelsPage       from './pages/ChannelsPage'
import PermissionsPage    from './pages/PermissionsPage'
import LLMPage            from './pages/LLMPage'
import AdvancedPage       from './pages/AdvancedPage'
import LogsPage           from './pages/LogsPage'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfigProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Shell />}>
              <Route index                element={<Navigate to="/overview" replace />} />
              <Route path="overview"      element={<OverviewPage />} />
              <Route path="platforms"     element={<PlatformsPage />} />
              <Route path="channels"      element={<ChannelsPage />} />
              <Route path="permissions"   element={<PermissionsPage />} />
              <Route path="llm"           element={<LLMPage />} />
              <Route path="advanced"      element={<AdvancedPage />} />
              <Route path="logs"          element={<LogsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfigProvider>
    </ToastProvider>
  </React.StrictMode>
)
