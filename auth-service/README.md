# auth-service

Standalone authentication & organization-management service. Phase 1 of the
multi-tenancy plan — org registration, email verification, login,
JWT-access + Redis-refresh sessions, and email-invite-only staff onboarding
with roles. Does not yet integrate with `agent-bridge` or `scrum-master-ai`
(that's Phases 2–4) — this service is self-contained and independently
testable.

## Why this exists

Both `agent-bridge` and `scrum-master-ai` currently read Discord/Taiga
credentials from process-wide env vars — one deployment serves exactly one
organization. This service is the foundation for making that per-org
instead: organizations register, invite staff by email into role-gated
accounts, and configure their own tools — including their own Discord bot —
from a dashboard rather than a `.env` file.

## Status

**Phase 1 (orgs, staff, sessions) and Phase 2 (tool credential storage) are
implemented and tested.** Not yet integrated with `agent-bridge` or
`scrum-master-ai` (that's Phases 3–4) — this service is self-contained and
independently testable. `client/` has no login or tool-config screens yet
(Phase 5).

## Design notes

- **Business logic never touches Mongoose/Redis directly.** Everything in
  `src/services/` is written against the interfaces in
  `src/repositories/interfaces.ts` and `src/services/RefreshTokenStore.ts`
  (`IRefreshTokenStore`). Production wires the Mongo/Redis implementations
  (`src/repositories/mongo/`, `RefreshTokenStore`); tests wire the in-memory
  ones (`src/repositories/memory/`, `InMemoryRefreshTokenStore`) — same code
  path, no mocking framework needed. `npm run dev` with no Mongo/Redis
  configured also falls back to the in-memory versions (logged loudly as a
  warning, not silent) so local development doesn't require standing up
  infrastructure just to poke at the API.

- **Sessions are JWT-access + Redis-refresh, not one or the other.**
  Short-lived (15 min default) RS256-signed access tokens verify with zero
  network calls (any service can fetch `/.well-known/jwks.json` once and
  verify locally). Refresh tokens are opaque, hashed-at-rest, single-use
  (rotated on every refresh), and live in Redis specifically so they're
  instantly revocable — deleting a Redis key beats waiting for a JWT to
  expire when someone needs their access cut off *now* (staff removal, role
  change, logout).

- **Dashboard roles (`owner`/`admin`/`member`) are a fixed enum, not a
  dynamic per-org roles table.** This is a deliberate scope reduction — see
  the comment in `src/domain/types.ts` for what it would take to make roles
  fully dynamic later, and why nothing here needs to change to support that.
  This is a different, unrelated concept from agent-bridge's existing
  admin/write/read/none permission tiers, which govern what the *AI agent*
  is allowed to do per Discord role/channel — that system is untouched.

- **There is exactly one self-serve entry point:** `POST /orgs/register`,
  which always creates a brand-new org. Every other account is created via
  `POST /auth/accept-invite`, which requires an existing Owner/Admin to have
  called `POST /orgs/:orgId/staff/invite` first. There's no "request to join
  an org" or "search for my org" flow anywhere — see the
  `staff-flow.test.ts` test asserting two registrations with the same org
  name produce two separate orgs, not one org gaining a member.

- **Tool credentials have two separate trust boundaries, not one.** The
  dashboard routes (`GET/PUT/DELETE /orgs/:orgId/tools*`) are gated by the
  same user JWT + role system as everything else, and *never* return
  credentials — not even encrypted — only metadata (`toolId`, `category`,
  `status`, who configured it, when). Decrypted credentials are only ever
  returned by `GET /internal/orgs/:orgId/tools/:toolId/credentials`, gated
  by a completely different mechanism (`X-Internal-Key` shared secret, see
  `http/plugins/internalAuth.ts`) — a logged-in Owner's JWT does not work on
  that route, and vice versa. This reflects that "a human is allowed to
  configure this org's Discord bot" and "our own backend is allowed to
  fetch that bot's token to actually connect" are different questions.

- **Encryption matches the scheme already used elsewhere in this codebase.**
  `ToolCredentialCipher` (AES-256-GCM) is the same algorithm and payload
  format as scrum-master-ai's existing `TokenCipher` for meeting-provider
  OAuth tokens — one encryption scheme across the system, not two.

## Running locally

```bash
npm install
cp .env.example .env   # defaults (memory storage/session, console email) work with zero setup
npm run dev
```

Verification and invite emails print to the console when `EMAIL_PROVIDER=console`
(the default) — copy the `?token=...` value out of the logged link to test
the flow manually via curl or the `client/` app once Phase 5 wires it up.

## Testing

```bash
npm test
```

35 tests across `tests/` (all running against the in-memory repositories,
no external services needed):
- registration + email-verification gating
- refresh-token rotation and revocation
- closed-registration/invite-only staff onboarding
- role-gating (member can't invite, admin can't mint an owner)
- last-owner protection (can't demote/remove the only owner)
- role-change forcing re-authentication
- cross-org isolation (staff, tool configs)
- tool credential CRUD, encryption round-trip, and the internal-vs-dashboard
  trust boundary (a user JWT cannot hit the internal credential-fetch route,
  and vice versa)
- the migration/seed script (idempotency, conditional tool seeding, no-throw
  on missing config)

## Migrating an existing single-tenant deployment

Set `SEED_DEFAULT_ORG=true` plus `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
(and optionally the legacy `SEED_TAIGA_*`/`SEED_DISCORD_BOT_TOKEN` vars) and
start the service once — it creates one org, one active (pre-verified)
Owner account, and pre-populates that org's tool configs from the legacy
env vars if present. Safe to leave the flag on across restarts; it's a
no-op once the seeded org already exists. See
`src/migration/seedDefaultOrg.ts`.

## Production checklist

- [ ] `STORAGE=mongo` + `MONGO_URI` — memory storage loses all data on restart
- [ ] `SESSION_STORE=redis` + `REDIS_URL` — memory sessions aren't shared across instances and don't survive a restart
- [ ] `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEY` — without these, every restart invalidates all active sessions (see `.env.example` for how to generate a pair)
- [ ] `EMAIL_PROVIDER=smtp` + SMTP credentials — without this, verification/invite links are only ever logged server-side, never actually delivered
- [ ] `TOOL_CREDENTIAL_ENCRYPTION_KEY` — without this, every restart makes all previously-stored org tool credentials (Discord tokens, Taiga passwords, etc.) permanently undecryptable
- [ ] `INTERNAL_SERVICE_KEY` — set explicitly and share the same value with `agent-bridge`/`scrum-master-ai` once they consume this service (Phases 3–4); an auto-generated one changes on every restart
