import { describe, it, expect } from 'vitest';
import { checkOwnerFile, lintOwnerDirectory } from '../../../../scripts/lint-no-unauthorized-owner-prices.mjs';
import path from 'path';
import fs from 'fs';

describe('Step 2: No Agent-Invented Price Lint in owner/ directory', () => {
  it('1. owner/PILOT_DELIVERY_SPEC.md states "Price: TBD. Owner decides." and has 0 invented prices', () => {
    const specPath = path.resolve('../../owner/PILOT_DELIVERY_SPEC.md');
    expect(fs.existsSync(specPath)).toBe(true);

    const content = fs.readFileSync(specPath, 'utf8');
    expect(content).toContain('Price: TBD. Owner decides.');
    expect(content).not.toContain('Suggested pilot range: ₹5,000 to ₹15,000');
    expect(content).not.toMatch(/suggested\s+(?:pilot\s+)?(?:bracket|range)/i);

    const errors = checkOwnerFile(specPath);
    expect(errors).toEqual([]);
  });

  it('2. lint fails if an unauthorized rupee amount or price bracket is introduced into an owner spec', () => {
    const mockContentWithBracket = `
# Sample Owner Spec
- **Price:** Suggested pilot range: ₹5,000 to ₹15,000 depending on clinic size.
    `;
    const tempFile = path.resolve('../../owner/temp_test_spec.md');
    try {
      fs.writeFileSync(tempFile, mockContentWithBracket, 'utf8');
      const errors = checkOwnerFile(tempFile);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].reason).toContain('Unauthorized agent-invented rupee amount');
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it('3. whole owner/ directory passes the unauthorized price lint', () => {
    const result = lintOwnerDirectory(path.resolve('../../owner'));
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
