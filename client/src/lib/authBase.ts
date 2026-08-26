// Relative by default, proxied by nginx.conf (prod) / vite.config.ts (dev)
// to auth-service — same convention as configApi.ts (BASE='/api') and
// voiceApi.ts (API_BASE defaults to ''). An earlier version of this
// defaulted to an absolute 'http://localhost:4000', which only worked when
// the browser happened to be running literally colocated with that exact
// port — broke behind any reverse proxy or in Docker, unlike the other two
// API clients in this app.
export const AUTH_BASE = import.meta.env.VITE_AUTH_API ?? '';
