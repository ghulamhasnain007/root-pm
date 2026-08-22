#!/usr/bin/env npx tsx
/**
 * scripts/migrate-to-org.ts
 *
 * Seeds env-var tool credentials (Discord bot token, Taiga account) into an
 * EXISTING, already-verified org in auth-service, via its public dashboard
 * API (login as Owner/Admin, then PUT each tool config).
 *
 * What this script does NOT do, and why: it cannot create a brand-new,
 * pre-verified org. auth-service's public POST /orgs/register always
 * creates the Owner account as pending_verification — by design, so is
 * every self-serve registration, real or scripted. There's no "skip
 * verification" flag on the public API; only auth-service's own boot-time
 * SEED_DEFAULT_ORG mechanism (see auth-service/src/migration/seedDefaultOrg.ts)
 * bypasses verification, because that's an operator-driven bootstrap step,
 * not something reachable from outside. If you're migrating a fresh
 * single-tenant deployment and don't have an org yet, use SEED_DEFAULT_ORG
 * instead of this script. Use this script once that org exists and its
 * Owner can log in — e.g. to seed additional tools, or to re-run seeding
 * against a long-running auth-service without restarting it.
 *
 * Usage:
 *   OWNER_EMAIL=owner@example.com OWNER_PASSWORD=... npx tsx scripts/migrate-to-org.ts [--dry-run]
 */

const AUTH_BASE = process.env.AUTH_SERVICE_URL || 'http://localhost:4000';

interface ToolCredential {
  key: string;
  value: string;
}

let accessToken = '';

async function request(path: string, opts: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...((opts.headers as Record<string, string>) || {}),
  };
  const resp = await fetch(`${AUTH_BASE}${path}`, { ...opts, headers });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const ownerEmail = process.env.OWNER_EMAIL || '';
  const ownerPassword = process.env.OWNER_PASSWORD || '';
  if (!ownerEmail || !ownerPassword) {
    console.error('OWNER_EMAIL and OWNER_PASSWORD env vars are required — this script logs in as an');
    console.error('existing, already-verified Owner/Admin to seed that org\'s tool configs.');
    console.error('(For a brand-new org from a fresh single-tenant migration, use SEED_DEFAULT_ORG=true');
    console.error(' on auth-service itself instead — see auth-service/README.md.)');
    process.exit(1);
  }

  // Gather credentials from env vars — same fields agent-bridge/scrum-master-ai
  // already read directly, so this can run against the same .env used before migrating.
  // Category values must match auth-service's ToolCategory enum exactly
  // ('communication' | 'project_management' | 'meeting_provider') — an
  // earlier version of this script used 'integration', which isn't a
  // valid category and would fail validation on every PUT.
  const tools: Array<{ toolId: string; category: string; credentials: ToolCredential[] }> = [];

  const discordToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || '';
  if (discordToken) {
    tools.push({
      toolId: 'discord',
      category: 'communication',
      credentials: [
        // snake_case keys — matches what ToolConfigPage.tsx's own form
        // actually writes (see its TOOL_DEFINITIONS field keys), so
        // credentials seeded by this script and credentials entered
        // through the dashboard end up in the same shape.
        { key: 'bot_token', value: discordToken },
        { key: 'trigger_role', value: process.env.DISCORD_TRIGGER_ROLE || 'FYP' },
      ],
    });
  }

  const taigaUrl = process.env.TAIGA_URL || '';
  const taigaUser = process.env.TAIGA_USERNAME || process.env.TAIGA_USER || '';
  const taigaPass = process.env.TAIGA_PASSWORD || process.env.TAIGA_PASS || '';
  if (taigaUrl && taigaUser) {
    tools.push({
      toolId: 'taiga',
      category: 'project_management',
      credentials: [
        { key: 'url', value: taigaUrl },
        { key: 'username', value: taigaUser },
        { key: 'password', value: taigaPass },
      ],
    });
  }

  console.log(`Found ${tools.length} tool(s) configured via env vars:`);
  tools.forEach(t => console.log(`  - ${t.toolId} (${t.credentials.length} fields)`));

  if (dryRun) {
    console.log('\n[DRY RUN] Would log in and seed these tool configs. Exiting.');
    return;
  }

  if (tools.length === 0) {
    console.log('\nNothing to migrate — no recognized env vars set. Exiting.');
    return;
  }

  console.log(`\nLogging in as ${ownerEmail}...`);
  const loginResult = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });
  accessToken = loginResult.accessToken;
  const orgId = loginResult.user.orgId;
  console.log(`  Logged in — org ${orgId}, role ${loginResult.user.role}`);

  console.log('\nSeeding tool configurations...');
  let failed = 0;
  for (const tool of tools) {
    try {
      await request(`/orgs/${orgId}/tools/${tool.toolId}`, {
        method: 'PUT',
        body: JSON.stringify({
          category: tool.category,
          credentials: Object.fromEntries(tool.credentials.map(c => [c.key, c.value])),
        }),
      });
      console.log(`  [OK] ${tool.toolId}: ${tool.credentials.length} fields saved`);
    } catch (err: any) {
      failed += 1;
      console.error(`  [FAIL] ${tool.toolId}: ${err.message}`);
    }
  }

  console.log(failed ? `\nMigration completed with ${failed} failure(s).` : '\nMigration complete.');
  console.log('\nNext steps:');
  console.log(`  1. Verify: curl -H "X-Internal-Key: $AUTH_SERVICE_INTERNAL_KEY" ${AUTH_BASE}/internal/tools/discord/orgs`);
  console.log('  2. Restart scrum-master-ai and agent-bridge (with AUTH_SERVICE_URL set) to pick up the new config');
  console.log('  3. Remove BOT_TOKEN/DISCORD_BOT_TOKEN/TAIGA_* from those services\' own .env once confirmed working');

  if (failed) process.exit(1);
}

main().catch(err => {
  console.error('Migration failed:', err.message || err);
  process.exit(1);
});
