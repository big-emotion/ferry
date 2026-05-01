import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger, createTestLogger } from './index.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createTestLogger', () => {
  it('captures records with the required structured fields', () => {
    const { logger, records } = createTestLogger('evt-test-001', 'ferry:test');
    logger.info('hello world');

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'info',
      correlation_id: 'evt-test-001',
      component: 'ferry:test',
      message: 'hello world',
    });
    expect(typeof records[0].ts).toBe('string');
  });

  it('captures meta fields alongside required fields', () => {
    const { logger, records } = createTestLogger('evt-abc', 'ferry:dev-action');
    logger.error('fatal', { error: 'boom', iterations: 3 });

    expect(records[0]).toMatchObject({
      level: 'error',
      correlation_id: 'evt-abc',
      message: 'fatal',
      error: 'boom',
      iterations: 3,
    });
  });

  it('records all four log levels', () => {
    const { logger, records } = createTestLogger('c1', 'ferry:test');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    const levels = records.map((r) => r.level);
    expect(levels).toContain('info');
    expect(levels).toContain('warn');
    expect(levels).toContain('error');
  });

  it('suppresses debug level unless LOG_VERBOSITY=debug', () => {
    const { logger, records } = createTestLogger('c1', 'ferry:test');
    logger.debug('should be suppressed');
    expect(records).toHaveLength(0);
  });

  it('emits debug level when LOG_VERBOSITY=debug', () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const { logger, records } = createTestLogger('c1', 'ferry:test');
    logger.debug('debug message', { extra: true });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: 'debug', message: 'debug message', extra: true });
  });

  it('child logger inherits correlation_id and merges bindings', () => {
    const { logger, records } = createTestLogger('corr-id-42', 'ferry:loop');
    const child = logger.child({ depth: 2 });
    child.info('iteration', { iter: 5 });

    expect(records[0]).toMatchObject({
      correlation_id: 'corr-id-42',
      depth: 2,
      iter: 5,
      message: 'iteration',
    });
  });

  it('child bindings are not shared with parent', () => {
    const { logger, records } = createTestLogger('c', 'ferry:test');
    const child = logger.child({ depth: 1 });
    child.info('child msg');
    logger.info('parent msg');

    const childRec = records.find((r) => r.message === 'child msg');
    const parentRec = records.find((r) => r.message === 'parent msg');
    expect(childRec?.depth).toBe(1);
    expect(parentRec?.depth).toBeUndefined();
  });
});

describe('createLogger (JSON output)', () => {
  it('writes a JSON line to stderr', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger('evt-json-01', 'ferry:test');
    logger.info('test message', { foo: 'bar' });

    expect(spy).toHaveBeenCalledOnce();
    const written = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: 'info',
      correlation_id: 'evt-json-01',
      component: 'ferry:test',
      message: 'test message',
      foo: 'bar',
    });
    expect(typeof parsed.ts).toBe('string');
  });

  it('writes pretty-print line when LOG_FORMAT=pretty', () => {
    vi.stubEnv('LOG_FORMAT', 'pretty');
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger('evt-pretty', 'ferry:test');
    logger.info('pretty message');

    const written = spy.mock.calls[0][0] as string;
    expect(written).toContain('INFO');
    expect(written).toContain('[ferry:test]');
    expect(written).toContain('pretty message');
    expect(written).toContain('(evt-pretty)');
  });
});
