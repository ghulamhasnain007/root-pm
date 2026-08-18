# Root-PM Client

Single React app that replaces the two previously-separate frontends
(`scrum-master-ai/frontend` and `agent-bridge/frontend`). Talks to two
independent backends — the voice bot (`:3001`) and the agent-bridge config
API (`:8000`) — kept as two separate API clients (`src/lib/voiceApi.ts`,
`src/lib/configApi.ts`) rather than merged into one, since the backends
themselves are still separate services.

## Layout

```
src/
├── main.tsx                 Router + entry point
├── components/
│   ├── Shell.tsx             App chrome: sidebar/topbar, both nav sections
│   ├── ui/index.tsx           Merged component library (see note below)
│   ├── StandupPanel.tsx       Voice: live standup phase panel
│   └── TranscriptPanel.tsx    Voice: live transcript view
├── store/ConfigContext.tsx    Config dashboard global state
├── lib/
│   ├── configApi.ts           Config dashboard API client
│   └── voiceApi.ts            Voice bot API client
├── types/                     voice.ts, integrations.ts
└── pages/
    ├── config/                 7 pages ported from agent-bridge/frontend
    └── voice/                   3 pages ported from scrum-master-ai/frontend
```

## Migration notes (read before touching `components/ui/index.tsx`)

The two source apps had incompatible design systems: agent-bridge used
inline styles driven by CSS custom properties, scrum-master-ai used Tailwind
utility classes. Rather than force a visual-language unification as part of
this merge (a design task, not a plumbing one), the two systems were kept
**side by side in one file**, with three outcomes depending on whether a
genuine merge was safe:

1. **Actually merged** (`PageHeader`, `Spinner`) — both source APIs were
   true prop supersets of each other, so one implementation serves both page
   sets with zero call-site changes.
2. **Renamed to avoid collision** (`Card`→`ConfigCard`, `Field`→`ConfigField`
   for the config-dashboard versions) — same name, incompatible shape. Config
   pages were updated to the new names; voice pages keep `Card`/`Field`
   unchanged.
3. **Kept as separate, non-colliding exports** (`Badge`/`StatusBadge`,
   `Alert`/`Banner`, `Empty`/`EmptyState`) — same *purpose*, incompatible
   props in a way that would silently render wrong if forced together (e.g.
   `Empty` takes a Tabler icon *name string*; `EmptyState` takes a rendered
   `ReactNode` — passing one where the other is expected doesn't error, it
   just renders the wrong thing).

`.config-scope` in `index.css` exists because agent-bridge's original
`index.css` applied global `input/select/textarea` and `body` styling that
would otherwise silently override every Tailwind-styled input on the voice
pages once both apps share one bundle. It's applied by `<Shell>` around the
config-page outlet only — voice pages render unscoped.

`tsconfig.json` has `strict: false` — the config pages were mechanically
ported from `.jsx` with minimal added typing to make the merge tractable in
one pass. Tightening types page-by-page is good follow-up work but wasn't a
blocker for consolidating the two apps into one.

## Dev

```bash
npm install
npm run dev       # proxies /api → :8000, /integrations,/ws → :3001 (see vite.config.ts)
npm run typecheck
npm run build
```
