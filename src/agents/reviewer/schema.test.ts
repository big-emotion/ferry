import { afterEach, describe, expect, it } from 'vitest';
import {
  validateFindings,
  ReviewerFindingsSchemaError,
  setTaxonomyReader,
  restoreDefaultTaxonomyReader,
  resetTaxonomyCache,
} from './schema.js';

const validFinding = {
  rule_id: 'no-co-authored-by',
  message: 'remove trailer',
  file: 'src/foo.ts',
  line_start: 1,
  line_end: 1,
};

describe('reviewer schema', () => {
  it('accepts findings with rule_ids drawn from the taxonomy', () => {
    const out = validateFindings([validFinding]);
    expect(out).toHaveLength(1);
    expect(out[0].rule_id).toBe('no-co-authored-by');
  });

  it('throws ReviewerFindingsSchemaError when rule_id is unknown', () => {
    expect(() => validateFindings([{ ...validFinding, rule_id: 'totally-made-up' }])).toThrow(
      ReviewerFindingsSchemaError,
    );
  });

  it('accepts the synthetic ci-failure rule_id', () => {
    const out = validateFindings([{ rule_id: 'ci-failure', message: 'lint failed' }]);
    expect(out[0].rule_id).toBe('ci-failure');
  });

  it('rejects empty messages', () => {
    expect(() => validateFindings([{ ...validFinding, message: '' }])).toThrow(
      ReviewerFindingsSchemaError,
    );
  });

  it('rejects whitespace-only messages', () => {
    expect(() => validateFindings([{ ...validFinding, message: '   ' }])).toThrow(
      ReviewerFindingsSchemaError,
    );
    expect(() => validateFindings([{ ...validFinding, message: '\t\n  ' }])).toThrow(
      ReviewerFindingsSchemaError,
    );
  });

  describe('taxonomy injection', () => {
    afterEach(() => {
      restoreDefaultTaxonomyReader();
      resetTaxonomyCache();
    });

    it('rejects all non-synthetic rule_ids when the taxonomy file is missing', () => {
      setTaxonomyReader(() => {
        throw new Error('ENOENT');
      });
      resetTaxonomyCache();
      expect(() => validateFindings([{ ...validFinding }])).toThrow(ReviewerFindingsSchemaError);
      // synthetic ci-failure is still accepted because it does not depend on the YAML
      expect(validateFindings([{ rule_id: 'ci-failure', message: 'x' }])).toHaveLength(1);
    });

    it('accepts rule_ids from an injected taxonomy', () => {
      setTaxonomyReader(() => '\nrules:\n  - id: my-custom-rule\n    description: x\n');
      resetTaxonomyCache();
      const out = validateFindings([{ rule_id: 'my-custom-rule', message: 'x' }]);
      expect(out[0].rule_id).toBe('my-custom-rule');
    });
  });
});
