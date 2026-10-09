import { describe, it, expect } from 'vitest';
import { checkContent, runLint } from '../../../../scripts/lint-no-unbacked-rupee-estimates.mjs';

describe('Rupee Estimate Lint (mst_17 guard)', () => {
  it('passes on clean reports citing ledger or zero/unknown values', () => {
    const cleanContent = `
# Status Report
- Verified revenue: ₹0 (ledger source: commission_records)
- Unverified leads: 3 (potential revenue: UNKNOWN)
- Payout received: ₹3499 (statement: stm_123)
`;
    const errors = checkContent(cleanContent, 'test-clean.md');
    expect(errors.length).toBe(0);
  });

  it('fails when report generator outputs unbacked estimated rupee figure', () => {
    const dirtyContent = `
# Status Report
- Pipeline progress: estimated ₹15,000 in monthly commission
- Opportunity value: ₹5000 estimated
`;
    const errors = checkContent(dirtyContent, 'test-dirty.md');
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors[0].reason).toContain('Unbacked rupee estimate');
  });

  it('verifies default report generators pass lint', () => {
    const passed = runLint();
    expect(passed).toBe(true);
  });
});
