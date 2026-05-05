import { describe, it, expect } from 'vitest';
import { assertIterOutputContract } from './outcome-guard.js';

const fullOutputs = { branchPushed: true, prNumber: 42 };

describe('assertIterOutputContract', () => {
  describe('implemented', () => {
    it('passes when branch is pushed and PR number is present', () => {
      expect(() => assertIterOutputContract('implemented', fullOutputs)).not.toThrow();
    });

    it('throws when branch is not pushed', () => {
      expect(() =>
        assertIterOutputContract('implemented', { ...fullOutputs, branchPushed: false }),
      ).toThrow(/branch to be pushed/);
    });

    it('throws when prNumber is 0', () => {
      expect(() =>
        assertIterOutputContract('implemented', { ...fullOutputs, prNumber: 0 }),
      ).toThrow(/open PR/);
    });
  });

  describe('already_satisfied', () => {
    it('passes when branch is pushed and PR number is present', () => {
      expect(() => assertIterOutputContract('already_satisfied', fullOutputs)).not.toThrow();
    });

    it('throws when branch is not pushed', () => {
      expect(() =>
        assertIterOutputContract('already_satisfied', { ...fullOutputs, branchPushed: false }),
      ).toThrow(/branch to be pushed/);
    });
  });

  describe('blocked', () => {
    it('never throws regardless of outputs', () => {
      expect(() =>
        assertIterOutputContract('blocked', { branchPushed: false, prNumber: 0 }),
      ).not.toThrow();
    });
  });
});
