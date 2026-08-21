#!/usr/bin/env npx tsx
/**
 * scripts/migrate-to-org.ts
 *
 * Migrates single-tenant env-var configuration to org-based storage in auth-service.
 *
 * Usage:
 *   npx tsx scripts/migrate-to-org.ts [--org-id default] [--dry-run]
 *
 * What it does:
 *  1. Reads Discord bot token and Taiga credentials from env vars
 *  2. Creates a default org in auth-service (if not exists)
 *  3. Seeds tool configs for the default org
 *  4. Outputs summary of what was migrated
 */

const AUTH_BASE = process.env.AUTH_SERVICE_URL || 'http://localhost:4000';
const SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';

interface ToolCredential {
  key: string;
  value: string;
}

async function request(path: string, opts: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(SERVICE_KEY ? { 'X-Service-Key': SERVICE_KEY } : {}),
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
  const orgIdIdx = args.indexOf('--org-id');
  const orgId = orgIdIdx !== -1 ? args[orgIdIdx + 1] : 'default';

  console.log(`Migration target: org "${orgId}"${dryRun ? ' (DRY RUN)' : ''}`);

  // Gather credentials from env vars
  const tools: Array<{ toolId: string; category: string; credentials: ToolCredential[] }> = [];

  const discordToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || '';
  if (discordToken) {
    tools.push({
      toolId: 'discord',
      category: 'integration',
      credentials: [
        { key: 'bot_token', value: discordToken },
        { key: 'trigger_role', value: process.env.DISCORD_TRIGGER_ROLE || 'FYP' },
      ],
    });
  }

  const taigaUrl = process.env.TAIGA_URL || '';
  const taigaUser = process.env.TAIGA_USERNAME || '';
  const taigaPass = process.env.TAIGA_PASSWORD || '';
  if (taigaUrl && taigaUser) {
    tools.push({
      toolId: 'taiga',
      category: 'integration',
      credentials: [
        { key: 'url', value: taigaUrl },
        { key: 'username', value: taigaUser },
        { key: 'password', value: taigaPass },
      ],
    });
  }

  console.log(`\nFound ${tools.length} tool(s) configured via env vars:`);
  tools.forEach(t => console.log(`  - ${t.toolId} (${t.credentials.length} fields)`));

  if (dryRun) {
    console.log('\n[DRY RUN] Would create org and seed tool configs. Exiting.');
    return;
  }

  // Check if org already exists
  let orgExists = false;
  try {
    await request(`/orgs/${orgId}`);
    orgExists = true;
    console.log(`\nOrg "${orgId}" already exists.`);
  } catch {
    console.log(`\nCreating org "${orgId}"...`);
    // Create org with owner — use the first admin email from env
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@localhost';
    try {
      await request(`/orgs`, {
        method: 'POST',
        body: JSON.stringify({ orgId, name: orgId, ownerEmail: adminEmail }),
      });
      console.log(`  Created org "${orgId}" with owner ${adminEmail}`);
    } catch (err: any) {
      console.error(`  Failed to create org: ${err.message}`);
      // Continue — org may be created via invite flow instead
    }
  }

  // Seed tool configs
  console.log('\nSeeding tool configurations...');
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
      console.error(`  [FAIL] ${tool.toolId}: ${err.message}`);
    }
  }

  console.log('\nMigration complete.');
  console.log('\nNext steps:');
  console.log('  1. Verify tool configs in auth-service: GET /internal/tools/discord/orgs');
  console.log('  2. Restart scrum-master-ai and agent-bridge to pick up new config');
  console.log('  3. Remove env vars BOT_TOKEN, DISCORD_BOT_TOKEN, TAIGA_* from .env');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
