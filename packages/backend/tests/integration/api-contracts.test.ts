import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index.js';
import { resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('API Contract & Endpoint Verification', () => {
  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  it('GET /api/v1/health returns healthy status and service version', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.status).toBe('healthy');
    expect(json.version).toBe('1.0.0');
  });

  it('GET /api/v1/quota returns free-tier quota metrics', async () => {
    const res = await app.request('/api/v1/quota');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.freeTierActive).toBe(true);
    expect(json.data.maxConcurrentCalls).toBe(3);
  });

  it('GET /api/v1/agents returns all 80 agents', async () => {
    const res = await app.request('/api/v1/agents');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.total).toBe(80);
    expect(json.data).toHaveLength(80);
  });

  it('GET /api/v1/business returns the seeded Hyderabad Dental Clinic profile', async () => {
    const res = await app.request('/api/v1/business');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('SmileKraft Dental Clinic Hyderabad');
    expect(json.data.city).toBe('Hyderabad');
    expect(json.data.currency).toBe('INR');
  });

  it('GET /api/v1/goals returns business goals with KPIs', async () => {
    const res = await app.request('/api/v1/goals');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data[0].target_value).toBe(100);
  });

  it('GET /api/v1/analytics/dashboard returns calculated metrics', async () => {
    const res = await app.request('/api/v1/analytics/dashboard');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.metrics.qualifiedLeads).toBeDefined();
    expect(json.data.metrics.cpqlINR).toBeDefined();
  });

  it('POST /api/v1/kill-switch halts workflows when triggered and resumes on reset', async () => {
    // 1. Engage kill switch
    const resTrigger = await app.request('/api/v1/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: 'biz_smilekraft_hyd',
        active: true,
        reason: 'Emergency test stop'
      })
    });
    expect(resTrigger.status).toBe(200);
    const jsonTrigger = await resTrigger.json() as any;
    expect(jsonTrigger.killSwitchActive).toBe(true);

    // Verify business state in API
    const bizRes = await app.request('/api/v1/business');
    const bizJson = await bizRes.json() as any;
    expect(bizJson.data.kill_switch_active).toBe(1);

    // 2. Reset kill switch
    const resReset = await app.request('/api/v1/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: 'biz_smilekraft_hyd',
        active: false,
        reason: 'Restoring operations after safety check'
      })
    });
    expect(resReset.status).toBe(200);
    const jsonReset = await resReset.json() as any;
    expect(jsonReset.killSwitchActive).toBe(false);
  });
});