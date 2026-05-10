import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

import { checkAuditLog } from './audit-log.js';

describe('checkAuditLog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns red when ferry-audit.jsonl does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const result = checkAuditLog('/repo/root');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('not found');
    expect(result.remedy).toBeDefined();
  });

  it('returns red when ferry-audit.jsonl is empty', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');
    const result = checkAuditLog('/repo/root');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('empty');
  });

  it('returns red when ferry-audit.jsonl has only whitespace lines', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('   \n  \n\n');
    const result = checkAuditLog('/repo/root');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('empty');
  });

  it('returns yellow when file has fewer than 5 non-empty lines', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"line":1}\n{"line":2}\n{"line":3}\n');
    const result = checkAuditLog('/repo/root');
    expect(result.status).toBe('yellow');
    expect(result.detail).toContain('3');
    expect(result.remedy).toBeDefined();
  });

  it('returns yellow for exactly 4 non-empty lines', () => {
    mockExistsSync.mockReturnValue(true);
    const content = Array(4).fill('{"line":1}').join('\n');
    mockReadFileSync.mockReturnValue(content);
    const result = checkAuditLog('/repo/root');
    expect(result.status).toBe('yellow');
  });

  it('returns green when file has 5 or more non-empty lines', () => {
    mockExistsSync.mockReturnValue(true);
    const content = Array(5).fill('{"line":1}').join('\n');
    mockReadFileSync.mockReturnValue(content);
    const result = checkAuditLog('/repo/root');
    expect(result.status).toBe('green');
    expect(result.detail).toContain('5');
  });

  it('returns green when file has many lines', () => {
    mockExistsSync.mockReturnValue(true);
    const content = Array(100).fill('{"line":1}').join('\n');
    mockReadFileSync.mockReturnValue(content);
    const result = checkAuditLog('/repo/root');
    expect(result.status).toBe('green');
    expect(result.detail).toContain('100');
  });

  it('includes the label "Audit log file" in the result', () => {
    mockExistsSync.mockReturnValue(false);
    const result = checkAuditLog('/repo/root');
    expect(result.label).toBe('Audit log file');
  });
});
