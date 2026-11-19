import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../../src/index.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { D1Client } from '../../src/db/d1-client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { AutonomousDealDiscoveryEngine, repairTitlePriceMismatch } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { AutonomousSystemDoctor } from '../../src/automation/autonomous-system-doctor.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { GeminiProvider } from '../../src/ai/gemini-provider.js';
import { ExperimentEngine } from '../../src/experiments/experiment-engine.js';
import { CommercialLearningEngine } from '../../src/commission/commercial-learning-engine.js';
import { OrganicDistributionEngine } from '../../src/commission/organic-distribution-engine.js';
import { InstagramBusinessAdapter } from '../../src/integrations/instagram-business-adapter.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import { SiteAuditScanner } from '../../src/tools/site-audit/site-audit-scanner.js';
import { SiteAuditFixPackGenerator } from '../../src/tools/site-audit/site-audit-fixpack-generator.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { AutomationRegistryEngine } from '../../src/automation/automation-registry-engine.js';

describe('Stage K: Pre-Deploy Security Lockdown, Fair-Price Integrity, Amazon Dual-Rail & /vs/ Comparisons', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';
    resetDbForTesting();
    seedDatabase();
    AutonomousDealDiscoveryEngine.resetInstance();
    GeminiProvider.resetHealthForTesting();
    D1Client.getInstance().resetQuotaCircuitBreakerForTesting();
  });

  afterEach(() => {
    D1Client.getInstance().resetQuotaCircuitBreakerForTesting();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('Task 1: Rejects autoEnvLogin, empty key, and GET /auth/owner/auto-session with HTTP 401 across all environments', async () => {
    process.env.OWNER_API_KEY = 'stagek_explicit_owner_secret_001';

    for (const nodeEnv of ['development', 'production']) {
      process.env.NODE_ENV = nodeEnv;
      const autoLoginRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://ais-dev-preview.asia-southeast1.run.app'
        },
        body: JSON.stringify({ autoEnvLogin: true })
      });
      expect(autoLoginRes.status).toBe(401);

      const emptyKeyRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: '' })
      });
      expect(emptyKeyRes.status).toBe(401);

      const autoSessionRes = await app.request('/api/v1/auth/owner/auto-session', {
        headers: {
          'Origin': 'https://ais-dev-preview.asia-southeast1.run.app'
        }
      });
      expect(autoSessionRes.status).toBe(401);
    }

    // Valid explicit key succeeds and returns sessionToken + iframe cookie
    const validLoginRes = await app.request('/api/v1/auth/owner/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://ais-dev-preview.asia-southeast1.run.app'
      },
      body: JSON.stringify({ apiKey: 'stagek_explicit_owner_secret_001' })
    });
    expect(validLoginRes.status).toBe(200);
    const loginJson = (await validLoginRes.json()) as any;
    expect(loginJson.authenticated).toBe(true);
    expect(loginJson.sessionToken).toMatch(/^sess_own_/);
  });

  it('Task 2: Blocks remote Cloudflare D1 writes outside Render even when D1 credentials exist', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc_test_123';
    process.env.CLOUDFLARE_D1_DATABASE_ID = 'db_test_456';
    process.env.CLOUDFLARE_D1_API_TOKEN = 'cf_token_test_789';
    delete process.env.RENDER;
    delete process.env.ALLOW_REMOTE_D1_WRITES;

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const d1 = D1Client.getInstance();
    const repo = D1RevenueRepository.getInstance();

    expect(d1.isRemoteD1Configured()).toBe(true);
    expect(d1.isRemoteD1WriteAllowed()).toBe(false);
    expect(repo.isRemoteD1WriteAllowed()).toBe(false);

    // Even if VITEST flag were temporarily absent on a local machine, non-Render blocks remote D1 writes
    delete process.env.VITEST;
    try {
      expect(d1.isRemoteD1WriteAllowed()).toBe(false);
      expect(repo.isRemoteD1WriteAllowed()).toBe(false);
    } finally {
      process.env.VITEST = 'true';
    }

    await repo.executeWrite(
      'cuelinks_campaigns',
      `INSERT OR REPLACE INTO cuelinks_campaigns (campaign_id, name, merchant_domain, status) VALUES (?, ?, ?, ?)`,
      ['camp_stagek_local', 'Stage K Local Only', 'stagek-local.example', 'ACTIVE']
    );

    const cloudflareCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes('api.cloudflare.com'));
    expect(cloudflareCalls.length).toBe(0);

    const row = getDb().prepare(`SELECT name FROM cuelinks_campaigns WHERE campaign_id = 'camp_stagek_local'`).get() as any;
    expect(row?.name).toBe('Stage K Local Only');

    // Non-Render dev defaults reads to local SQLite unless ALLOW_REMOTE_D1_READS=true
    delete process.env.ALLOW_REMOTE_D1_READS;
    delete process.env.VITEST;
    try {
      expect(d1.isRemoteD1ReadAllowed()).toBe(false);
      expect(repo.isRemoteD1ReadAllowed()).toBe(false);
      const localRead = await repo.query<any>(
        'cuelinks_campaigns',
        `SELECT name FROM cuelinks_campaigns WHERE campaign_id = ?`,
        ['camp_stagek_local']
      );
      expect(localRead[0]?.name).toBe('Stage K Local Only');
      expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('api.cloudflare.com')).length).toBe(0);
    } finally {
      process.env.VITEST = 'true';
    }

    // When ALLOW_REMOTE_D1_READS=true in dev and D1 returns HTTP 400 code 7500, circuit breaker trips cleanly
    process.env.ALLOW_REMOTE_D1_READS = 'true';
    const warnSpy = vi.spyOn(console, 'warn');
    fetchSpy.mockImplementation(async (input: any) => {
      if (String(input).includes('api.cloudflare.com')) {
        return new Response(JSON.stringify({
          messages: [],
          result: [],
          success: false,
          errors: [{ code: 7500, message: "Your account has exceeded D1's free tier daily row read limit." }]
        }), { status: 400 });
      }
      return new Response('{}', { status: 404 });
    });

    const r1 = await repo.query<any>(
      'cuelinks_campaigns',
      `SELECT name FROM cuelinks_campaigns WHERE campaign_id = ?`,
      ['camp_stagek_local']
    );
    expect(r1[0]?.name).toBe('Stage K Local Only');
    expect(d1.isRemoteD1QuotaExhausted()).toBe(true);
    expect(d1.isRemoteD1ReadAllowed()).toBe(false);

    const callsAfterFirst = fetchSpy.mock.calls.filter(([u]) => String(u).includes('api.cloudflare.com')).length;
    expect(callsAfterFirst).toBe(1);

    // Subsequent queries do NOT hit Cloudflare D1 again and do NOT emit console.warn spam
    const r2 = await repo.query<any>(
      'cuelinks_campaigns',
      `SELECT name FROM cuelinks_campaigns WHERE campaign_id = ?`,
      ['camp_stagek_local']
    );
    expect(r2[0]?.name).toBe('Stage K Local Only');
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('api.cloudflare.com')).length).toBe(1);
    const d1Warns = warnSpy.mock.calls.filter(([msg]) => String(msg).includes('[D1Client]'));
    expect(d1Warns.length).toBe(0);

    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_D1_DATABASE_ID;
    delete process.env.CLOUDFLARE_D1_API_TOKEN;
    delete process.env.ALLOW_REMOTE_D1_READS;
    delete process.env.ALLOW_REMOTE_D1_WRITES;
    fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('Task 3: Rejects direct push to main/master (HTTP 400) and opens PR from feature branch targeting main', async () => {
    process.env.OWNER_API_KEY = 'stagek_explicit_owner_secret_001';
    const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');

    for (const protectedBranch of ['main', 'master']) {
      const forbiddenRes = await app.request('/api/v1/owner/deploy/push-to-github', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          githubToken: 'ghp_test_token',
          branch: protectedBranch,
          commitMessage: 'should fail',
          files: ['package.json']
        })
      });
      expect(forbiddenRes.status).toBe(400);
      const errJson = (await forbiddenRes.json()) as any;
      expect(errJson.error).toBe('DIRECT_MAIN_PUSH_FORBIDDEN');
    }

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('/git/trees/feat%2Fstage-k-safe-profit-engine')) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      if (url.includes('/git/trees/main')) {
        return new Response(JSON.stringify({ sha: 'tree_main_1', tree: [] }), { status: 200 });
      }
      if (url.includes('/git/ref/heads/feat%2Fstage-k-safe-profit-engine')) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      if (url.includes('/git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: 'main_head_sha_1' } }), { status: 200 });
      }
      if (url.endsWith('/git/refs') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ref: 'refs/heads/feat/stage-k-safe-profit-engine', object: { sha: 'main_head_sha_1' } }), { status: 201 });
      }
      if (url.includes('/git/commits/main_head_sha_1')) {
        return new Response(JSON.stringify({ sha: 'main_head_sha_1', tree: { sha: 'tree_base_1' } }), { status: 200 });
      }
      if (url.includes('/git/trees/tree_base_1')) {
        return new Response(JSON.stringify({ sha: 'tree_base_1', tree: [] }), { status: 200 });
      }
      if (url.includes('/git/blobs')) {
        return new Response(JSON.stringify({ sha: 'blob_sha_stagek' }), { status: 201 });
      }
      if (url.includes('/git/trees')) {
        return new Response(JSON.stringify({ sha: 'tree_sha_stagek' }), { status: 201 });
      }
      if (url.includes('/git/commits')) {
        return new Response(JSON.stringify({ sha: 'commit_sha_stagek' }), { status: 201 });
      }
      if (url.includes('/git/refs/heads/feat%2Fstage-k-safe-profit-engine')) {
        return new Response(JSON.stringify({ object: { sha: 'commit_sha_stagek' } }), { status: 200 });
      }
      if (url.includes('/pulls?') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith('/pulls') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          number: 99,
          html_url: 'https://github.com/harshavardhankotu/ai-marketing-organization/pull/99'
        }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    });

    const prRes = await app.request('/api/v1/owner/deploy/push-to-github', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        githubToken: 'ghp_test_token',
        branch: 'feat/stage-k-safe-profit-engine',
        commitMessage: 'feat: stage k pr',
        files: ['package.json']
      })
    });
    expect(prRes.status).toBe(200);
    const prJson = (await prRes.json()) as any;
    expect(prJson.data?.branch).toBe('feat/stage-k-safe-profit-engine');
    expect(prJson.data?.baseBranch).toBe('main');
    expect(prJson.data?.prNumber).toBe(99);
    expect(prJson.data?.prUrl).toContain('/pull/99');

    fetchSpy.mockRestore();
  });

  it('Task 4: Enforces allowlisted domains, zero Amazon scraping, >=7d/>=3-point history gate, Dual-Rail search CTA & 20/min rate limit', async () => {
    process.env.AMAZON_AFFILIATE_TAG = 'harshavardhan-21';
    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('amazon.')) {
        throw new Error('Violation: Amazon HTML fetch attempted');
      }
      return new Response('{}', { status: 404 });
    });
    dealEngine.setFetchFn(globalThis.fetch);

    // 1. Unallowlisted merchant URL -> 400 UNALLOWLISTED_MERCHANT_DOMAIN
    const badHostRes = await app.request('/api/v1/public/fair-price-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.10'
      },
      body: JSON.stringify({
        queryOrUrl: 'https://untrusted-random-shop.example.com/product/123',
        skipAiSynthesis: true
      })
    });
    expect(badHostRes.status).toBe(400);
    const badHostJson = (await badHostRes.json()) as any;
    expect(badHostJson.error).toBe('UNALLOWLISTED_MERCHANT_DOMAIN');

    // 2. Amazon URL never triggers outbound fetch to amazon.*, returns INSUFFICIENT_HISTORY, null fair price & Amazon search rail CTA (#Ad)
    const amzRes = await app.request('/api/v1/public/fair-price-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.10'
      },
      body: JSON.stringify({
        queryOrUrl: 'https://www.amazon.in/dp/B09G9BL5CP',
        skipAiSynthesis: true
      })
    });
    expect(amzRes.status).toBe(200);
    const amzJson = (await amzRes.json()) as any;
    expect(amzJson.data?.verdict).toBe('INSUFFICIENT_HISTORY');
    expect(amzJson.data?.estimatedFairPriceINR).toBeNull();
    expect(amzJson.data?.monetizedDeal?.currentPriceINR).toBe(0);
    const amazonRail = amzJson.data?.crossStoreOptions?.find((o: any) => o.isAmazonSearchRail || o.affiliateNetwork === 'AMAZON_IN');
    expect(amazonRail).toBeDefined();
    expect(amazonRail.disclosure).toContain('#Ad');
    expect(amazonRail.ctaLabel).toContain("Check Today's Live Price & Prime Coupons on Amazon.in");
    expect(amazonRail.trackingRedirectUrl).toContain('/api/v1/public/amazon-redirect?');

    const outboundAmazonCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes('amazon.'));
    expect(outboundAmazonCalls.length).toBe(0);

    // 3. Verify GET /api/v1/public/amazon-redirect returns 302 with tag=harshavardhan-21
    const redirRes = await app.request('/api/v1/public/amazon-redirect?q=Sony+WH-1000XM5');
    expect(redirRes.status).toBe(302);
    const redirLoc = redirRes.headers.get('location') || '';
    expect(redirLoc).toContain('amazon.in/s?k=');
    expect(redirLoc).toContain('tag=harshavardhan-21');

    // 4. Rate limit: remaining 18 calls under same IP succeed, 21st call -> 429 RATE_LIMITED
    for (let i = 0; i < 18; i++) {
      const r = await app.request('/api/v1/public/fair-price-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.10'
        },
        body: JSON.stringify({
          queryOrUrl: 'no history query check',
          skipAiSynthesis: true
        })
      });
      expect(r.status).toBe(200);
    }
    const limitedRes = await app.request('/api/v1/public/fair-price-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.10'
      },
      body: JSON.stringify({
        queryOrUrl: '21st rate limited call',
        skipAiSynthesis: true
      })
    });
    expect(limitedRes.status).toBe(429);
    const limitedJson = (await limitedRes.json()) as any;
    expect(limitedJson.error).toBe('RATE_LIMITED');
  });

  it('Task 5: Exposes Head-to-Head /public/comparisons, SSR /vs/:comparisonSlug (200/404), and /sitemap.xml', async () => {
    process.env.AMAZON_AFFILIATE_TAG = 'harshavardhan-21';
    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO cuelinks_campaigns (
        campaign_id, name, merchant_domain, payout_rate, status, verification_source
      ) VALUES
      ('camp_boat_k', 'boAt', 'boat-lifestyle.com', '8%', 'ACTIVE', 'CUELINKS_API_V3'),
      ('camp_noise_k', 'GoNoise', 'gonoise.com', '7%', 'ACTIVE', 'CUELINKS_API_V3')
    `).run();

    await dealEngine.ingestAndVerifyDeal({
      title: 'boAt Nirvana Ion ANC Earbuds',
      brand: 'boAt',
      merchant: 'boAt Lifestyle',
      category: 'Audio',
      productUrl: 'https://www.boat-lifestyle.com/products/nirvana-ion-anc',
      sourceUrl: 'https://www.boat-lifestyle.com/products/nirvana-ion-anc',
      sourceDomain: 'boat-lifestyle.com',
      sourceClass: 'CUELINKS_FEED',
      currentPriceINR: 1999,
      referencePriceINR: 4990,
      availability: 'IN_STOCK',
      trackingUrl: 'https://linksredirect.com/?pub_id=281897CL264028&source=linkkit&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fnirvana-ion-anc',
      affiliateNetwork: 'CUELINKS',
      affiliateCampaignId: 'camp_boat_k',
      isMonetizable: true
    });

    await dealEngine.ingestAndVerifyDeal({
      title: 'Noise Buds VS104 Pro Earbuds',
      brand: 'Noise',
      merchant: 'GoNoise',
      category: 'Audio',
      productUrl: 'https://www.gonoise.com/products/noise-buds-vs104-pro',
      sourceUrl: 'https://www.gonoise.com/products/noise-buds-vs104-pro',
      sourceDomain: 'gonoise.com',
      sourceClass: 'CUELINKS_FEED',
      currentPriceINR: 1699,
      referencePriceINR: 3999,
      availability: 'IN_STOCK',
      trackingUrl: 'https://linksredirect.com/?pub_id=281897CL264028&source=linkkit&url=https%3A%2F%2Fwww.gonoise.com%2Fproducts%2Fnoise-buds-vs104-pro',
      affiliateNetwork: 'CUELINKS',
      affiliateCampaignId: 'camp_noise_k',
      isMonetizable: true
    });

    const listRes = await app.request('/api/v1/public/comparisons');
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as any;
    const pairs = Array.isArray(listJson.data) ? listJson.data : (listJson.data?.comparisons || []);
    expect(pairs.length).toBeGreaterThan(0);

    const slug = pairs[0].comparisonSlug;
    const ssrRes = await app.request(`/vs/${encodeURIComponent(slug)}`);
    expect(ssrRes.status).toBe(200);
    const html = await ssrRes.text();
    expect(html).toContain('application/ld+json');
    expect(html).toContain('ItemList');
    expect(html).toContain("Check Today's Live Price &amp; Prime Coupons on Amazon.in &rarr; (#Ad)");

    const notFoundRes = await app.request('/vs/nonexistent-product-vs-missing-item');
    expect(notFoundRes.status).toBe(404);

    const sitemapRes = await app.request('/sitemap.xml');
    expect(sitemapRes.status).toBe(200);
    const xml = await sitemapRes.text();
    expect(xml).toContain(`/vs/${slug}`);
  });

  it('Task 6: Enforces Brevo contact email (422) & 10/day outreach cap (429), Gemini key isolation, and private audit 404/noindex', async () => {
    process.env.OWNER_API_KEY = 'stagek_explicit_owner_secret_001';
    process.env.BREVO_API_KEY = 'xkeysib_stagek_test';
    process.env.BREVO_SENDER_EMAIL = 'harsha@sitefix.in';
    delete process.env.PUBLIC_CONTACT_EMAIL;

    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO platform_prospects (
        id, business_name, prospect_business_name, prospect_city, prospect_vertical,
        email, prospect_email, website_url, stage, status
      ) VALUES (
        'pros_stagek_01', 'Apex Roasters', 'Apex Roasters', 'Bengaluru', 'coffee_roasters',
        'hello@apexroasters.example', 'hello@apexroasters.example', 'https://apexroasters.example',
        'DISCOVERED', 'NEW'
      )
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO direct_outreach_log (
        id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, response_status, created_at
      ) VALUES (
        'draft_stagek_01', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Apex Roasters', 'EMAIL',
        'We observed SEO schema gaps on apexroasters.example.', 0, 0, 'DRAFT_PENDING_APPROVAL', datetime('now')
      )
    `).run();

    const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');

    // 1. Missing PUBLIC_CONTACT_EMAIL -> 422
    const noEmailRes = await app.request('/api/v1/owner/first-sale/approve-and-send/draft_stagek_01', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(noEmailRes.status).toBe(422);

    // 2. With PUBLIC_CONTACT_EMAIL, verify footer postal address + unsubscribe link & 10/day UTC cap (429 on 11th)
    process.env.PUBLIC_CONTACT_EMAIL = 'harsha@sitefix.in';
    const brevoBodies: any[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('api.brevo.com/v3/smtp/email')) {
        brevoBodies.push(JSON.parse(String(init?.body || '{}')));
        return new Response(JSON.stringify({ messageId: '<stagek_msg@brevo>' }), { status: 201 });
      }
      if (url.includes('generativelanguage.googleapis.com')) {
        if (url.includes('key=bad_render_key')) {
          return new Response(JSON.stringify({ error: { code: 400, message: 'API_KEY_INVALID' } }), { status: 400 });
        }
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ verdictNote: 'ok' }) }] } }]
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    BrevoMcpClient.resetInstanceForTesting();
    BrevoMcpClient.getInstance(globalThis.fetch);

    const okSendRes = await app.request('/api/v1/owner/first-sale/approve-and-send/draft_stagek_01', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(okSendRes.status).toBe(200);
    expect(brevoBodies.length).toBe(1);
    expect(brevoBodies[0].htmlContent).toContain('Hyderabad, Telangana');
    expect(brevoBodies[0].htmlContent).toContain('erasure?email=');

    // Seed 9 more SENT rows today UTC (total = 10), then attempt 11th draft -> 429
    const utcNowIso = new Date().toISOString();
    for (let i = 0; i < 9; i++) {
      db.prepare(`
        INSERT INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, dispatch_timestamp, response_status, created_at
        ) VALUES (?, 'biz_platform_aro', 'SITEFIX_AUDIT', 'Seed Roasters', 'EMAIL', 'Body', 1, 1, ?, 'DISPATCHED', datetime('now'))
      `).run(`draft_stagek_cap_${i}`, utcNowIso);
    }
    db.prepare(`
      INSERT INTO direct_outreach_log (
        id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, response_status, created_at
      ) VALUES ('draft_stagek_11', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Apex Roasters', 'EMAIL', 'Eleventh send', 0, 0, 'DRAFT_PENDING_APPROVAL', datetime('now'))
    `).run();

    const capRes = await app.request('/api/v1/owner/first-sale/approve-and-send/draft_stagek_11', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(capRes.status).toBe(429);
    const capJson = (await capRes.json()) as any;
    expect(capJson.error).toBe('OUTREACH_DAILY_CAP_REACHED');

    // 3. Gemini key isolation: RENDER=true strictly refuses fallback to API_KEY
    process.env.RENDER = 'true';
    process.env.GEMINI_API_KEY = 'bad_render_key';
    process.env.API_KEY = 'ai_studio_fallback_key';
    expect(GeminiProvider.getCandidateKeys()).toEqual(['bad_render_key']);
    const renderGemini = new GeminiProvider();
    await expect(
      renderGemini.generateStructured({
        agentId: 'test_agent',
        systemInstruction: 'Return JSON',
        prompt: 'hello render',
        skipCache: true
      })
    ).rejects.toThrow();
    expect(GeminiProvider.getHealthStatus().state).toBe('BLOCKED_KEY_INVALID');

    // Non-Render falls back cleanly to API_KEY and marks health OK
    delete process.env.RENDER;
    GeminiProvider.resetHealthForTesting();
    expect(GeminiProvider.getCandidateKeys()).toEqual(['bad_render_key', 'ai_studio_fallback_key']);
    const localGemini = new GeminiProvider();
    const localOut = await localGemini.generateStructured({
      agentId: 'test_agent',
      systemInstruction: 'Return JSON',
      prompt: 'hello local',
      skipCache: true
    });
    expect(localOut.data).toEqual({ verdictNote: 'ok' });
    expect(GeminiProvider.getHealthStatus().state).toBe('OK');

    // geminiHealth exposed on /api/v1/owner/today & /api/v1/public/autonomy-status
    const statusRes = await app.request('/api/v1/public/autonomy-status');
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as any;
    expect(statusJson.capabilityMatrix?.geminiAi?.health?.state).toBe('OK');

    const todayRes = await app.request('/api/v1/owner/today', {
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(todayRes.status).toBe(200);
    const todayJson = (await todayRes.json()) as any;
    expect(todayJson.data?.geminiHealth?.state).toBe('OK');

    // 4. Private audit returns 404 + X-Robots-Tag: noindex, nofollow without consent or ?token=
    db.prepare(`
      INSERT OR REPLACE INTO site_audits (
        domain, target_url, business_name, performance_score, seo_score, checklist_json, status, is_publicly_authorized, updated_at
      ) VALUES (
        'private-clinic.example', 'https://private-clinic.example', 'Private Clinic', 48, 55, '[]', 'COMPLETED', 0, datetime('now')
      )
    `).run();

    const privRes = await app.request('/audit/private-clinic.example');
    expect(privRes.status).toBe(404);
    expect(privRes.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');

    fetchSpy.mockRestore();
  });

  it('Stage L.1: Auto-repairs "Buy any 6 Perfumes at ₹799" Price/MRP swap, quarantines invalid rows, and renders /api/v1/public/comparisons/:slug', async () => {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO cuelinks_campaigns (
        campaign_id, name, merchant_domain, payout_rate, status, verification_source
      ) VALUES
      ('camp_perf_l', 'Bella Vita Organic', 'bellavitaorganic.com', '12%', 'ACTIVE', 'CUELINKS_API_V3'),
      ('camp_perf_l2', 'Mamaearth', 'mamaearth.in', '10%', 'ACTIVE', 'CUELINKS_API_V3')
    `).run();

    // Seed swapped deal row directly in SQLite (simulating upstream Shopify MRP bug ₹7794 stored as current_price_inr)
    db.prepare(`
      INSERT OR REPLACE INTO public_deals (
        id, slug, canonical_slug, title, brand, merchant, category, product_url,
        affiliate_url, current_price_inr, reference_price_inr, discount_percent,
        discount_verification_type, availability, verification_status,
        is_monetizable, product_verified, affiliate_verified, last_verified_at,
        evidence_json, sector_code, updated_at
      ) VALUES (
        'deal_perfume_swap_1', 'buy-any-6-perfumes-at-799', 'buy-any-6-perfumes-at-799',
        'Buy any 6 Perfumes at ₹799', 'Bella Vita', 'Bella Vita Organic', 'Personal Care',
        'https://bellavitaorganic.com/products/buy-any-6-perfumes-at-799',
        'https://linksredirect.com/?pub_id=281897CL264028&source=linkkit&url=https%3A%2F%2Fbellavitaorganic.com%2Fproducts%2Fbuy-any-6-perfumes-at-799',
        7794, NULL, 0, 'MERCHANT_LISTED_MRP', 'IN_STOCK', 'VERIFIED', 1, 1, 1, datetime('now'),
        '{"affiliateCampaignId":"camp_perf_l","affiliateNetwork":"CUELINKS"}', 'SECTOR_G_LIFESTYLE', datetime('now')
      ),
      (
        'deal_perfume_valid_2', 'mamaearth-ubtan-combo-pack', 'mamaearth-ubtan-combo-pack',
        'Mamaearth Ubtan Combo Kit', 'Mamaearth', 'Mamaearth', 'Personal Care',
        'https://mamaearth.in/product/ubtan-combo',
        'https://linksredirect.com/?pub_id=281897CL264028&source=linkkit&url=https%3A%2F%2Fmamaearth.in%2Fproduct%2Fubtan-combo',
        699, 1199, 42, 'MERCHANT_LISTED_MRP', 'IN_STOCK', 'VERIFIED', 1, 1, 1, datetime('now'),
        '{"affiliateCampaignId":"camp_perf_l2","affiliateNetwork":"CUELINKS","rawSpecs":{"Size":"200ml","Skin Type":"All"}}', 'SECTOR_G_LIFESTYLE', datetime('now')
      )
    `).run();

    // Unit-level quarantine assertions
    const badZero = repairTitlePriceMismatch({ title: 'Zero Price Deal', dealKind: 'PRODUCT', currentPriceINR: 0, affiliateNetwork: 'CUELINKS' });
    expect(badZero.quarantined).toBe(true);
    const badInverted = repairTitlePriceMismatch({ title: 'Inverted Deal', dealKind: 'PRODUCT', currentPriceINR: 1500, referencePriceINR: 999, affiliateNetwork: 'CUELINKS' });
    expect(badInverted.quarantined).toBe(true);

    AutonomousSystemDoctor.resetForTesting();
    const report = await AutonomousSystemDoctor.getInstance().runSelfHealingPass({ skipRecoveryRecursion: true, skipLlm: true });
    expect(report.priceRepair.repairedCount).toBeGreaterThanOrEqual(1);

    const fixedRow = db.prepare(`SELECT current_price_inr, reference_price_inr, discount_percent FROM public_deals WHERE id = 'deal_perfume_swap_1'`).get() as any;
    expect(fixedRow.current_price_inr).toBe(799);
    expect(fixedRow.reference_price_inr).toBe(7794);
    expect(fixedRow.discount_percent).toBe(90);

    // Check /api/v1/public/comparisons and /api/v1/public/comparisons/:slug
    const listRes = await app.request('/api/v1/public/comparisons');
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as any;
    expect(listJson.data.length).toBeGreaterThan(0);

    const compSlug = listJson.data[0].comparisonSlug;
    const detailRes = await app.request(`/api/v1/public/comparisons/${encodeURIComponent(compSlug)}`);
    expect(detailRes.status).toBe(200);
    const detailJson = (await detailRes.json()) as any;
    expect(detailJson.data.dealA.amazonCtaLabel).toContain("Check Today's Live Price & Prime Coupons on Amazon.in");
    expect(detailJson.data.dealA.rail1RedirectUrl).toContain('/redirect');

    const missingComp = await app.request('/api/v1/public/comparisons/nonexistent-vs-pair');
    expect(missingComp.status).toBe(404);
  });

  it('Stage L.2: Disqualifies national corporations, reroutes WHATSAPP -> EMAIL when Brevo ready, exposes System Doctor /heal + ready-actions', async () => {
    process.env.OWNER_API_KEY = 'stagek_explicit_owner_secret_001';
    process.env.BREVO_API_KEY = 'xkeysib_stagel_test';
    delete process.env.WHATSAPP_API_TOKEN;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_BSP_API_KEY;

    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO site_audits (
        domain, target_url, business_name, performance_score, seo_score, checklist_json, status, is_publicly_authorized, updated_at
      ) VALUES
      ('careerlauncher.com', 'https://careerlauncher.com', 'Career Launcher', 62, 70, '[{"status":"FAIL"}]', 'COMPLETED', 0, datetime('now')),
      ('craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 'Craft Coffee Roasters', 52, 58, '{"items":[{"status":"FAIL"},{"status":"WARNING"}],"prospect_signals":{"prospectTriggerScore":4,"hasReachableEmail":true,"discoveredEmails":["hello@craftcoffeeroasters.in"]}}', 'COMPLETED', 0, datetime('now'))
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO platform_prospects (
        id, business_name, prospect_business_name, prospect_city, prospect_vertical,
        email, prospect_email, phone, prospect_phone, website_url, prospect_website, stage, status
      ) VALUES
      ('pros_cl_l', 'Career Launcher', 'Career Launcher', 'Delhi', 'edtech', 'info@careerlauncher.com', 'info@careerlauncher.com', '+919800000001', '+919800000001', 'https://careerlauncher.com', 'https://careerlauncher.com', 'DISCOVERED', 'NEW'),
      ('pros_smb_l', 'Craft Coffee Roasters', 'Craft Coffee Roasters', 'Hyderabad', 'specialty_coffee', 'hello@craftcoffeeroasters.in', 'hello@craftcoffeeroasters.in', '+919800000002', '+919800000002', 'https://craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 'DISCOVERED', 'NEW')
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO direct_outreach_log (
        id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, response_status, created_at
      ) VALUES
      ('draft_ent_l', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Career Launcher', 'WHATSAPP', 'Audit ready', 0, 0, 'DRAFT_PENDING_APPROVAL', datetime('now')),
      ('draft_smb_l', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Craft Coffee Roasters', 'WHATSAPP', 'Audit ready for your studio.', 0, 0, 'DRAFT_PENDING_APPROVAL', datetime('now'))
    `).run();

    const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
    const healRes = await app.request('/api/v1/owner/system-doctor/heal', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ skipLlm: true })
    });
    expect(healRes.status).toBe(200);
    const healJson = (await healRes.json()) as any;
    expect(healJson.data.outreachRepair.disqualifiedEnterpriseCount).toBeGreaterThanOrEqual(1);
    expect(healJson.data.outreachRepair.reroutedToEmailCount).toBeGreaterThanOrEqual(1);

    // Verify SMB draft was rerouted to EMAIL with signed /audit/ link while preserving human_approved = 0 & dispatched = 0
    const smbRow = db.prepare(`SELECT channel, human_approved, dispatched, message_draft FROM direct_outreach_log WHERE id = 'draft_smb_l'`).get() as any;
    expect(smbRow.channel).toBe('EMAIL');
    expect(smbRow.human_approved).toBe(0);
    expect(smbRow.dispatched).toBe(0);
    expect(smbRow.message_draft).toContain('/audit/craftcoffeeroasters.in?token=');

    const entRow = db.prepare(`SELECT response_status, human_approved, dispatched FROM direct_outreach_log WHERE id = 'draft_ent_l'`).get() as any;
    expect(entRow.response_status).toBe('DISQUALIFIED_NATIONAL_ENTERPRISE');
    expect(entRow.human_approved).toBe(0);
    expect(entRow.dispatched).toBe(0);

    // Verify ready-actions excludes careerlauncher.com and attaches mailtoUrl & whatsappShareUrl
    const readyRes = await app.request('/api/v1/owner/first-sale/ready-actions', {
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(readyRes.status).toBe(200);
    const readyJson = (await readyRes.json()) as any;
    const auditDomains = (readyJson.data.readyAudits || []).map((a: any) => a.domain);
    expect(auditDomains).toContain('craftcoffeeroasters.in');
    expect(auditDomains).not.toContain('careerlauncher.com');
    const craftAudit = readyJson.data.readyAudits.find((a: any) => a.domain === 'craftcoffeeroasters.in');
    expect(craftAudit.mailtoUrl).toContain('mailto:hello%40craftcoffeeroasters.in');
    expect(craftAudit.whatsappShareUrl).toContain('https://wa.me/');
  });

  it('Stage L.3: GeminiProvider cascades across free models on 429 and ExperimentEngine forwards telemetry to CommercialLearningEngine', async () => {
    process.env.GEMINI_API_KEY = 'stagel_valid_key';
    delete process.env.API_KEY;
    GeminiProvider.resetHealthForTesting();

    const calledModels: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      const match = url.match(/\/models\/([^:]+):generateContent/);
      if (match) calledModels.push(match[1]);
      if (calledModels.length === 1) {
        return new Response(JSON.stringify({ error: { code: 429, message: 'RESOURCE_EXHAUSTED' } }), { status: 429 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ fix: 'cascaded_ok' }) }] } }]
      }), { status: 200 });
    });

    const gem = new GeminiProvider();
    const res = await gem.generateStructured<{ fix: string }>({
      agentId: 'stagel_cascade_test',
      systemInstruction: 'Return JSON',
      prompt: 'test cascade',
      skipCache: true
    });
    expect(res.data.fix).toBe('cascaded_ok');
    expect(calledModels.length).toBe(2);
    expect(calledModels[1]).toBe('gemini-2.5-flash');
    fetchSpy.mockRestore();

    // ExperimentEngine -> CommercialLearningEngine signal hook
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Owner Org', 'owner-primary')`).run();
    db.prepare(`
      INSERT OR IGNORE INTO businesses (
        id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier,
        country, currency, timezone, city, neighborhood, brand_voice, autonomy_mode, kill_switch_active, public_live
      ) VALUES (
        'biz_platform_aro', 'org_owner_primary', 'Platform ARO', 'platform-aro', 'TECHNOLOGY', 'Technology', 'LOW',
        'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills', 'Direct', 'ASSISTED', 0, 0
      )
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO experiments (
        id, organization_id, business_id, title, hypothesis, baseline, treatment,
        success_metric, minimum_evidence_requirement, expected_effect, start_date, status, metrics_json
      ) VALUES (
        'exp_stagel_01', 'org_owner_primary', 'biz_platform_aro', 'Storefront CTA',
        'Green CTA lifts clicks', 'Buy Now', 'Claim Verified Price',
        'outbound_clicks', 20, '+20% CTR', datetime('now'), 'RUNNING',
        '{"storefrontSlot":"deal_card","baselineSamples":5,"baselineConversions":0,"treatmentSamples":5,"treatmentConversions":4,"sectorCode":"SECTOR_B_ELECTRONICS"}'
      )
    `).run();
    const beforeState = CommercialLearningEngine.getInstance().getSectorBanditIntelligence()['SECTOR_B_ELECTRONICS'];
    const evalOut = ExperimentEngine.evaluateFromTelemetry('exp_stagel_01', {
      baselineSamples: 60,
      baselineConversions: 2,
      treatmentSamples: 60,
      treatmentConversions: 20
    });
    await new Promise(r => setTimeout(r, 40));
    const afterState = CommercialLearningEngine.getInstance().getSectorBanditIntelligence()['SECTOR_B_ELECTRONICS'];
    expect(evalOut.outcome).toBe('SCALE');
    expect(evalOut.pVal).toBeLessThan(0.05);
    expect(afterState.alpha).toBeGreaterThan(beforeState.alpha);
  });

  it('Stage M.1: Purges static Amazon INR prices, excludes AMAZON_IN from public feeds & ready-actions, and exposes systemDoctorSummary on /autonomy-status without PII', async () => {
    process.env.OWNER_API_KEY = 'stagek_explicit_owner_secret_001';
    process.env.AMAZON_AFFILIATE_TAG = 'stagem-21';

    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO public_deals (
        id, slug, canonical_slug, title, brand, merchant, category, product_url,
        affiliate_url, current_price_inr, reference_price_inr, discount_percent,
        discount_verification_type, availability, verification_status,
        is_monetizable, product_verified, affiliate_verified, last_verified_at,
        evidence_json, sector_code, updated_at
      ) VALUES
      (
        'deal_amz_b09xs7jwhh', 'sony-wh-1000xm5', 'sony-wh-1000xm5',
        'Sony WH-1000XM5 Wireless ANC Headphones', 'Sony', 'Amazon India', 'Audio',
        'https://www.amazon.in/dp/B09XS7JWHH',
        'https://www.amazon.in/dp/B09XS7JWHH?tag=stagem-21',
        19989, 29990, 33, 'MERCHANT_LISTED_MRP', 'IN_STOCK', 'VERIFIED', 1, 1, 1, datetime('now'),
        '{"affiliateNetwork":"AMAZON_IN"}', 'SECTOR_B_ELECTRONICS', datetime('now')
      ),
      (
        'deal_boat_tws_m1', 'boat-airdopes-141', 'boat-airdopes-141',
        'boAt Airdopes 141 ANC Wireless Earbuds', 'boAt', 'boAt Lifestyle', 'Audio',
        'https://www.boat-lifestyle.com/products/airdopes-141',
        'https://linksredirect.com/?pub_id=281897CL264028&source=linkkit&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-141',
        1299, 4490, 71, 'MERCHANT_LISTED_MRP', 'IN_STOCK', 'VERIFIED', 1, 1, 1, datetime('now'),
        '{"affiliateCampaignId":"camp_audio_m1","affiliateNetwork":"CUELINKS"}', 'SECTOR_B_ELECTRONICS', datetime('now')
      )
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO site_audits (
        domain, target_url, business_name, performance_score, seo_score, checklist_json, status, is_publicly_authorized, updated_at
      ) VALUES
      ('craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 'Craft Coffee Roasters', 52, 58, '{"items":[{"status":"ISSUE","title":"Missing Schema"}],"prospect_signals":{"prospectTriggerScore":4,"hasReachableEmail":true,"discoveredEmails":["hello@craftcoffeeroasters.in"]}}', 'COMPLETED', 0, datetime('now'))
    `).run();

    AutonomousSystemDoctor.resetForTesting();
    const report = await AutonomousSystemDoctor.getInstance().runSelfHealingPass({ skipRecoveryRecursion: true, skipLlm: true });
    expect(report.priceRepair.amazonStaticPricesPurged).toBeGreaterThanOrEqual(1);

    const amzRow = db.prepare(`SELECT current_price_inr, reference_price_inr, discount_percent FROM public_deals WHERE id = 'deal_amz_b09xs7jwhh'`).get() as any;
    expect(amzRow.current_price_inr).toBe(0);
    expect(amzRow.reference_price_inr).toBeNull();
    expect(amzRow.discount_percent).toBe(0);

    // Public feed & ready-actions must exclude static Amazon price row
    const dealsRes = await app.request('/api/v1/public/deals?limit=50');
    expect(dealsRes.status).toBe(200);
    const dealsJson = (await dealsRes.json()) as any;
    const feedIds = (dealsJson.data.deals || []).map((d: any) => d.id);
    expect(feedIds).not.toContain('deal_amz_b09xs7jwhh');
    expect(feedIds).toContain('deal_boat_tws_m1');

    // Autonomy status exposes non-sensitive systemDoctorSummary & indexNowStatus
    const statusRes = await app.request('/api/v1/public/autonomy-status');
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as any;
    expect(statusJson.systemDoctorSummary).toBeDefined();
    expect(statusJson.systemDoctorSummary.amazonStaticPricesPurged).toBeGreaterThanOrEqual(1);
    expect(statusJson.indexNowStatus).toBe('AWAITING_INDEXNOW_KEY');
    const previewTopDeals = statusJson.systemDoctorSummary.topDealsPreview || [];
    expect(previewTopDeals.every((d: any) => d.affiliateNetwork !== 'AMAZON_IN')).toBe(true);
    const previewAudits = statusJson.systemDoctorSummary.topSmbAuditsPreview || [];
    for (const a of previewAudits) {
      expect(a).not.toHaveProperty('email');
      expect(a).not.toHaveProperty('phone');
    }

    // Owner ready-actions Top 5 must exclude AMAZON_IN
    const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
    const readyRes = await app.request('/api/v1/owner/first-sale/ready-actions', {
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(readyRes.status).toBe(200);
    const readyJson = (await readyRes.json()) as any;
    expect((readyJson.data.topDeals || []).some((d: any) => d.affiliateNetwork === 'AMAZON_IN')).toBe(false);
  });

  it('Stage M.2: Serves /api/v1/public/buyer-guides, SSR /best/:intentSlug (Schema.org ItemList + FAQPage + Dual-Rail), 404 for unknown slug, and /sitemap.xml inclusion', async () => {
    process.env.AMAZON_AFFILIATE_TAG = 'stagem-21';
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO public_deals (
        id, slug, canonical_slug, title, brand, merchant, category, product_url,
        affiliate_url, current_price_inr, reference_price_inr, discount_percent,
        discount_verification_type, availability, verification_status,
        is_monetizable, product_verified, affiliate_verified, last_verified_at,
        evidence_json, sector_code, updated_at
      ) VALUES
      (
        'deal_earbud_1', 'boat-airdopes-141-anc', 'boat-airdopes-141-anc',
        'boAt Airdopes 141 ANC Wireless Earbuds', 'boAt', 'boAt Lifestyle', 'Audio',
        'https://www.boat-lifestyle.com/products/airdopes-141',
        'https://linksredirect.com/?pub_id=281897CL264028&source=linkkit&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-141',
        1299, 4490, 71, 'MERCHANT_LISTED_MRP', 'IN_STOCK', 'VERIFIED', 1, 1, 1, datetime('now'),
        '{"affiliateCampaignId":"camp_audio_1","affiliateNetwork":"CUELINKS"}', 'SECTOR_B_ELECTRONICS', datetime('now')
      ),
      (
        'deal_earbud_2', 'noise-buds-vs104-pro', 'noise-buds-vs104-pro',
        'Noise Buds VS104 Pro TWS Earbuds', 'Noise', 'GoNoise Store', 'Audio',
        'https://www.gonoise.com/products/buds-vs104-pro',
        'https://linksredirect.com/?pub_id=281897CL264028&source=linkkit&url=https%3A%2F%2Fwww.gonoise.com%2Fproducts%2Fbuds-vs104-pro',
        1499, 3499, 57, 'MERCHANT_LISTED_MRP', 'IN_STOCK', 'VERIFIED', 1, 1, 1, datetime('now'),
        '{"affiliateCampaignId":"camp_audio_2","affiliateNetwork":"CUELINKS"}', 'SECTOR_B_ELECTRONICS', datetime('now')
      )
    `).run();

    const listRes = await app.request('/api/v1/public/buyer-guides');
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as any;
    expect(listJson.success).toBe(true);
    const slugs = (listJson.data || []).map((h: any) => h.intentSlug);
    expect(slugs).toContain('audio-and-earbuds-under-2000');

    const ssrRes = await app.request('/best/audio-and-earbuds-under-2000');
    expect(ssrRes.status).toBe(200);
    const html = await ssrRes.text();
    expect(html).toContain('application/ld+json');
    expect(html).toContain('ItemList');
    expect(html).toContain('FAQPage');
    expect(html).toContain('/api/v1/public/amazon-redirect');
    expect(html).toContain('Best Overall Value');

    const missingRes = await app.request('/best/nonexistent-buyer-hub-xyz');
    expect(missingRes.status).toBe(404);
    const missingHtml = await missingRes.text();
    expect(missingHtml).toContain('noindex, nofollow');

    const sitemapRes = await app.request('/sitemap.xml');
    expect(sitemapRes.status).toBe(200);
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain('/best/audio-and-earbuds-under-2000');
  });

  it('Stage M.3: Validates POST /api/v1/tools/site-audit/send-report consent + records OPTED_IN_FIRST_PARTY + dispatches Brevo email', async () => {
    process.env.SITE_AUDIT_SIGNING_SECRET = 'stage_m_signing_secret_32_characters_minimum_valid_key';
    process.env.BREVO_API_KEY = 'xkeysib_stagem_test';

    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Owner Org', 'owner-primary')`).run();
    db.prepare(`
      INSERT OR IGNORE INTO businesses (
        id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier,
        country, currency, timezone, city, neighborhood, brand_voice, autonomy_mode, kill_switch_active, public_live
      ) VALUES (
        'biz_platform_aro', 'org_owner_primary', 'Platform ARO', 'platform-aro', 'TECHNOLOGY', 'Technology', 'LOW',
        'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills', 'Direct', 'ASSISTED', 0, 0
      )
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO site_audits (
        domain, target_url, business_name, performance_score, seo_score, checklist_json, status, is_publicly_authorized, updated_at
      ) VALUES (
        'craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 'Craft Coffee Roasters', 55, 62,
        '[{"id":"schema","title":"Missing LocalBusiness Schema","status":"ISSUE","severity":"HIGH","recommendation":"Add Schema.org JSON-LD"}]',
        'COMPLETED', 0, datetime('now')
      )
    `).run();

    // Missing consent -> 400
    const noConsentRes = await app.request('/api/v1/tools/site-audit/send-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domainOrUrl: 'craftcoffeeroasters.in',
        email: 'owner@craftcoffeeroasters.in',
        consentGiven: false
      })
    });
    expect(noConsentRes.status).toBe(400);

    // Private SSRF IP -> 400
    const ssrfRes = await app.request('/api/v1/tools/site-audit/send-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domainOrUrl: 'http://127.0.0.1/admin',
        email: 'owner@craftcoffeeroasters.in',
        consentGiven: true
      })
    });
    expect(ssrfRes.status).toBe(400);

    // Valid opt-in submission -> 200 + outbound_contacts + Brevo dispatch
    const brevoSpy = vi.spyOn(BrevoMcpClient.getInstance(), 'sendTransactionalEmail').mockResolvedValue({
      success: true,
      status: 'SENT',
      messageId: 'msg_stagem_123'
    });

    const okRes = await app.request('/api/v1/tools/site-audit/send-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domainOrUrl: 'craftcoffeeroasters.in',
        email: 'owner@craftcoffeeroasters.in',
        consentGiven: true
      })
    });
    expect(okRes.status).toBe(200);
    const okJson = (await okRes.json()) as any;
    expect(okJson.success).toBe(true);
    expect(okJson.emailDispatched).toBe(true);
    expect(okJson.consentStatus).toBe('OPTED_IN_FIRST_PARTY');
    expect(okJson.sourceHost).toBe('FIRST_PARTY_SITE_AUDIT');
    expect(okJson.previewUrl).toContain('/audit/craftcoffeeroasters.in?token=');
    expect(brevoSpy).toHaveBeenCalledTimes(1);

    const contactRow = db.prepare(`SELECT authorization_source, source, authorization_evidence_json FROM outbound_contacts WHERE prospect_email = 'owner@craftcoffeeroasters.in'`).get() as any;
    expect(contactRow).toBeDefined();
    expect(contactRow.authorization_source).toBe('INBOUND_REQUEST');
    expect(contactRow.source).toBe('FIRST_PARTY_SITE_AUDIT');
    expect(contactRow.authorization_evidence_json).toContain('OPTED_IN_FIRST_PARTY');
  });

  it('Stage M.4: submitIndexNowUrls guards on RENDER === "true" and submits with 5s timeout cleanly', async () => {
    const dist = OrganicDistributionEngine.getInstance();
    process.env.INDEXNOW_KEY = 'ab12cd34ef56gh78';
    delete process.env.RENDER;

    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const nonRenderRes = await dist.submitIndexNowUrls(['https://ai-marketing-organization.onrender.com/best/audio-and-earbuds-under-2000'], mockFetch as any);
    expect(nonRenderRes.status).toBe('SKIPPED_NON_RENDER_ENV');
    expect(nonRenderRes.submitted).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();

    process.env.RENDER = 'true';
    const renderRes = await dist.submitIndexNowUrls(['https://ai-marketing-organization.onrender.com/best/audio-and-earbuds-under-2000'], mockFetch as any);
    expect(renderRes.status).toBe('SUBMITTED');
    expect(renderRes.submitted).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('Stage N.1: Instagram Business OAuth callback (#_ strip + access_denied), 60-day refresh, social publisher guard & Comment-to-DM webhook reply', async () => {
    InstagramBusinessAdapter.resetInstance();
    process.env.INSTAGRAM_APP_ID = 'ig_app_12345';
    process.env.INSTAGRAM_APP_SECRET = 'ig_secret_abcde';
    process.env.INSTAGRAM_HANDLE = 'bestdeals0162';
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = 'ig_verify_token_stagen';

    // 1. OAuth authorize redirect & /oauth/url popup JSON endpoint have required 4 post-2025 scopes
    const authRes = await app.request('/api/v1/integrations/instagram/oauth/authorize');
    expect(authRes.status).toBe(302);
    const location = authRes.headers.get('location') || '';
    expect(location).toContain('instagram.com/oauth/authorize');
    expect(location).toContain('instagram_business_basic');
    expect(location).toContain('instagram_business_content_publish');
    expect(location).toContain('instagram_business_manage_messages');
    expect(location).toContain('instagram_business_manage_comments');

    const urlRes = await app.request(
      '/api/v1/integrations/instagram/oauth/url?redirect_uri=' +
        encodeURIComponent('https://ais-dev-demo.asia-southeast1.run.app/api/v1/integrations/instagram/oauth/callback')
    );
    expect(urlRes.status).toBe(200);
    const urlJson = (await urlRes.json()) as any;
    expect(urlJson.success).toBe(true);
    expect(urlJson.data?.url).toContain('instagram.com/oauth/authorize');
    expect(urlJson.data?.callbackUrl).toBe('https://ais-dev-demo.asia-southeast1.run.app/api/v1/integrations/instagram/oauth/callback');
    expect(urlJson.data?.scopes).toEqual([
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
      'instagram_business_content_publishing'
    ]);

    // 2. Access denied query safely fails without 500 (including trailing-slash & popup HTML postMessage)
    const deniedRes = await app.request('/api/v1/integrations/instagram/oauth/callback?error=access_denied&error_description=User+cancelled');
    expect(deniedRes.status).toBe(400);
    const deniedJson = (await deniedRes.json()) as any;
    expect(deniedJson.success).toBe(false);
    expect(deniedJson.data.error).toBe('access_denied');

    const deniedHtmlRes = await app.request('/api/v1/integrations/instagram/oauth/callback/?error=access_denied', {
      headers: { Accept: 'text/html' }
    });
    expect(deniedHtmlRes.status).toBe(400);
    const deniedHtml = await deniedHtmlRes.text();
    expect(deniedHtml).toContain('INSTAGRAM_OAUTH_ERROR');
    expect(deniedHtml).toContain('window.opener.postMessage');

    // 3. OAuth callback strips trailing #_ from code and upgrades short->60-day token
    const seenCodes: string[] = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/oauth/access_token')) {
        const bodyStr = String(init?.body || '');
        const params = new URLSearchParams(bodyStr);
        seenCodes.push(params.get('code') || '');
        return new Response(JSON.stringify({ access_token: 'short_tok_1', user_id: '178414000001' }), { status: 200 });
      }
      if (url.includes('grant_type=ig_exchange_token')) {
        return new Response(JSON.stringify({ access_token: 'long_60d_tok_1', expires_in: 5184000 }), { status: 200 });
      }
      if (url.includes('/me?') || url.endsWith('/me')) {
        return new Response(JSON.stringify({ id: '178414000001', username: 'bestdeals0162' }), { status: 200 });
      }
      if (url.includes('grant_type=ig_refresh_token')) {
        return new Response(JSON.stringify({ access_token: 'refreshed_60d_tok_2', expires_in: 5184000 }), { status: 200 });
      }
      if (url.includes('/media_publish')) {
        return new Response(JSON.stringify({ id: 'media_pub_999' }), { status: 200 });
      }
      if (url.includes('/media')) {
        return new Response(JSON.stringify({ id: 'creation_111' }), { status: 200 });
      }
      if (url.includes('/messages')) {
        return new Response(JSON.stringify({ recipient_id: 'cmt_1', message_id: 'mid_reply_1' }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const adapter = new InstagramBusinessAdapter({ fetchFn: mockFetch });
    const cbRes = await adapter.handleOAuthCallback({ code: 'AQCodeTrailing#_ ' });
    expect(cbRes.ok).toBe(true);
    expect(seenCodes[0]).toBe('AQCodeTrailing');
    expect(cbRes.igUserId).toBe('178414000001');

    // 4. Rejects deal with social_media_publishers_allowed === false
    const blockedPub = await adapter.publishDealToInstagram({
      id: 'deal_no_social',
      title: 'Restricted Merchant Deal',
      merchant: 'RestrictedStore',
      currentPriceINR: 1999,
      productVerified: true,
      socialMediaPublishersAllowed: false
    });
    expect(blockedPub.ok).toBe(false);
    expect(blockedPub.blocked).toBe(true);
    expect(blockedPub.reason).toBe('SOCIAL_MEDIA_PUBLISHER_NOT_ALLOWED');

    // 5. Publishes verified deal with #Ad caption
    const okPub = await adapter.publishDealToInstagram({
      id: 'deal_ig_ok',
      title: 'boAt Airdopes 141 ANC',
      merchant: 'boAt Lifestyle',
      currentPriceINR: 1299,
      referencePriceINR: 4490,
      productVerified: true,
      socialMediaPublishersAllowed: true,
      imageUrl: 'https://images.boat-lifestyle.com/products/airdopes-141.png'
    });
    expect(okPub.ok).toBe(true);
    expect(okPub.mediaId).toBe('media_pub_999');
    expect(okPub.caption).toContain('#Ad');

    // 6. Webhook GET verification + POST Comment-to-DM Dual-Rail reply
    const whGet = await app.request('/api/v1/webhooks/instagram?hub.mode=subscribe&hub.verify_token=ig_verify_token_stagen&hub.challenge=chal_999');
    expect(whGet.status).toBe(200);
    expect(await whGet.text()).toBe('chal_999');

    const whBad = await app.request('/api/v1/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=chal_999');
    expect(whBad.status).toBe(403);

    process.env.AMAZON_AFFILIATE_TAG = 'stagen-21';
    const whPost = await adapter.handleWebhookPayload({
      entry: [{
        changes: [{ field: 'comments', value: { id: 'cmt_1', text: 'Send DEAL link please!' } }],
        messaging: [{ sender: { id: 'user_dm_22' }, message: { mid: 'mid_in_22', text: 'PRICE please' } }]
      }]
    });
    expect(whPost.processed).toBe(2);
    expect(whPost.repliesSent).toBe(2);

    // 7. 60-day refresh fires when forceIfAgeDaysGt is exceeded (-1 tests refresh call cleanly)
    const refreshRes = await adapter.refreshLongLivedTokenIfNeeded(mockFetch, -1);
    expect(refreshRes.refreshed).toBe(true);
  });

  it('Stage N.2: Serves mobile-first /ig & /bestdeals storefronts and JSON-RPC 2.0 /api/v1/mcp without leaking PII', async () => {
    process.env.AMAZON_AFFILIATE_TAG = 'stagen-21';
    process.env.SITE_AUDIT_SIGNING_SECRET = 'stagen_signing_secret_32_characters_minimum_valid_key';
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO public_deals (
        id, slug, canonical_slug, title, brand, merchant, category, product_url,
        affiliate_url, current_price_inr, reference_price_inr, discount_percent,
        discount_verification_type, availability, verification_status,
        is_monetizable, product_verified, affiliate_verified, last_verified_at,
        evidence_json, sector_code, updated_at
      ) VALUES (
        'deal_ig_storefront_1', 'noise-colorfit-ultra-3', 'noise-colorfit-ultra-3',
        'Noise ColorFit Ultra 3 AMOLED Smartwatch', 'Noise', 'GoNoise Store', 'Wearables',
        'https://www.gonoise.com/products/colorfit-ultra-3',
        'https://linksredirect.com/?pub_id=281897CL264028&source=linkkit&url=https%3A%2F%2Fwww.gonoise.com%2Fproducts%2Fcolorfit-ultra-3',
        2499, 5999, 58, 'MERCHANT_LISTED_MRP', 'IN_STOCK', 'VERIFIED', 1, 1, 1, datetime('now'),
        '{"affiliateCampaignId":"camp_n2","affiliateNetwork":"CUELINKS","socialMediaPublishersAllowed":true}', 'SECTOR_B_ELECTRONICS', datetime('now')
      )
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO site_audits (
        domain, target_url, business_name, performance_score, seo_score, checklist_json, status, is_publicly_authorized, updated_at
      ) VALUES (
        'hyderabadroasters.in', 'https://hyderabadroasters.in', 'Hyderabad Roasters', 48, 55,
        '{"items":[{"status":"ISSUE","title":"Missing Schema"}],"prospect_signals":{"prospectTriggerScore":7,"hasReachableEmail":true,"discoveredEmails":["hello@hyderabadroasters.in"],"triggerTags":["RUNNING_META_OR_GOOGLE_ADS","MISSING_WHATSAPP_CTA_LEAK"]}}',
        'COMPLETED', 0, datetime('now')
      )
    `).run();

    const igRes = await app.request('/ig');
    expect(igRes.status).toBe(200);
    const igHtml = await igRes.text();
    expect(igHtml).toContain('@bestdeals0162');
    expect(igHtml).toContain('#Ad Disclosure');
    expect(igHtml).toContain('Noise ColorFit Ultra 3');
    expect(igHtml).toContain('/api/v1/public/amazon-redirect');

    const bestDealsRes = await app.request('/bestdeals');
    expect(bestDealsRes.status).toBe(200);

    // MCP requires owner authentication (401 unauthenticated)
    const unauthMcp = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    expect(unauthMcp.status).toBe(401);

    const mcpSession = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');

    // MCP JSON-RPC tools/list
    const mcpList = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mcpSession.token}`
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    expect(mcpList.status).toBe(200);
    const mcpListJson = (await mcpList.json()) as any;
    const toolNames = (mcpListJson.result?.tools || []).map((t: any) => t.name);
    expect(toolNames).toEqual([
      'get_top_verified_deals',
      'check_fair_price',
      'get_ready_sitefix_audits',
      'get_autonomy_and_doctor_status'
    ]);

    // MCP tools/call -> get_ready_sitefix_audits returns trigger score with zero PII
    const mcpAudits = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mcpSession.token}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_ready_sitefix_audits', arguments: { limit: 5 } }
      })
    });
    expect(mcpAudits.status).toBe(200);
    const mcpAuditsJson = (await mcpAudits.json()) as any;
    const returnedAudits = mcpAuditsJson.result?.structuredContent?.audits || [];
    expect(returnedAudits.length).toBeGreaterThanOrEqual(1);
    expect(returnedAudits[0].domain).toBe('hyderabadroasters.in');
    expect(returnedAudits[0].prospectTriggerScore).toBe(7);
    expect(returnedAudits[0]).not.toHaveProperty('email');
    expect(returnedAudits[0]).not.toHaveProperty('phone');
  });

  it('Stage N.3: Enforces Cuelinks per_page=100 & UNKNOWN payout default, >=50/arm experiment guard, Prospect Trigger Scoring & Doctor Fake CPS purge', async () => {
    // 1. CuelinksV3Client uses per_page=100 and returns payoutType 'UNKNOWN' when numeric payout is missing
    const seenUrls: string[] = [];
    const cuelinksClient = new CuelinksV3Client({
      apiKey: 'test_cue_key',
      fetchFn: (async (url: string) => {
        seenUrls.push(url);
        return new Response(JSON.stringify({
          campaigns: [{ id: 888, name: 'ZeroPayoutBrand', payout_categories: [] }],
          total_count: 1
        }), { status: 200 });
      }) as unknown as typeof fetch
    });
    const res = await cuelinksClient.searchCampaigns({});
    expect(seenUrls[0]).toContain('per_page=100');
    const syncMgr = CuelinksSyncManager.getInstance(cuelinksClient);
    const payout = syncMgr.extractCampaignPayout(res.campaigns[0]);
    expect(payout.payoutModel).toBe('UNKNOWN');

    // 2. ExperimentEngine rejects early stop/scale when < 50 samples per arm and ignores isTest / diagnosticProbe
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Owner Org', 'owner-primary')`).run();
    db.prepare(`
      INSERT OR REPLACE INTO experiments (
        id, organization_id, business_id, title, hypothesis, baseline, treatment,
        success_metric, minimum_evidence_requirement, expected_effect, start_date, status, metrics_json
      ) VALUES (
        'exp_guard_n3', 'org_owner_primary', 'biz_platform_aro', 'Sample Guard Test',
        'Test', 'A', 'B', 'clicks', 50, '+10%', datetime('now'), 'RUNNING',
        '{"storefrontSlot":"deal_card","baselineSamples":0,"baselineConversions":0,"treatmentSamples":0,"treatmentConversions":0}'
      )
    `).run();

    const smallEval = ExperimentEngine.evaluateFromTelemetry('exp_guard_n3', {
      baselineSamples: 25,
      baselineConversions: 1,
      treatmentSamples: 25,
      treatmentConversions: 15
    });
    expect(smallEval.outcome).toBe('INCONCLUSIVE');

    // Insert 60 diagnostic/test events directly into analytics_events on a fresh experiment and ensure evaluateFromTelemetry ignores all 60
    db.prepare(`
      INSERT OR REPLACE INTO experiments (
        id, organization_id, business_id, title, hypothesis, baseline, treatment,
        success_metric, minimum_evidence_requirement, expected_effect, start_date, status, metrics_json
      ) VALUES (
        'exp_guard_n3_diag', 'org_owner_primary', 'biz_platform_aro', 'Diag Exclusion Test',
        'Test', 'A', 'B', 'clicks', 50, '+10%', datetime('now'), 'RUNNING',
        '{"storefrontSlot":"deal_card","baselineSamples":0,"baselineConversions":0,"treatmentSamples":0,"treatmentConversions":0}'
      )
    `).run();
    for (let i = 0; i < 60; i++) {
      db.prepare(`
        INSERT INTO analytics_events (id, organization_id, business_id, channel, event_type, metadata_json, created_at)
        VALUES (?, 'org_owner_primary', 'biz_platform_aro', 'STOREFRONT_WEB', 'impression', ?, datetime('now'))
      `).run(
        `ev_diag_${i}`,
        JSON.stringify({ experimentId: 'exp_guard_n3_diag', variant: 'treatment', isTest: i % 2 === 0, diagnosticProbe: i % 2 === 1 })
      );
    }
    const ignoredTestEval = ExperimentEngine.evaluateFromTelemetry('exp_guard_n3_diag');
    expect(ignoredTestEval.outcome).toBe('INCONCLUSIVE');
    expect(ignoredTestEval.metrics?.treatmentSamples || 0).toBe(0);

    // 3. SiteAuditScanner.detectProspectSignals (+3 ads, +2 missing WA/booking CTA, +2 reachable email, +1 >=2 tech SEO defects = 8)
    const scanner = new SiteAuditScanner();
    const smbSig = scanner.detectProspectSignals(
      '<html><head><script src="https://connect.facebook.net/en_US/fbevents.js"></script></head><body><p>Welcome to Bright Craft Studio. Email us at care@brightcraftstudio.in</p></body></html>',
      'brightcraftstudio.in',
      [
        { id: 'f1', category: 'HTML_METADATA', title: 'Missing Meta', status: 'ISSUE', severity: 'HIGH', location: 'head', evidence: '', explanation: '', recommendation: '', confidence: 90, canAutoGenerate: true, needsUserConfirmation: false },
        { id: 'f2', category: 'STRUCTURED_DATA', title: 'Missing Schema', status: 'ISSUE', severity: 'HIGH', location: 'head', evidence: '', explanation: '', recommendation: '', confidence: 90, canAutoGenerate: true, needsUserConfirmation: false }
      ]
    );
    expect(smbSig.prospectTriggerScore).toBe(8);
    expect(smbSig.triggerTags).toContain('RUNNING_META_OR_GOOGLE_ADS');
    expect(smbSig.triggerTags).toContain('MISSING_WHATSAPP_OR_BOOKING_CTA');

    const enterpriseSig = scanner.detectProspectSignals(
      '<html></html>',
      'apollo247.com',
      []
    );
    expect(enterpriseSig.isNationalChainOrDirectory).toBe(true);
    expect(enterpriseSig.prospectTriggerScore).toBeLessThan(0);

    // 4. AutonomousSystemDoctor purges fake 'CPS' with 0 payout and removes diagnostic_probe contamination
    db.prepare(`
      INSERT OR REPLACE INTO cuelinks_campaigns (
        campaign_id, name, merchant_domain, status, payout_model, payout_rate, updated_at
      ) VALUES (
        'camp_fake_cps_9991', 'ZeroPayoutFakeCps', 'zeropayout.in', 'ACTIVE', 'CPS', '0', datetime('now')
      )
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO analytics_events (id, organization_id, business_id, channel, event_type, metadata_json, created_at)
      VALUES ('evt_diag_probe_1', 'org_owner_primary', 'biz_platform_aro', 'STOREFRONT_WEB', 'outbound_click', '{"diagnosticProbe":true,"isTest":true}', datetime('now'))
    `).run();

    AutonomousSystemDoctor.resetForTesting();
    const doctorRes = await AutonomousSystemDoctor.getInstance().runSelfHealingPass({ skipRecoveryRecursion: true, skipLlm: true });
    expect(doctorRes.dataIntegrityRepair?.fakeCpsCampaignsPurged).toBeGreaterThanOrEqual(1);
    expect(doctorRes.dataIntegrityRepair?.testEventsPurged).toBeGreaterThanOrEqual(1);
    const cleanedCamp = db.prepare(`SELECT payout_model FROM cuelinks_campaigns WHERE campaign_id = 'camp_fake_cps_9991'`).get() as any;
    expect(cleanedCamp.payout_model).toBe('UNKNOWN');
  });

  it('Stage N.4: Locks Standing Orders constitution, suppresses healthcare & missing-email domains across doctor/ready-actions/MCP/outreach, and enforces evidence-only Fix-Pack gating', async () => {
    process.env.OWNER_API_KEY = 'stagek_explicit_owner_secret_001';
    process.env.SITE_AUDIT_SIGNING_SECRET = 'stagen_signing_secret_32_characters_minimum_valid_key';
    process.env.BREVO_API_KEY = 'xkeysib_stagen_test';
    process.env.PUBLIC_CONTACT_EMAIL = 'harsha@sitefix.in';

    // 1. STANDING_ORDERS.md exists with all 8 orders
    const standingOrdersPath = path.resolve(process.cwd(), '../../docs/STANDING_ORDERS.md');
    const altStandingOrdersPath = path.resolve(process.cwd(), 'docs/STANDING_ORDERS.md');
    const resolvedDocPath = fs.existsSync(standingOrdersPath) ? standingOrdersPath : altStandingOrdersPath;
    expect(fs.existsSync(resolvedDocPath)).toBe(true);
    const docText = fs.readFileSync(resolvedDocPath, 'utf8');
    expect(docText).toContain('Private Single-Owner System');
    expect(docText).toContain('ZERO health, medical, or dental outreach');

    // 2. Seed healthcare + missing-email + valid SMB targets
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Owner Org', 'owner-primary')`).run();
    db.prepare(`
      INSERT OR IGNORE INTO businesses (
        id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier,
        country, currency, timezone, city, neighborhood, brand_voice, autonomy_mode, kill_switch_active, public_live
      ) VALUES (
        'biz_platform_aro', 'org_owner_primary', 'Platform ARO', 'platform-aro', 'TECHNOLOGY', 'Technology', 'LOW',
        'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills', 'Direct', 'ASSISTED', 0, 0
      )
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO site_audits (
        domain, target_url, business_name, performance_score, seo_score, checklist_json, status, is_publicly_authorized, updated_at
      ) VALUES
      ('capturelifedentalcare.com', 'https://capturelifedentalcare.com', 'Capture Life Dental Care', 50, 54, '{"items":[{"status":"ISSUE","title":"Missing Schema"}],"prospect_signals":{"prospectTriggerScore":8,"hasReachableEmail":true,"discoveredEmails":["care@capturelifedentalcare.com"]}}', 'COMPLETED', 1, datetime('now')),
      ('noemailstudio.in', 'https://noemailstudio.in', 'No Email Studio', 52, 56, '{"items":[{"status":"ISSUE","title":"Missing Schema"}],"prospect_signals":{"prospectTriggerScore":7,"hasReachableEmail":false,"discoveredEmails":[]}}', 'COMPLETED', 0, datetime('now')),
      ('craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 'Craft Coffee Roasters', 48, 52, '{"items":[{"status":"ISSUE","title":"Missing Schema"}],"prospect_signals":{"prospectTriggerScore":7,"hasReachableEmail":true,"discoveredEmails":["hello@craftcoffeeroasters.in"]}}', 'COMPLETED', 0, datetime('now'))
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO platform_prospects (
        id, business_name, prospect_business_name, prospect_city, prospect_vertical,
        email, prospect_email, website_url, prospect_website, stage, status
      ) VALUES
      ('pros_health_n4', 'Capture Life Dental Care', 'Capture Life Dental Care', 'Hyderabad', 'dental', 'care@capturelifedentalcare.com', 'care@capturelifedentalcare.com', 'https://capturelifedentalcare.com', 'https://capturelifedentalcare.com', 'DISCOVERED', 'NEW'),
      ('pros_noemail_n4', 'No Email Studio', 'No Email Studio', 'Hyderabad', 'design', NULL, NULL, 'https://noemailstudio.in', 'https://noemailstudio.in', 'DISCOVERED', 'NEW'),
      ('pros_valid_n4', 'Craft Coffee Roasters', 'Craft Coffee Roasters', 'Hyderabad', 'coffee_roasters', 'hello@craftcoffeeroasters.in', 'hello@craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 'DISCOVERED', 'NEW')
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO direct_outreach_log (
        id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, response_status, created_at
      ) VALUES (
        'draft_health_n4', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Capture Life Dental Care', 'EMAIL',
        'Audit ready for dental clinic.', 0, 0, 'DRAFT_PENDING_APPROVAL', datetime('now')
      )
    `).run();

    // 3. Doctor self-healing enforces constitution, revokes healthcare public visibility, and suppresses healthcare draft
    AutonomousSystemDoctor.resetForTesting();
    const report = await AutonomousSystemDoctor.getInstance().runSelfHealingPass({ skipRecoveryRecursion: true, skipLlm: true });
    expect(report.constitutionStatus).toBe('ENFORCED_ALL_INVARIANTS_PASS');

    const healthAuditRow = db.prepare(`SELECT is_publicly_authorized FROM site_audits WHERE domain = 'capturelifedentalcare.com'`).get() as any;
    expect(healthAuditRow.is_publicly_authorized).toBe(0);
    const healthDraftRow = db.prepare(`SELECT response_status, human_approved FROM direct_outreach_log WHERE id = 'draft_health_n4'`).get() as any;
    expect(healthDraftRow.response_status).toBe('SUPPRESSED_HEALTHCARE_POLICY');
    expect(healthDraftRow.human_approved).toBe(0);

    // 4. Autonomy status & MCP & ready-actions exclude healthcare AND missing-email targets
    const summary = await AutonomousSystemDoctor.getInstance().getPublicSystemDoctorSummary();
    const previewDomains = (summary.topSmbAuditsPreview || []).map(a => a.domain);
    expect(previewDomains).not.toContain('capturelifedentalcare.com');
    expect(previewDomains).not.toContain('noemailstudio.in');
    expect(previewDomains).toContain('craftcoffeeroasters.in');

    const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
    const readyRes = await app.request('/api/v1/owner/first-sale/ready-actions', {
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(readyRes.status).toBe(200);
    const readyJson = (await readyRes.json()) as any;
    const readyDomains = (readyJson.data.readyAudits || []).map((a: any) => a.domain);
    expect(readyDomains).not.toContain('capturelifedentalcare.com');
    expect(readyDomains).not.toContain('noemailstudio.in');
    expect(readyDomains).toContain('craftcoffeeroasters.in');

    // Manual approve-and-send on healthcare draft fails closed with 400
    const badSendRes = await app.request('/api/v1/owner/first-sale/approve-and-send/draft_health_n4', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(badSendRes.status).toBe(400);

    // 5. Evidence-only Fix-Pack Generator includes robots.txt, sitemap.xml, Schema.org + TODO placeholders, and delivery stays gated on payment
    const fixGen = new SiteAuditFixPackGenerator();
    const deliverable = fixGen.generateFixPack({
      auditId: 'aud_n4_craft',
      url: 'https://craftcoffeeroasters.in/',
      businessName: 'Craft Coffee Roasters',
      scannedAt: new Date().toISOString(),
      overallScore: 68,
      grade: 'C',
      summaryHeadline: 'Needs Schema',
      findings: [],
      preview: {
        title: 'Craft Coffee Roasters',
        metaDescription: 'Freshly roasted single-origin beans',
        canonicalUrl: 'https://craftcoffeeroasters.in/'
      },
      prospectSignals: {
        prospectTriggerScore: 7,
        hasReachableEmail: true,
        discoveredEmails: ['hello@craftcoffeeroasters.in'],
        isRegulatedHealthcare: false,
        eligibleForOutreach: true,
        hasMetaPixel: false,
        hasGoogleAdsOrGtm: false,
        hasWhatsAppOrBookingCta: false,
        isNationalChainOrDirectory: false,
        highImpactSeoDefectCount: 2,
        triggerTags: []
      }
    });
    expect(deliverable.schemaJsonLdSnippet).toContain('TODO: REPLACE_WITH_YOUR_PHONE_AND_ADDRESS_IF_LOCAL_BUSINESS');
    expect(deliverable.robotsTxtSnippet).toContain('Sitemap: https://craftcoffeeroasters.in/sitemap.xml');
    expect(deliverable.sitemapXmlSnippet).toContain('<loc>https://craftcoffeeroasters.in/</loc>');

    // Payment gating check on deliverable endpoint
    const auditSvc = SiteAuditService.getInstance();
    auditSvc.setAuditInCache({
      auditId: 'aud_n4_gate',
      url: 'https://craftcoffeeroasters.in/',
      businessName: 'Craft Coffee Roasters',
      scannedAt: new Date().toISOString(),
      overallScore: 68,
      grade: 'C',
      summaryHeadline: 'Needs Schema',
      findings: [],
      preview: {
        title: 'Craft Coffee Roasters',
        metaDescription: 'Freshly roasted beans',
        canonicalUrl: 'https://craftcoffeeroasters.in/'
      }
    });
    db.prepare(`
      INSERT OR REPLACE INTO payment_orders (
        id, business_id, order_id, amount_inr, currency, status, receipt, payment_id
      ) VALUES (
        'po_n4_unpaid', 'biz_platform_aro', 'order_n4_unpaid', 499, 'INR', 'CREATED', 'rcpt_1', NULL
      )
    `).run();
    const unpaidTok = auditSvc.generateDeliveryToken('order_n4_unpaid', 'aud_n4_gate', 'pay_pending');
    const unpaidRes = await app.request(`/api/v1/tools/site-audit/aud_n4_gate/deliverable?token=${encodeURIComponent(unpaidTok)}`);
    expect(unpaidRes.status).toBe(403);

    db.prepare(`UPDATE payment_orders SET status = 'CAPTURED', payment_id = 'pay_n4_ok' WHERE order_id = 'order_n4_unpaid'`).run();
    const paidRes = await app.request(`/api/v1/tools/site-audit/aud_n4_gate/deliverable?token=${encodeURIComponent(unpaidTok)}`);
    expect(paidRes.status).toBe(200);
  });

  it('Stage N.5: Bounded Brevo HTTPS Autopilot (First-5 human gate, <=10/UTC_DAY, >=96h follow-up, bounce/complaint pause + /owner/today banner) and Permanent AI Studio Auth Fix', async () => {
    process.env.OWNER_API_KEY = 'stagek_explicit_owner_secret_001';
    process.env.BREVO_API_KEY = 'xkeysib_stagen_autopilot';
    process.env.PUBLIC_CONTACT_EMAIL = 'harsha@sitefix.in';
    process.env.OUTREACH_AUTOPILOT = 'true';

    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Owner Org', 'owner-primary')`).run();
    db.prepare(`
      INSERT OR IGNORE INTO businesses (
        id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier,
        country, currency, timezone, city, neighborhood, brand_voice, autonomy_mode, kill_switch_active, public_live
      ) VALUES (
        'biz_platform_aro', 'org_owner_primary', 'Platform ARO', 'platform-aro', 'TECHNOLOGY', 'Technology', 'LOW',
        'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills', 'Direct', 'ASSISTED', 0, 0
      )
    `).run();

    // 1. Blocked when < 5 human-approved sends
    db.prepare(`
      INSERT OR REPLACE INTO site_audits (
        domain, target_url, business_name, performance_score, seo_score, checklist_json, status, updated_at
      ) VALUES (
        'craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 'Craft Coffee Roasters', 45, 50,
        '{"items":[{"id":"s1","title":"Missing Schema.org JSON-LD","status":"ISSUE","severity":"HIGH"}],"prospect_signals":{"prospectTriggerScore":6,"hasReachableEmail":true,"discoveredEmails":["hello@craftcoffeeroasters.in"]}}',
        'COMPLETED', datetime('now')
      )
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO platform_prospects (
        id, business_name, prospect_business_name, prospect_city, prospect_vertical, email, prospect_email, website_url, prospect_website, stage, status
      ) VALUES (
        'pros_auto_n5', 'Craft Coffee Roasters', 'Craft Coffee Roasters', 'Hyderabad', 'coffee_roasters', 'hello@craftcoffeeroasters.in', 'hello@craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 'DISCOVERED', 'NEW'
      )
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO outbound_contacts (
        id, organization_id, business_id, prospect_name, prospect_business_name, prospect_email, prospect_website, email_authorized, authorization_source, is_opted_out, is_suppressed
      ) VALUES (
        'ct_auto_n5', 'org_owner_primary', 'biz_platform_aro', 'Craft Coffee Roasters', 'Craft Coffee Roasters', 'hello@craftcoffeeroasters.in', 'https://craftcoffeeroasters.in', 1, 'INBOUND_REQUEST', 0, 0
      )
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO direct_outreach_log (
        id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, response_status, created_at
      ) VALUES (
        'draft_auto_n5_1', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Craft Coffee Roasters', 'EMAIL',
        'We noticed missing Schema.org JSON-LD on craftcoffeeroasters.in.', 0, 0, 'DRAFT_PENDING_APPROVAL', datetime('now')
      )
    `).run();

    const engine = AutomationRegistryEngine.getInstance();
    const beforeGate = await engine.executeWorkflow('authorized_outreach_dispatch', 'MANUAL');
    expect(beforeGate.status).toBe('NO_ACTION_DUE');

    // 2. Seed 5 historical human-approved sends (>2 days ago so daily cap still allows up to 10 today)
    const oldIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT OR REPLACE INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, dispatch_timestamp, response_status, created_at
        ) VALUES (?, 'biz_platform_aro', 'SITEFIX_AUDIT', ?, 'EMAIL', 'Body', 1, 1, ?, 'DISPATCHED', ?)
      `).run(`draft_hist_human_${i}`, `Historical Studio ${i}`, oldIso, oldIso);
    }

    const brevoPayloads: any[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      if (String(input).includes('api.brevo.com/v3/smtp/email')) {
        brevoPayloads.push(JSON.parse(String(init?.body || '{}')));
        return new Response(JSON.stringify({ messageId: `<n5_${brevoPayloads.length}@brevo>` }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    });
    BrevoMcpClient.resetInstanceForTesting();
    BrevoMcpClient.getInstance(globalThis.fetch);

    const autoRes = await engine.executeWorkflow('authorized_outreach_dispatch', 'MANUAL');
    expect(autoRes.status).toBe('COMPLETED');
    expect(autoRes.itemsSucceeded).toBe(1);
    expect(brevoPayloads.length).toBe(1);
    expect(brevoPayloads[0].htmlContent).toContain('Madhapur, Hyderabad');
    expect(brevoPayloads[0].htmlContent).toContain('erasure?email=');

    // 3. Attempting an immediate follow-up (< 96h) for same domain must skip
    db.prepare(`
      INSERT OR REPLACE INTO direct_outreach_log (
        id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, response_status, created_at
      ) VALUES (
        'draft_auto_n5_followup', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Craft Coffee Roasters', 'EMAIL',
        'Quick follow-up on craftcoffeeroasters.in', 0, 0, 'DRAFT_PENDING_APPROVAL', datetime('now')
      )
    `).run();
    const tooEarlyFollowup = await engine.executeWorkflow('authorized_outreach_dispatch', 'MANUAL');
    expect(tooEarlyFollowup.itemsSucceeded).toBe(0);
    expect(brevoPayloads.length).toBe(1);

    // 4. Bounce/complaint circuit breaker pauses autopilot & renders red alert banner on /owner/today
    const brevo = BrevoMcpClient.getInstance();
    try {
      await brevo.handleWebhookEvent({ event: 'spam', email: 'complaint_n5@example.com', reason: 'test_complaint' });
      const doctorHealth = AutonomousSystemDoctor.getInstance().getOutreachAutopilotHealth();
      expect(doctorHealth.paused).toBe(true);
      expect(doctorHealth.autopilotPausedReason).toBe('BOUNCE_OR_COMPLAINT_THRESHOLD');

      const pausedRun = await engine.executeWorkflow('authorized_outreach_dispatch', 'MANUAL');
      expect(pausedRun.status).toBe('BLOCKED');

      const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
      const todayHtmlRes = await app.request('/api/v1/owner/today', {
        headers: {
          Authorization: `Bearer ${session.token}`,
          Accept: 'text/html'
        }
      });
      expect(todayHtmlRes.status).toBe(200);
      const todayHtml = await todayHtmlRes.text();
      expect(todayHtml).toContain('OUTREACH AUTOPILOT PAUSED');
    } finally {
      db.prepare(`DELETE FROM outreach_suppression_list WHERE identifier = 'complaint_n5@example.com'`).run();
      fetchSpy.mockRestore();
    }

    // 5. Permanent Auth Fix: Strict 401 under VITEST / RENDER=true, 200 AI_STUDIO_WORKSPACE_AUTO_AUTH outside Vitest/Render, still 401 on wrong explicit key
    const vitestSessRes = await app.request('/api/v1/auth/owner/session');
    expect(vitestSessRes.status).toBe(401);

    const savedVitest = process.env.VITEST;
    const savedNodeEnv = process.env.NODE_ENV;
    const savedRender = process.env.RENDER;
    try {
      delete process.env.VITEST;
      delete process.env.RENDER;
      process.env.NODE_ENV = 'development';

      const previewSessRes = await app.request('/api/v1/auth/owner/session');
      expect(previewSessRes.status).toBe(200);
      const previewSessJson = (await previewSessRes.json()) as any;
      expect(previewSessJson.authenticated).toBe(true);
      expect(previewSessJson.mode).toBe('AI_STUDIO_WORKSPACE_AUTO_AUTH');
      expect(previewSessJson.sessionToken).toMatch(/^sess_own_/);

      const emptyLoginRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      expect(emptyLoginRes.status).toBe(200);
      const emptyLoginJson = (await emptyLoginRes.json()) as any;
      expect(emptyLoginJson.mode).toBe('AI_STUDIO_WORKSPACE_AUTO_AUTH');

      const wrongKeyRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'definitely_wrong_key' })
      });
      expect(wrongKeyRes.status).toBe(401);

      process.env.RENDER = 'true';
      const renderSessRes = await app.request('/api/v1/auth/owner/session');
      expect(renderSessRes.status).toBe(401);
    } finally {
      if (savedVitest !== undefined) process.env.VITEST = savedVitest;
      else delete process.env.VITEST;
      if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
      else delete process.env.NODE_ENV;
      if (savedRender !== undefined) process.env.RENDER = savedRender;
      else delete process.env.RENDER;
    }
  }, 120000);
});
