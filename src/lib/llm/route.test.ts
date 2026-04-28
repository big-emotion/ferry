import { describe, it, expect } from 'vitest';
import { routeModel } from './route.js';
import type { FerryLlmConfig } from './config.js';

const cfg: FerryLlmConfig = {
  default: { provider: 'openai', model: 'gemini-2.5-pro' },
  critical: { provider: 'openai', model: 'gpt-5-4' },
};

describe('routeModel (Story 4-3 FR17)', () => {
  it('developer + critical label -> critical route', () => {
    expect(routeModel({ agent: 'developer', labels: ['critical'] }, cfg)).toEqual(cfg.critical);
  });

  it('developer without critical label -> default route', () => {
    expect(routeModel({ agent: 'developer', labels: [] }, cfg)).toEqual(cfg.default);
  });

  it('non-developer agents always use the default route', () => {
    expect(routeModel({ agent: 'refiner', labels: ['critical'] }, cfg)).toEqual(cfg.default);
    expect(routeModel({ agent: 'reviewer', labels: ['critical'] }, cfg)).toEqual(cfg.default);
    expect(routeModel({ agent: 'iterator', labels: ['critical'] }, cfg)).toEqual(cfg.default);
  });

  it('label matching is exact (CRITICAL is not critical)', () => {
    expect(routeModel({ agent: 'developer', labels: ['CRITICAL'] }, cfg)).toEqual(cfg.default);
  });
});
