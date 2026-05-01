import type { Logger } from '../logger/index.js';
import type { ResolvedCapabilities } from '../labels/capabilities.js';

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
