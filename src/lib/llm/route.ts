/**
 * Story 4-3: critical-label aware model router (FR17).
 *
 * Only the developer agent honours the critical label -- refiner / reviewer /
 * iterator always use the default route.
 */

import type { FerryLlmConfig, LlmRoute } from './config.js';

export type AgentName = 'refiner' | 'developer' | 'reviewer' | 'iterator';

export interface RouteInput {
  agent: AgentName;
  labels: string[];
}

export function routeModel(input: RouteInput, cfg: FerryLlmConfig): LlmRoute {
  if (input.agent === 'developer' && input.labels.includes('critical')) {
    return cfg.critical;
  }
  return cfg.default;
}
