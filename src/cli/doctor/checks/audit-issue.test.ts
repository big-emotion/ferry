import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { checkAuditIssue } from './audit-issue.js';

describe('checkAuditIssue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns red when FERRY_AUDIT_ISSUE variable is not set', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('variable')) throw new Error('gh: variable not found');
      return '';
    });
    const result = checkAuditIssue('org/repo');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('not set');
    expect(result.remedy).toContain('README Step 1');
  });

  it('returns red when FERRY_AUDIT_ISSUE variable is empty', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('variable')) return '\n';
      return '';
    });
    const result = checkAuditIssue('org/repo');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('empty');
    expect(result.remedy).toContain('README Step 1');
  });

  it('returns red when FERRY_AUDIT_ISSUE is not a positive integer (letters)', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('variable')) return 'abc\n';
      return '';
    });
    const result = checkAuditIssue('org/repo');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('not a positive integer');
    expect(result.remedy).toContain('README Step 1');
  });

  it('returns red when FERRY_AUDIT_ISSUE is zero', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('variable')) return '0\n';
      return '';
    });
    const result = checkAuditIssue('org/repo');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('not a positive integer');
  });

  it('returns red when FERRY_AUDIT_ISSUE is a decimal', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('variable')) return '12.5\n';
      return '';
    });
    const result = checkAuditIssue('org/repo');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('not a positive integer');
  });

  it('returns red when the referenced issue is not found', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('variable')) return '42\n';
      if (args.includes('issue')) throw new Error('GraphQL: Could not resolve to an issue');
      return '';
    });
    const result = checkAuditIssue('org/repo');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('not found');
    expect(result.detail).toContain('42');
    expect(result.remedy).toContain('README Step 1');
  });

  it('returns red when the referenced issue is closed', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('variable')) return '42\n';
      if (args.includes('issue')) return JSON.stringify({ state: 'CLOSED' });
      return '';
    });
    const result = checkAuditIssue('org/repo');
    expect(result.status).toBe('red');
    expect(result.detail).toContain('closed');
    expect(result.detail).toContain('42');
    expect(result.remedy).toContain('README Step 1');
  });

  it('returns green when variable is set, is a positive integer, and issue is open', () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('variable')) return '42\n';
      if (args.includes('issue')) return JSON.stringify({ state: 'OPEN' });
      return '';
    });
    const result = checkAuditIssue('org/repo');
    expect(result.status).toBe('green');
    expect(result.detail).toContain('#42');
    expect(result.detail).toContain('open');
  });

  it('uses the correct repo in gh commands', () => {
    const calls: string[][] = [];
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      calls.push(args);
      if (args.includes('variable')) return '7\n';
      if (args.includes('issue')) return JSON.stringify({ state: 'OPEN' });
      return '';
    });
    checkAuditIssue('my-org/my-repo');
    expect(calls[0]).toContain('my-org/my-repo');
    expect(calls[1]).toContain('my-org/my-repo');
  });
});
