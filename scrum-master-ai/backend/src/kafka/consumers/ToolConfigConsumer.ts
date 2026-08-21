/**
 * kafka/consumers/ToolConfigConsumer.ts — Handles tool-config.updated and
 * tool-config.removed events from Kafka, delegating to BotConnectionManager.
 */
import { onConfigEvent, type ConfigEvent } from '../consumer.js';
import type { BotConnectionManager } from '../../integrations/discord/BotConnectionManager.js';

export function registerToolConfigHandlers(
  manager: BotConnectionManager,
  authServiceUrl: string,
  internalKey: string,
): void {
  onConfigEvent(async (event: ConfigEvent) => {
    if (event.eventType === 'tool-config.updated' && event.toolId === 'discord') {
      console.log(`[ToolConfigConsumer] Org ${event.orgId}: tool-config.updated — adding connection`);
      await manager.addOrg(event.orgId, authServiceUrl, internalKey);
    } else if (event.eventType === 'tool-config.removed' && event.toolId === 'discord') {
      console.log(`[ToolConfigConsumer] Org ${event.orgId}: tool-config.removed — removing connection`);
      await manager.removeOrg(event.orgId);
    }
  });
}
