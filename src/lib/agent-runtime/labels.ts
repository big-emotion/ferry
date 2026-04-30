import type { ResolvedCapabilities } from '../labels/capabilities.js';

export function logCapabilities(logPrefix: string, capabilities: ResolvedCapabilities): void {
  if (capabilities.triggeredLabels.length > 0) {
    console.error(
      `${logPrefix} label capabilities: labels=[${capabilities.triggeredLabels.join(',')}] mcp=[${capabilities.mcpServerNames.join(',')}]`,
    );
  }
  if (capabilities.unknownFerryLabels.length > 0) {
    console.error(
      `${logPrefix} unknown ferry labels (ignored): ${capabilities.unknownFerryLabels.join(', ')}`,
    );
  }
}
