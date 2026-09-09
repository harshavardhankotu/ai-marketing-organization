import { describe, it, expect, beforeEach } from 'vitest';
import { AttributionEngine, Touchpoint } from '../../src/analytics/attribution-engine.js';
import { resetDbForTesting } from '../../src/db/client.js';

describe('AttributionEngine Multi-Touch Models', () => {
  beforeEach(() => {
    resetDbForTesting();
  });

  const touchpoints: Touchpoint[] = [
    { id: 't1', channel: 'GOOGLE_BUSINESS_PROFILE', createdAt: '2026-09-01T10:00:00Z', revenueINR: 45000 },
    { id: 't2', channel: 'INSTAGRAM', createdAt: '2026-09-03T14:00:00Z', revenueINR: 45000 },
    { id: 't3', channel: 'WHATSAPP', createdAt: '2026-09-05T18:00:00Z', revenueINR: 45000 }
  ];

  it('calculates FIRST_TOUCH attribution with 100% credit to initial touchpoint', () => {
    const res = AttributionEngine.calculateAttribution('evt-conv-01', touchpoints, 'FIRST_TOUCH');
    expect(res).toHaveLength(1);
    expect(res[0].channel).toBe('GOOGLE_BUSINESS_PROFILE');
    expect(res[0].creditFraction).toBe(1.0);
  });

  it('calculates LAST_TOUCH attribution with 100% credit to final touchpoint', () => {
    const res = AttributionEngine.calculateAttribution('evt-conv-02', touchpoints, 'LAST_TOUCH');
    expect(res).toHaveLength(1);
    expect(res[0].channel).toBe('WHATSAPP');
    expect(res[0].creditFraction).toBe(1.0);
  });

  it('calculates LINEAR attribution with equal fractional split', () => {
    const res = AttributionEngine.calculateAttribution('evt-conv-03', touchpoints, 'LINEAR');
    expect(res).toHaveLength(3);
    for (const r of res) {
      expect(r.creditFraction).toBeCloseTo(0.333, 2);
    }
  });

  it('calculates ASSISTED_CONVERSION attribution with 40/20/40 weighting', () => {
    const res = AttributionEngine.calculateAttribution('evt-conv-04', touchpoints, 'ASSISTED_CONVERSION');
    expect(res).toHaveLength(3);
    expect(res[0].channel).toBe('GOOGLE_BUSINESS_PROFILE');
    expect(res[0].creditFraction).toBe(0.40);
    expect(res[1].channel).toBe('INSTAGRAM');
    expect(res[1].creditFraction).toBe(0.20);
    expect(res[2].channel).toBe('WHATSAPP');
    expect(res[2].creditFraction).toBe(0.40);
  });
});