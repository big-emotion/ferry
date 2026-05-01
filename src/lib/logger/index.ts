export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  ts: string;
  correlation_id: string;
  component: string;
  message: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function isDebugEnabled(): boolean {
  return process.env.LOG_VERBOSITY === 'debug';
}

function isPretty(): boolean {
  return process.env.LOG_FORMAT === 'pretty';
}

function buildRecord(
  level: LogLevel,
  correlationId: string,
  component: string,
  message: string,
  bindings: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
): LogRecord {
  return {
    level,
    ts: new Date().toISOString(),
    correlation_id: correlationId,
    component,
    message,
    ...bindings,
    ...meta,
  };
}

function writeRecord(record: LogRecord): void {
  if (isPretty()) {
    const { level, ts, correlation_id, component, message, ...rest } = record;
    const extras = Object.keys(rest).length > 0 ? `  ${JSON.stringify(rest)}` : '';
    process.stderr.write(
      `${ts}  ${level.toUpperCase().padEnd(5)}  [${component}]  ${correlation_id ? `(${correlation_id})  ` : ''}${message}${extras}\n`,
    );
  } else {
    process.stderr.write(JSON.stringify(record) + '\n');
  }
}

function makeLogger(
  correlationId: string,
  component: string,
  bindings: Record<string, unknown> = {},
  _writeRecord: (record: LogRecord) => void = writeRecord,
): Logger {
  function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (level === 'debug' && !isDebugEnabled()) return;
    _writeRecord(buildRecord(level, correlationId, component, message, bindings, meta));
  }
  return {
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    child: (newBindings) =>
      makeLogger(correlationId, component, { ...bindings, ...newBindings }, _writeRecord),
  };
}

export function createLogger(correlationId: string, component = 'ferry'): Logger {
  return makeLogger(correlationId, component);
}

export function createTestLogger(
  correlationId: string,
  component = 'ferry',
): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const logger = makeLogger(correlationId, component, {}, (record) => records.push(record));
  return { logger, records };
}
