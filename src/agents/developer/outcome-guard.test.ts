import { describe, it, expect } from 'vitest';
import { assertDevOutputContract } from './outcome-guard.js';

const fullOutputs = {
  branchPushed: true,
  prUrl: 'https://github.com/org/repo/pull/1',
  verificationNoteWritten: true,
};

describe('assertDevOutputContract', () => {
  describe('implemented', () => {
    it('passes when branch is pushed and PR URL is present', () => {
      expect(() =>
        assertDevOutputContract('implemented', { ...fullOutputs, verificationNoteWritten: false }),
      ).not.toThrow();
    });

    it('throws when branch is not pushed', () => {
      expect(() =>
        assertDevOutputContract('implemented', { ...fullOutputs, branchPushed: false }),
      ).toThrow(/branch to be pushed/);
    });

    it('throws when PR URL is empty', () => {
      expect(() => assertDevOutputContract('implemented', { ...fullOutputs, prUrl: '' })).toThrow(
        /PR URL/,
      );
    });
  });

  describe('already_satisfied', () => {
    it('passes when branch is pushed, PR URL present, and verification note written', () => {
      expect(() => assertDevOutputContract('already_satisfied', fullOutputs)).not.toThrow();
    });

    it('throws when verification note is not written', () => {
      expect(() =>
        assertDevOutputContract('already_satisfied', {
          ...fullOutputs,
          verificationNoteWritten: false,
        }),
      ).toThrow(/verification note/);
    });

    it('throws when branch is not pushed', () => {
      expect(() =>
        assertDevOutputContract('already_satisfied', { ...fullOutputs, branchPushed: false }),
      ).toThrow(/branch to be pushed/);
    });

    it('throws when PR URL is empty', () => {
      expect(() =>
        assertDevOutputContract('already_satisfied', { ...fullOutputs, prUrl: '' }),
      ).toThrow(/PR URL/);
    });
  });

  describe('blocked', () => {
    it('never throws regardless of outputs', () => {
      expect(() =>
        assertDevOutputContract('blocked', {
          branchPushed: false,
          prUrl: '',
          verificationNoteWritten: false,
        }),
      ).not.toThrow();
    });
  });
});
