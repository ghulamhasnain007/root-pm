import { useState } from 'react';
import { IntegrationsPage } from './integrations/IntegrationsPage.js';
import { SchedulePage } from './integrations/SchedulePage.js';
import { AmbientPage } from './integrations/AmbientPage.js';
import { Logo } from './components/ui/index.js';

type Tab = 'schedule' | 'ambient' | 'integrations';

const TABS: { id: Tab; label: string }[] = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'ambient', label: 'Ambient' },
  { id: 'integrations', label: 'Integrations' },
];

export default function App() {
  // Land on Integrations automatically when redirected back from an OAuth callback.
  const [tab, setTab] = useState<Tab>(
    new URLSearchParams(window.location.search).has('integration') ? 'integrations' : 'schedule'
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex flex-col">
      <header className="border-b border-gray-800/60 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Logo tagline="Daily Standup, via Discord" />

            <nav className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-0.5" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50
                    ${tab === t.id ? 'bg-brand text-white' : 'text-gray-400 hover:text-gray-200'}`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {tab === 'integrations' ? <IntegrationsPage /> : tab === 'ambient' ? <AmbientPage /> : <SchedulePage />}
    </div>
  );
}
