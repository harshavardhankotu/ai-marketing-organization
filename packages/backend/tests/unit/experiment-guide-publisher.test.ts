import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { ExperimentGuidePublisher } from '../../src/commission/experiment-guide-publisher.js';

describe('Part B: Break The Deadlock (Experiment Mode Guide Publication)', () => {
  const publisher = ExperimentGuidePublisher.getInstance();

  const resetEnvAndDb = () => {
    delete process.env.EXPERIMENT_MODE;
    delete process.env.ASSOCIATES_APPLICATION_DATE;
    delete process.env.ASSOCIATES_LISTED_SITE_URL;
    delete process.env.ASSOCIATES_AGREEMENT_READ;
    delete process.env.PUBLIC_SITE_NAME;
    delete process.env.PUBLIC_AUTHOR_NAME;
    delete process.env.PUBLIC_CONTACT_EMAIL;

    const db = getDb();
    try {
      db.prepare(`DELETE FROM commission_content_assets WHERE slug LIKE 'exp-test-%'`).run();
      db.prepare(`DELETE FROM learning_records WHERE source = 'OUTCOME' AND offer LIKE 'exp-test-%'`).run();
    } catch {}
  };

  beforeEach(resetEnvAndDb);
  afterEach(resetEnvAndDb);

  it('1. fails closed when EXPERIMENT_MODE is unset or false (default behavior)', () => {
    delete process.env.EXPERIMENT_MODE;

    const res = publisher.publishExperimentGuide({
      productId: 'prod_test_01',
      slug: 'exp-test-01',
      title: 'Test Guide',
      category: 'hardware',
      contentMarkdown: '# Test Guide Content',
      hypothesis: 'Direct buyer queries will discover guide',
      ownerConfirmed: true,
      specs: [{ spec: 'Direct Thermal', sourceUrl: 'https://manufacturer.com/specs', retrievedAt: '2026-10-15' }]
    });

    expect(res.published).toBe(false);
    expect(res.reason).toContain('EXPERIMENT_MODE_DISABLED');
  });

  it('2. fails when owner confirmation is missing even if EXPERIMENT_MODE=true', () => {
    process.env.EXPERIMENT_MODE = 'true';
    process.env.ASSOCIATES_APPLICATION_DATE = '2026-09-01';
    process.env.ASSOCIATES_LISTED_SITE_URL = 'https://supplyspecs.in';
    process.env.ASSOCIATES_AGREEMENT_READ = 'true';
    process.env.PUBLIC_SITE_NAME = 'SupplySpecs India';
    process.env.PUBLIC_AUTHOR_NAME = 'Harsha Vardhan Kotu';
    process.env.PUBLIC_CONTACT_EMAIL = 'contact@supplyspecs.in';

    const res = publisher.publishExperimentGuide({
      productId: 'prod_test_02',
      slug: 'exp-test-02',
      title: 'Test Guide',
      category: 'hardware',
      contentMarkdown: '# Test Guide Content',
      hypothesis: 'Direct buyer queries will discover guide',
      ownerConfirmed: false, // Owner did not click publish
      specs: [{ spec: 'Direct Thermal', sourceUrl: 'https://manufacturer.com/specs', retrievedAt: '2026-10-15' }]
    });

    expect(res.published).toBe(false);
    expect(res.reason).toContain('OWNER_CONFIRMATION_REQUIRED');
  });

  it('3. fails when statutory owner facts are missing', () => {
    process.env.EXPERIMENT_MODE = 'true';
    // No owner facts configured in env

    const res = publisher.publishExperimentGuide({
      productId: 'prod_test_03',
      slug: 'exp-test-03',
      title: 'Test Guide',
      category: 'hardware',
      contentMarkdown: '# Test Guide Content',
      hypothesis: 'Direct buyer queries will discover guide',
      ownerConfirmed: true,
      specs: [{ spec: 'Direct Thermal', sourceUrl: 'https://manufacturer.com/specs', retrievedAt: '2026-10-15' }]
    });

    expect(res.published).toBe(false);
    expect(res.reason).toContain('OWNER_FACTS_INVALID');
  });

  it('4. fails when any product fact lacks an official manufacturer source URL or date', () => {
    process.env.EXPERIMENT_MODE = 'true';
    process.env.ASSOCIATES_APPLICATION_DATE = '2026-09-01';
    process.env.ASSOCIATES_LISTED_SITE_URL = 'https://supplyspecs.in';
    process.env.ASSOCIATES_AGREEMENT_READ = 'true';
    process.env.PUBLIC_SITE_NAME = 'SupplySpecs India';
    process.env.PUBLIC_AUTHOR_NAME = 'Harsha Vardhan Kotu';
    process.env.PUBLIC_CONTACT_EMAIL = 'contact@supplyspecs.in';

    const res = publisher.publishExperimentGuide({
      productId: 'prod_test_04',
      slug: 'exp-test-04',
      title: 'Test Guide',
      category: 'hardware',
      contentMarkdown: '# Test Guide Content',
      hypothesis: 'Direct buyer queries will discover guide',
      ownerConfirmed: true,
      specs: [
        { spec: 'Valid Spec', sourceUrl: 'https://manufacturer.com/specs', retrievedAt: '2026-10-15' },
        { spec: 'Fabricated Spec', sourceUrl: '', retrievedAt: '' } // Unbacked
      ]
    });

    expect(res.published).toBe(false);
    expect(res.reason).toContain('UNSOURCED_PRODUCT_FACT');
  });

  it('5. successfully publishes guide with UNKNOWN demand and default 56-day review window when all gates pass', () => {
    process.env.EXPERIMENT_MODE = 'true';
    process.env.ASSOCIATES_APPLICATION_DATE = '2026-09-01';
    process.env.ASSOCIATES_LISTED_SITE_URL = 'https://supplyspecs.in';
    process.env.ASSOCIATES_AGREEMENT_READ = 'true';
    process.env.PUBLIC_SITE_NAME = 'SupplySpecs India';
    process.env.PUBLIC_AUTHOR_NAME = 'Harsha Vardhan Kotu';
    process.env.PUBLIC_CONTACT_EMAIL = 'contact@supplyspecs.in';

    const res = publisher.publishExperimentGuide({
      productId: 'prod_test_05',
      slug: 'exp-test-05',
      title: 'SupplySpecs Thermal Printer Guide 2026',
      category: 'hardware',
      contentMarkdown: 'Detailed comparison of direct thermal printers.',
      hypothesis: 'Targeted logistics search queries will generate referral impressions in 56 days',
      ownerConfirmed: true,
      specs: [
        { spec: 'Direct Thermal 203 DPI', sourceUrl: 'https://phomemo.com/products/pm241bt', retrievedAt: '2026-10-15' }
      ]
    });

    expect(res.published).toBe(true);
    expect(res.demand).toBe('UNKNOWN');
    expect(res.reviewWindowDays).toBe(56);
    expect(res.reviewWindowEnd).toBeDefined();

    // Verify stored asset in database
    const db = getDb();
    const asset = db.prepare(`SELECT * FROM commission_content_assets WHERE slug = 'exp-test-05'`).get() as any;
    expect(asset).toBeDefined();
    expect(asset.status).toBe('PUBLISHED');
    expect(asset.content_markdown).toContain('Demand: UNKNOWN');

    const meta = JSON.parse(asset.quality_gate_json);
    expect(meta.mode).toBe('EXPERIMENT');
    expect(meta.demand).toBe('UNKNOWN');
    expect(meta.demandClaimed).toBe(false);
    expect(meta.reviewWindowDays).toBe(56);
  });

  it('6. archives guide and writes OUTCOME row when review window expires with zero impressions', () => {
    process.env.EXPERIMENT_MODE = 'true';
    process.env.ASSOCIATES_APPLICATION_DATE = '2026-09-01';
    process.env.ASSOCIATES_LISTED_SITE_URL = 'https://supplyspecs.in';
    process.env.ASSOCIATES_AGREEMENT_READ = 'true';
    process.env.PUBLIC_SITE_NAME = 'SupplySpecs India';
    process.env.PUBLIC_AUTHOR_NAME = 'Harsha Vardhan Kotu';
    process.env.PUBLIC_CONTACT_EMAIL = 'contact@supplyspecs.in';

    // 1. Publish guide
    publisher.publishExperimentGuide({
      productId: 'prod_test_06',
      slug: 'exp-test-06',
      title: 'Exp Guide 06',
      category: 'hardware',
      contentMarkdown: 'Guide content',
      hypothesis: 'Expect 10+ impressions',
      reviewWindowDays: 56,
      ownerConfirmed: true,
      specs: [{ spec: '203 DPI', sourceUrl: 'https://mfr.com/specs', retrievedAt: '2026-10-15' }]
    });

    // 2. Evaluate before window end (e.g. Day 10) -> Should NOT archive
    const day10 = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    const earlyOutcomes = publisher.evaluateExperimentGuides(day10);
    expect(earlyOutcomes.some(o => o.slug === 'exp-test-06')).toBe(false);

    // 3. Evaluate after window end (e.g. Day 60) -> Should archive and write OUTCOME
    const day60 = new Date(Date.now() + 60 * 24 * 3600 * 1000);
    const finalOutcomes = publisher.evaluateExperimentGuides(day60);
    const exp6Outcome = finalOutcomes.find(o => o.slug === 'exp-test-06');
    expect(exp6Outcome).toBeDefined();
    expect(exp6Outcome?.archived).toBe(true);
    expect(exp6Outcome?.outcomeRecorded).toBe(true);

    // Verify DB update
    const db = getDb();
    const updatedAsset = db.prepare(`SELECT status FROM commission_content_assets WHERE slug = 'exp-test-06'`).get() as any;
    expect(updatedAsset.status).toBe('ARCHIVED');

    // Verify OUTCOME record in learning_records
    const lrn = db.prepare(`SELECT * FROM learning_records WHERE source = 'OUTCOME' AND offer = 'exp-test-06'`).get() as any;
    expect(lrn).toBeDefined();
    expect(lrn.source).toBe('OUTCOME');
    expect(lrn.outcome).toBe('FAILED');
    expect(lrn.what).toContain('Zero impressions within 56-day review window');
  });
});
