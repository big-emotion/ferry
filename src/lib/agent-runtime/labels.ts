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

/** Logs the type-override fields of a TicketOverrides struct. @deprecated Use logTicketOverrides */
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

/**
 * Logs all resolved override fields from a TicketOverrides struct.
 * Supersedes logTypeOverrides — use this when calling resolveTicketOverrides.
 */
export function logTicketOverrides(logger: Logger, overrides: TicketOverrides): void {
  logTypeOverrides(logger, overrides);

  if (overrides.modelOverrides) {
    for (const [phase, mo] of Object.entries(overrides.modelOverrides)) {
      if (mo?.model) logger.info(`model override (${phase})`, { model: mo.model });
      if (mo?.provider) logger.info(`provider override (${phase})`, { provider: mo.provider });
    }
  }

  if (overrides.budget) {
    if (overrides.budget.maxCostEurPerRun !== undefined) {
      logger.info('budget override: max cost', {
        maxCostEurPerRun: overrides.budget.maxCostEurPerRun,
      });
    }
    if (overrides.budget.maxTokensPerRun !== undefined) {
      logger.info('budget override: max tokens', {
        maxTokensPerRun: overrides.budget.maxTokensPerRun,
      });
    }
  }

  if (overrides.skipPhases && overrides.skipPhases.length > 0) {
    logger.info('phase skip active', { phases: overrides.skipPhases });
  }

  if (overrides.noAutoTransition) {
    logger.info('no-auto-transition active (ferry:no-auto-transition)');
  }

  if (overrides.thinking !== undefined) {
    logger.info('thinking override', { thinking: overrides.thinking });
  }

  if (overrides.git?.noPr) {
    logger.info('git override: no-pr (PR creation skipped)');
  }

  if (overrides.paused) {
    logger.warn('ticket is paused (ferry:paused) — agent will exit without processing');
  }
}
