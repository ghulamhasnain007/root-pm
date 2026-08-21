import type { Repositories } from '../repositories/interfaces.js'
import type { ToolCredentialCipher } from '../crypto/ToolCredentialCipher.js'
import type { ToolConfigEventPublisher } from './ToolConfigEventPublisher.js'
import { Errors } from '../errors.js'
import type { ToolCategory, ToolConfig } from '../domain/types.js'

/** What the dashboard sees when listing tools — metadata only, never
 * credentials (not even the encrypted blob). Secrets only ever leave this
 * service via the internal service-to-service credential-fetch route,
 * which is a different auth mechanism (see http/plugins/internalAuth.ts). */
export interface ToolConfigSummary {
  toolId: string
  category: ToolCategory
  status: ToolConfig['status']
  configuredBy: string
  updatedAt: Date
}

export class ToolConfigService {
  constructor(
    private repos: Repositories,
    private cipher: ToolCredentialCipher,
    private events: ToolConfigEventPublisher
  ) {}

  async setTool(opts: {
    orgId: string; category: ToolCategory; toolId: string
    credentials: Record<string, string>; configuredBy: string
  }): Promise<ToolConfigSummary> {
    const encryptedPayload = this.cipher.encrypt(JSON.stringify(opts.credentials))
    const saved = await this.repos.toolConfigs.upsert(opts.orgId, opts.category, opts.toolId, {
      encryptedPayload, status: 'connected', configuredBy: opts.configuredBy,
    })

    await this.repos.audit.append({
      orgId: opts.orgId, actorUserId: opts.configuredBy, action: 'tool.configured',
      target: opts.toolId, metadata: { category: opts.category },
    })
    await this.events.publish({ orgId: opts.orgId, toolId: opts.toolId, action: 'updated' })

    return this.toSummary(saved)
  }

  async listTools(orgId: string): Promise<ToolConfigSummary[]> {
    const all = await this.repos.toolConfigs.findAllByOrg(orgId)
    return all.map(t => this.toSummary(t))
  }

  async listOrgsForTool(toolId: string): Promise<Array<{ orgId: string; status: ToolConfig['status'] }>> {
    const all = await this.repos.toolConfigs.findAllByTool(toolId)
    return all.map(t => ({ orgId: t.orgId, status: t.status }))
  }

  async removeTool(orgId: string, toolId: string, actorUserId: string): Promise<void> {
    const existing = await this.repos.toolConfigs.findByOrgAndTool(orgId, toolId)
    if (!existing) throw Errors.notFound('Tool configuration')

    await this.repos.toolConfigs.delete(orgId, toolId)
    await this.repos.audit.append({ orgId, actorUserId, action: 'tool.removed', target: toolId, metadata: {} })
    await this.events.publish({ orgId, toolId, action: 'removed' })
  }

  /** INTERNAL USE ONLY — decrypts and returns raw credentials. Callers must
   * come through the internal service-to-service auth gate
   * (http/plugins/internalAuth.ts), never the user-facing dashboard routes. */
  async getDecryptedCredentials(orgId: string, toolId: string): Promise<Record<string, string> | null> {
    const existing = await this.repos.toolConfigs.findByOrgAndTool(orgId, toolId)
    if (!existing) return null
    try {
      return JSON.parse(this.cipher.decrypt(existing.encryptedPayload))
    } catch {
      return null
    }
  }

  private toSummary(t: ToolConfig): ToolConfigSummary {
    return { toolId: t.toolId, category: t.category, status: t.status, configuredBy: t.configuredBy, updatedAt: t.updatedAt }
  }
}
