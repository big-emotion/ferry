import type { Logger } from '../logger/index.js';
import type { ResolvedCapabilities, TicketOverrides } from '../labels/capabilities.js';

export function logCapabilities(logger: Logger, capabilities: ResolvedCapabilities): void {
  if (capabilities.triggeredLabels.length > 0) {
    logger.info('label capabilities', {
      labels: capabilities.triggeredLabels,
      mcp: capabilities.mcpServerNames,
    });
  }
  if (capabilities.unknownFerryLabels.length > 0) {
    logger.warn('unknown ferry labels (ignored)', { labels: capabilities.unknownFerryLabels });
  }
}

export function logTypeOverrides(logger: Logger, overrides: TicketOverrides): void {
  if (overrides.typeOverride) {
    logger.info('type override active', {
      override: overrides.forceLabel,
      effectiveType: overrides.typeOverride,
    });
  }
  if (overrides.bypassTaskSkip) {
    logger.info('task skip bypassed (ferry:type:enable-task)');
  }
}
