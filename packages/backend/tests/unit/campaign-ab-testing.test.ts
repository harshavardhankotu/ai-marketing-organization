import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '../../src/index.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Campaign A/B Test Creation & Automated Performance Comparison', () => {
  const originalEnv = { ...process.env };
  const TEST_KEY = 'test_owner_ab_key_2026';

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.OWNER_API_KEY = TEST_KEY;
    resetDbForTesting();
    seedDatabase();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function seedSampleCampaign() {
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Primary Org', 'primary-org')
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO businesses (id, organization_id, name, vertical_id, vertical_name, city, neighborhood, brand_voice)
      VALUES ('biz_ab_test', 'org_owner_primary', 'CareFirst Dental', 'DENTAL', 'Dental Clinic', 'Hyderabad', 'Banjara Hills', 'Clinical & Warm')
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO business_goals (id, organization_id, business_id, title, target_metric, target_value, start_date, target_date, budget_allocated_inr)
      VALUES ('goal_ab_test', 'org_owner_primary', 'biz_ab_test', 'Q2 Leads', 'qualified_leads', 100, '2026-01-01', '2026-03-31', 50000)
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO strategies (id, organization_id, business_id, goal_id, version, title, rationale, positioning, expected_leads, expected_cpql_inr)
      VALUES ('str_ab_test', 'org_owner_primary', 'biz_ab_test', 'goal_ab_test', 1, 'Local Search + WhatsApp', 'High local intent', 'Transparent dental care', 100, 500)
    `).run();
    db.prepare(`
      INSERT INTO campaigns (
        id, organization_id, business_id, strategy_id, goal_id,
        title, objective, channels_json, target_audience, geography_json,
        budget_inr, status, start_date, end_date, primary_kpi, target_qualified_leads
      ) VALUES (
        'cmp_ab_01', 'org_owner_primary', 'biz_ab_test', 'str_ab_test', 'goal_ab_test',
        'Clear Aligners Banjara Hills Launch',
        'Acquire qualified aligner consultation bookings',
        '["WHATSAPP","GOOGLE_BUSINESS_PROFILE"]',
        'Professionals aged 22-45 in Hyderabad',
        '{"city":"Hyderabad"}',
        25000, 'ACTIVE', '2026-01-01', '2026-03-31', 'qualified_leads', 100
      )
    `).run();
  }

  it('creates multiple campaign variations linked to parent campaign and runs automated comparison', async () => {
    seedSampleCampaign();

    // 1. Create A/B test with 2 variations
    const createRes = await app.request('/api/v1/campaigns/cmp_ab_01/ab-tests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_KEY}`
      },
      body: JSON.stringify({
        title: 'Clear Aligners CTA & Channel Test',
        hypothesis: 'Transparent EMI pricing CTA will outperform standard checkup offer',
        baseline: {
          label: 'Control',
          callToAction: 'Book Complimentary Dental Checkup'
        },
        variations: [
          {
            name: 'Variant B — Zero-Cost EMI WhatsApp',
            objective: 'Lead with ₹2,999/mo EMI breakdown',
            callToAction: 'Book Scan on WhatsApp',
            channels: ['WHATSAPP', 'INSTAGRAM'],
            budgetINR: 15000,
            trafficSplitPercent: 40
          },
          {
            name: 'Variant C — Clinical 3D Preview',
            objective: 'Highlight 3D smile simulation preview',
            callToAction: 'Reserve 3D Scan Slot',
            channels: ['GOOGLE_ADS'],
            budgetINR: 10000,
            trafficSplitPercent: 30
          }
        ],
        minimumEvidenceRequirement: 30
      })
    });

    expect(createRes.status).toBe(201);
    const createJson = (await createRes.json()) as any;
    expect(createJson.success).toBe(true);
    expect(createJson.data.campaignId).toBe('cmp_ab_01');
    expect(createJson.data.experiments).toHaveLength(2);

    const expB = createJson.data.experiments.find((e: any) =>
      e.metrics?.variantLabel?.includes('Variant B')
    );
    const expC = createJson.data.experiments.find((e: any) =>
      e.metrics?.variantLabel?.includes('Variant C')
    );
    expect(expB).toBeDefined();
    expect(expC).toBeDefined();

    // 2. Compare single experiment with insufficient samples -> INCONCLUSIVE & persisted
    const earlyCompareRes = await app.request(`/api/v1/experiments/${expB.id}/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_KEY}`
      },
      body: JSON.stringify({
        baselineSamples: 10,
        baselineConversions: 1,
        treatmentSamples: 10,
        treatmentConversions: 3
      })
    });
    expect(earlyCompareRes.status).toBe(200);
    const earlyJson = (await earlyCompareRes.json()) as any;
    expect(earlyJson.data.evaluation.outcome).toBe('INCONCLUSIVE');
    expect(earlyJson.data.experiment.outcome).toBe('INCONCLUSIVE');
    expect(earlyJson.data.experiment.metrics.baselineSamples).toBe(10);

    // 3. Record analytics telemetry for Variant C and run campaign-wide automated comparison
    const db = getDb();
    for (let i = 0; i < 60; i++) {
      db.prepare(`
        INSERT INTO analytics_events (id, organization_id, business_id, campaign_id, channel, event_type, metadata_json)
        VALUES (?, 'org_owner_primary', 'biz_ab_test', 'cmp_ab_01', 'GOOGLE_ADS', 'impression', ?)
      `).run(`ev_base_imp_${i}`, JSON.stringify({ experimentId: expC.id, variant: 'baseline' }));
      if (i < 3) {
        db.prepare(`
          INSERT INTO analytics_events (id, organization_id, business_id, campaign_id, channel, event_type, metadata_json)
          VALUES (?, 'org_owner_primary', 'biz_ab_test', 'cmp_ab_01', 'GOOGLE_ADS', 'conversion', ?)
        `).run(`ev_base_conv_${i}`, JSON.stringify({ experimentId: expC.id, variant: 'baseline' }));
      }
    }
    for (let i = 0; i < 60; i++) {
      db.prepare(`
        INSERT INTO analytics_events (id, organization_id, business_id, campaign_id, channel, event_type, metadata_json)
        VALUES (?, 'org_owner_primary', 'biz_ab_test', 'cmp_ab_01', 'GOOGLE_ADS', 'impression', ?)
      `).run(`ev_var_imp_${i}`, JSON.stringify({ experimentId: expC.id, variant: 'treatment' }));
      if (i < 16) {
        db.prepare(`
          INSERT INTO analytics_events (id, organization_id, business_id, campaign_id, channel, event_type, metadata_json)
          VALUES (?, 'org_owner_primary', 'biz_ab_test', 'cmp_ab_01', 'GOOGLE_ADS', 'conversion', ?)
        `).run(`ev_var_conv_${i}`, JSON.stringify({ experimentId: expC.id, variant: 'treatment' }));
      }
    }

    const campCompareRes = await app.request('/api/v1/campaigns/cmp_ab_01/ab-tests/compare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_KEY}`
      },
      body: JSON.stringify({})
    });
    expect(campCompareRes.status).toBe(200);
    const campCompareJson = (await campCompareRes.json()) as any;
    expect(campCompareJson.success).toBe(true);
    expect(campCompareJson.data.topRecommendation).toBeDefined();
    expect(campCompareJson.data.topRecommendation.experimentId).toBe(expC.id);
    expect(campCompareJson.data.topRecommendation.outcome).toBe('SCALE');
    expect(campCompareJson.data.topRecommendation.pVal).toBeLessThan(0.05);
  });

  it('returns 404 when creating A/B test for a missing campaign', async () => {
    const res = await app.request('/api/v1/campaigns/non_existent_cmp/ab-tests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_KEY}`
      },
      body: JSON.stringify({
        variations: [{ name: 'Variant B' }]
      })
    });
    expect(res.status).toBe(404);
  });
});
