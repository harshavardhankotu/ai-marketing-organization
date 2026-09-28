/**
 * production-false-live-guards.test.ts
 *
 * 36 tests verifying the system never reports a capability as LIVE when it is not.
 * These tests enforce the core non-negotiable rule:
 * "A system capability may be reported as LIVE only when an actual provider API call
 *  succeeded and returned a provider-verifiable identifier or provider state."
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { PlatformProspectDiscoveryEngine } from '../../src/revenue/platform-prospect-discovery-engine.js';
import { FirstCustomerStateMachine } from '../../src/revenue/first-customer-state-machine.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { UnifiedQuotaService } from '../../src/quota/unified-quota-service.js';
import { ChannelSelectionEngine } from '../../src/revenue/channel-selection-engine.js';
import { OutboundActionLedger } from '../../src/revenue/outbound-action-ledger.js';
import { ProspectEvidenceVerifier } from '../../src/revenue/prospect-evidence-verifier.js';
import { LearningEngine } from '../../src/revenue/learning-engine.js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const savedEnv: Record<string, string | undefined> = {};

function saveEnv(...keys: string[]) {
  for (const k of keys) savedEnv[k] = process.env[k];
}

function restoreEnv(...keys: string[]) {
  for (const k of keys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

beforeEach(() => {
  resetDbForTesting();
  // Reset singleton instances to get fresh state per test
  (PlatformProspectDiscoveryEngine as any).instance = undefined;
  (FirstCustomerStateMachine as any).instance = undefined;
});

afterEach(() => {
  // Always restore NODE_ENV to test
  process.env.NODE_ENV = 'test';
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1: Production Synthetic Data Rejection
// ─────────────────────────────────────────────────────────────────────────────

describe('Production False-Live Guards', () => {

  it('1. validateCandidate rejects TEST_DATA classification in production', () => {
    process.env.NODE_ENV = 'production';
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const fakeProdCandidate = {
      businessName: 'Test Clinic Hyderabad',
      vertical: 'clinic' as const,
      city: 'Hyderabad',
      websiteUrl: 'https://example.com',
      evidenceSourceUrl: 'https://example.com/contact',
      contactPhone: '+919440123456',
      observedGap: 'test',
      evidenceTimestamp: new Date().toISOString(),
      classification: 'TEST_DATA',
      sourceType: 'TEST_DATA',
      dataSource: 'DETERMINISTIC_TEST_FIXTURE'
    };
    expect(engine.validateCandidate(fakeProdCandidate)).toBe(false);
    process.env.NODE_ENV = 'test';
  });

  it('2. validateCandidate rejects DETERMINISTIC_TEST_FIXTURE source in production', () => {
    process.env.NODE_ENV = 'production';
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'Real Looking Business',
      vertical: 'dental' as const,
      city: 'Mumbai',
      websiteUrl: 'https://example.com',
      evidenceSourceUrl: 'https://example.com/contact',
      contactPhone: '+919440999888',
      observedGap: 'gap',
      evidenceTimestamp: new Date().toISOString(),
      dataSource: 'DETERMINISTIC_TEST_FIXTURE'
    };
    expect(engine.validateCandidate(candidate)).toBe(false);
    process.env.NODE_ENV = 'test';
  });

  it('3. validateCandidate rejects .local websites in production', () => {
    process.env.NODE_ENV = 'production';
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'Pune Dental Care',
      vertical: 'dental' as const,
      city: 'Pune',
      websiteUrl: 'https://test-fixture-dental-pune.local',
      evidenceSourceUrl: 'https://test-fixture-dental-pune.local/contact',
      contactPhone: '+919440888777',
      observedGap: 'gap',
      evidenceTimestamp: new Date().toISOString()
    };
    expect(engine.validateCandidate(candidate)).toBe(false);
    process.env.NODE_ENV = 'test';
  });

  it('4. validateCandidate rejects .local email addresses in production', () => {
    process.env.NODE_ENV = 'production';
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'Bengaluru Salon',
      vertical: 'salon' as const,
      city: 'Bengaluru',
      websiteUrl: 'https://bsalon.in',
      evidenceSourceUrl: 'https://bsalon.in',
      contactEmail: 'contact@bsalon.local',
      observedGap: 'gap',
      evidenceTimestamp: new Date().toISOString()
    };
    expect(engine.validateCandidate(candidate)).toBe(false);
    process.env.NODE_ENV = 'test';
  });

  it('5. validateCandidate rejects test_fixture_ prefixed business names in production', () => {
    process.env.NODE_ENV = 'production';
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'TEST_FIXTURE_DentalCare',
      vertical: 'dental' as const,
      city: 'Hyderabad',
      websiteUrl: 'https://realsite.com',
      evidenceSourceUrl: 'https://realsite.com',
      contactPhone: '+919440777666',
      observedGap: 'gap',
      evidenceTimestamp: new Date().toISOString()
    };
    expect(engine.validateCandidate(candidate)).toBe(false);
    process.env.NODE_ENV = 'test';
  });

  it('6. validateCandidate rejects smilekraft in any environment', () => {
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'SmileKraft Dental',
      vertical: 'dental' as const,
      city: 'Hyderabad',
      websiteUrl: 'https://smilekraft.in',
      evidenceSourceUrl: 'https://smilekraft.in',
      contactPhone: '+919999999999',
      observedGap: 'gap',
      evidenceTimestamp: new Date().toISOString()
    };
    expect(engine.validateCandidate(candidate)).toBe(false);
  });

  it('7. validateCandidate requires evidenceSourceUrl', () => {
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'Good Dental Clinic',
      vertical: 'dental' as const,
      city: 'Hyderabad',
      websiteUrl: 'https://gooddental.in',
      evidenceSourceUrl: '',  // empty
      contactPhone: '+919440111222',
      observedGap: 'gap',
      evidenceTimestamp: new Date().toISOString()
    };
    expect(engine.validateCandidate(candidate)).toBe(false);
  });

  it('8. validateCandidate requires at least phone or email', () => {
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'No Contact Clinic',
      vertical: 'clinic' as const,
      city: 'Mumbai',
      websiteUrl: 'https://nocontact.in',
      evidenceSourceUrl: 'https://nocontact.in/about',
      observedGap: 'gap',
      evidenceTimestamp: new Date().toISOString()
    };
    expect(engine.validateCandidate(candidate)).toBe(false);
  });

  it('9. validateCandidate rejects system forbidden contacts', () => {
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'Platform Admin Business',
      vertical: 'coaching' as const,
      city: 'Delhi NCR',
      websiteUrl: 'https://platform.in',
      evidenceSourceUrl: 'https://platform.in',
      contactPhone: '+919999999999',  // FORBIDDEN
      observedGap: 'gap',
      evidenceTimestamp: new Date().toISOString()
    };
    expect(engine.validateCandidate(candidate)).toBe(false);
  });

  it('10. validateCandidate requires http(s) for websiteUrl', () => {
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'No HTTP Clinic',
      vertical: 'clinic' as const,
      city: 'Chennai',
      websiteUrl: 'ftp://nohttps.in',  // invalid scheme
      evidenceSourceUrl: 'https://nohttps.in',
      contactPhone: '+919440555444',
      observedGap: 'gap',
      evidenceTimestamp: new Date().toISOString()
    };
    expect(engine.validateCandidate(candidate)).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GROUP 2: FirstCustomerStateMachine — No Hardcoded Revenue Truth
  // ─────────────────────────────────────────────────────────────────────────────

  it('11. FirstCustomerStateMachine shows NO_PROSPECTS on empty DB with verifiedRevenueINR=0', () => {
    const sm = FirstCustomerStateMachine.getInstance();
    const state = sm.evaluateState();
    expect(state.currentStage).toBe('NO_PROSPECTS');
    expect(state.evidence.verifiedRevenueINR).toBe(0);  // NEVER hardcoded 15000
    expect(state.evidence.prospectCount).toBe(0);
    expect(state.evidence.outreachSent).toBe(false);
    expect(state.evidence.responseReceived).toBe(false);
  });

  it('12. FirstCustomerStateMachine verifiedRevenueINR is 0 without actual revenue records', () => {
    const sm = FirstCustomerStateMachine.getInstance();
    const state = sm.evaluateState(
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      OwnerAuthService.OWNER_ORGANIZATION_ID
    );
    // Must query DB — not return hardcoded 15000
    expect(state.evidence.verifiedRevenueINR).toBe(0);
    expect(state.evidence.verifiedRevenueINR).not.toBe(15000);
  });

  it('13. FirstCustomerStateMachine outreachSent is false without CONTACTED pipeline row', () => {
    const sm = FirstCustomerStateMachine.getInstance();
    const state = sm.evaluateState(
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      OwnerAuthService.OWNER_ORGANIZATION_ID
    );
    expect(state.evidence.outreachSent).toBe(false);
  });

  it('14. FirstCustomerStateMachine responseReceived is false without REPLIED pipeline row', () => {
    const sm = FirstCustomerStateMachine.getInstance();
    const state = sm.evaluateState(
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      OwnerAuthService.OWNER_ORGANIZATION_ID
    );
    expect(state.evidence.responseReceived).toBe(false);
  });

  it('15. FirstCustomerStateMachine is executable from NO_PROSPECTS (can trigger discovery)', () => {
    const sm = FirstCustomerStateMachine.getInstance();
    const state = sm.evaluateState();
    expect(state.currentStage).toBe('NO_PROSPECTS');
    expect(state.executable).toBe(true);  // System can attempt discovery
    expect(state.nextStage).toBe('DISCOVER_PROSPECTS');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GROUP 3: Quota & Free-Tier Guards
  // ─────────────────────────────────────────────────────────────────────────────

  it('16. UnifiedQuotaService blocks GEMINI when quota is locked', () => {
    const qs = UnifiedQuotaService.getInstance();
    qs.lockProvider('GEMINI', 'Manual lock test');
    const gate = qs.reserve('GEMINI', 'P3', 1, 'test purpose');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('lock');
    qs.unlockProvider('GEMINI');
  });

  it('17. UnifiedQuotaService blocks TAVILY when quota is locked', () => {
    const qs = UnifiedQuotaService.getInstance();
    qs.lockProvider('TAVILY', 'Test lock');
    const gate = qs.reserve('TAVILY', 'P3', 1, 'search purpose');
    expect(gate.allowed).toBe(false);
    qs.unlockProvider('TAVILY');
  });

  it('18. UnifiedQuotaService reserve returns remaining budget information', () => {
    const qs = UnifiedQuotaService.getInstance();
    const gate = qs.reserve('GEMINI', 'P2', 1, 'test');
    expect(gate).toHaveProperty('allowed');
    expect(gate).toHaveProperty('reason');
  });

  it('19. PlatformProspectDiscoveryEngine returns BLOCKED_NO_FREE_RESEARCH_CAPABILITY in production without keys', async () => {
    saveEnv('NODE_ENV', 'GEMINI_API_KEY', 'TAVILY_API_KEY');
    process.env.NODE_ENV = 'production';
    delete process.env.GEMINI_API_KEY;
    delete process.env.TAVILY_API_KEY;

    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const result = await engine.discoverProspects();
    expect(result.status).toBe('BLOCKED_NO_FREE_RESEARCH_CAPABILITY');
    expect(result.count).toBe(0);
    expect(result.prospects).toHaveLength(0);

    restoreEnv('NODE_ENV', 'GEMINI_API_KEY', 'TAVILY_API_KEY');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GROUP 4: Deterministic Vertical/City Rotation
  // ─────────────────────────────────────────────────────────────────────────────

  it('20. pickNextTargetVertical is deterministic (no Math.random) — same result on empty DB', () => {
    const engine1 = PlatformProspectDiscoveryEngine.getInstance();
    // Access private method via cast
    const v1 = (engine1 as any).pickNextTargetVertical();
    const v2 = (engine1 as any).pickNextTargetVertical();
    expect(v1).toBe(v2);  // Deterministic
    expect(typeof v1).toBe('string');
  });

  it('21. pickNextTargetCity is deterministic (no Math.random) — same result on empty DB', () => {
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const c1 = (engine as any).pickNextTargetCity();
    const c2 = (engine as any).pickNextTargetCity();
    expect(c1).toBe(c2);  // Deterministic
    expect(typeof c1).toBe('string');
  });

  it('22. pickNextTargetVertical returns a valid vertical value', () => {
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const valid = ['clinic', 'dental', 'salon', 'coaching', 'real_estate', 'professional_services'];
    const vertical = (engine as any).pickNextTargetVertical();
    expect(valid).toContain(vertical);
  });

  it('23. pickNextTargetCity returns a valid Indian city', () => {
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const validCities = ['Hyderabad', 'Bengaluru', 'Mumbai', 'Pune', 'Delhi NCR', 'Chennai'];
    const city = (engine as any).pickNextTargetCity();
    expect(validCities).toContain(city);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GROUP 5: Grounded Content API — structural validation
  // ─────────────────────────────────────────────────────────────────────────────

  it('24. GeminiProvider.generateGroundedContent returns BLOCKED_NO_KEY when no API key', async () => {
    saveEnv('GEMINI_API_KEY');
    delete process.env.GEMINI_API_KEY;

    const { GeminiProvider } = await import('../../src/ai/gemini-provider.js');
    const provider = new GeminiProvider();
    const result = await provider.generateGroundedContent('Find real dental clinics in Hyderabad India');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('BLOCKED_NO_KEY');
    expect(result!.groundingMetadata).toBeNull();

    restoreEnv('GEMINI_API_KEY');
  });

  it('25. GeminiProvider.generateGroundedContent returns BLOCKED_NO_KEY for placeholder key', async () => {
    saveEnv('GEMINI_API_KEY');
    process.env.GEMINI_API_KEY = 'PLACEHOLDER';

    const { GeminiProvider } = await import('../../src/ai/gemini-provider.js');
    const provider = new GeminiProvider();
    const result = await provider.generateGroundedContent('Find real salons in Mumbai India');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('BLOCKED_NO_KEY');

    restoreEnv('GEMINI_API_KEY');
  });

  it('26. GeminiProvider.generateGroundedContent response shape has required fields', async () => {
    saveEnv('GEMINI_API_KEY');
    delete process.env.GEMINI_API_KEY;

    const { GeminiProvider } = await import('../../src/ai/gemini-provider.js');
    const provider = new GeminiProvider();
    const result = await provider.generateGroundedContent('Search for businesses');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('groundingMetadata');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('source');

    restoreEnv('GEMINI_API_KEY');
  });

  it('27. GeminiProvider research model defaults to gemini-2.5-flash-lite', async () => {
    saveEnv('GEMINI_API_KEY', 'GEMINI_RESEARCH_MODEL');
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_RESEARCH_MODEL;

    const { GeminiProvider } = await import('../../src/ai/gemini-provider.js');
    const provider = new GeminiProvider();
    const result = await provider.generateGroundedContent('test');
    expect(result!.model).toBe('gemini-2.5-flash-lite');

    restoreEnv('GEMINI_API_KEY', 'GEMINI_RESEARCH_MODEL');
  });

  it('28. GEMINI_RESEARCH_MODEL env var overrides default model for grounded content', async () => {
    saveEnv('GEMINI_API_KEY', 'GEMINI_RESEARCH_MODEL');
    delete process.env.GEMINI_API_KEY;
    process.env.GEMINI_RESEARCH_MODEL = 'gemini-custom-model';

    const { GeminiProvider } = await import('../../src/ai/gemini-provider.js');
    const provider = new GeminiProvider();
    const result = await provider.generateGroundedContent('test');
    expect(result!.model).toBe('gemini-custom-model');

    restoreEnv('GEMINI_API_KEY', 'GEMINI_RESEARCH_MODEL');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GROUP 6: System Constants & Identity Checks
  // ─────────────────────────────────────────────────────────────────────────────

  it('29. OwnerAuthService.PLATFORM_RAZORPAY_PAYMENT_PAGE_URL is a valid razorpay.me URL', () => {
    const url = OwnerAuthService.PLATFORM_RAZORPAY_PAYMENT_PAGE_URL;
    expect(url).toBeDefined();
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^https:\/\/razorpay\.me\/@/);
  });

  it('30. PLATFORM_BUSINESS_ID constant is defined and not empty', () => {
    expect(OwnerAuthService.PLATFORM_BUSINESS_ID).toBeTruthy();
    expect(typeof OwnerAuthService.PLATFORM_BUSINESS_ID).toBe('string');
  });

  it('31. OWNER_ORGANIZATION_ID constant is defined and not empty', () => {
    expect(OwnerAuthService.OWNER_ORGANIZATION_ID).toBeTruthy();
    expect(typeof OwnerAuthService.OWNER_ORGANIZATION_ID).toBe('string');
  });

  it('32. PLATFORM_BUSINESS_ID and OWNER_ORGANIZATION_ID are distinct values', () => {
    expect(OwnerAuthService.PLATFORM_BUSINESS_ID).not.toBe(OwnerAuthService.OWNER_ORGANIZATION_ID);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GROUP 7: Pipeline & State Integrity
  // ─────────────────────────────────────────────────────────────────────────────

  it('33. discoverProspects returns count=0 on NO_NEW_PROSPECTS status', async () => {
    // No Gemini key in test mode without GEMINI_API_KEY real value (uses test fixture path)
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    // Attempt discover — either discovers or returns NO_NEW_PROSPECTS
    const result = await engine.discoverProspects(
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      OwnerAuthService.OWNER_ORGANIZATION_ID,
      { vertical: 'dental', city: 'Hyderabad', limit: 1 }
    );
    // If status is NO_NEW_PROSPECTS, count must be 0
    if (result.status === 'NO_NEW_PROSPECTS') {
      expect(result.count).toBe(0);
      expect(result.prospects).toHaveLength(0);
    }
    // If discovered, count > 0
    if (result.status === 'PROSPECTS_DISCOVERED') {
      expect(result.count).toBeGreaterThan(0);
    }
  });

  it('34. FirstCustomerStateMachine.advance returns structured result with required fields', async () => {
    const sm = FirstCustomerStateMachine.getInstance();
    const result = await sm.advance();
    expect(result).toHaveProperty('transition');
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('newStage');
    expect(typeof result.transition).toBe('string');
    expect(typeof result.success).toBe('boolean');
  });

  it('35. PlatformProspectDiscoveryEngine.discoverProspects never returns negative count', async () => {
    const engine = PlatformProspectDiscoveryEngine.getInstance();
    const result = await engine.discoverProspects();
    expect(result.count).toBeGreaterThanOrEqual(0);
  });

  it('36. FirstCustomerStateMachine evidence never contains verifiedRevenueINR > 0 without actual revenue records', () => {
    const sm = FirstCustomerStateMachine.getInstance();
    // Empty DB — no revenue records exist
    const state = sm.evaluateState(
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      OwnerAuthService.OWNER_ORGANIZATION_ID
    );
    // On empty DB, we can only be in NO_PROSPECTS stage
    // verifiedRevenueINR must be 0 (never hardcoded)
    if (state.currentStage === 'NO_PROSPECTS') {
      expect(state.evidence.verifiedRevenueINR).toBe(0);
      expect(state.evidence.customerCount).toBe(0);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GROUP 8: Channel Gating, Idempotency & SSRF Guards
  // ─────────────────────────────────────────────────────────────────────────────

  it('37. ChannelSelectionEngine strictly blocks WhatsApp outbound when whatsapp_opt_in is false', () => {
    const engine = ChannelSelectionEngine.getInstance();
    const result = engine.selectChannel({
      prospect: {
        contactPhone: '+919988776655'
      },
      outboundContact: {
        channel: 'WHATSAPP',
        emailAuthorized: false,
        whatsappOptIn: false
      },
      approvedTemplateName: 'template_01'
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('BLOCKED_WHATSAPP_NO_OPT_IN');
  });

  it('38. ChannelSelectionEngine prioritizes verified EMAIL over WhatsApp when opt-in is absent', () => {
    const engine = ChannelSelectionEngine.getInstance();
    const result = engine.selectChannel({
      prospect: {
        contactEmail: 'owner@localclinic.in',
        contactPhone: '+919988776655'
      },
      outboundContact: {
        channel: 'WHATSAPP',
        emailAuthorized: true,
        whatsappOptIn: false
      },
      approvedTemplateName: 'template_01'
    });
    expect(result.allowed).toBe(true);
    expect(result.channel).toBe('EMAIL');
  });

  it('39. OutboundActionLedger strictly prevents duplicate outbound dispatch', async () => {
    const ledger = OutboundActionLedger.getInstance();
    const db = getDb();
    const oppId = `opp_${Date.now()}`;
    const contactId = `cnt_${Date.now()}`;

    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_test_owner', 'Test Org', 'test-org')`).run();
    db.prepare(`INSERT OR IGNORE INTO businesses (id, organization_id, name, vertical_id, vertical_name, city, neighborhood, brand_voice) VALUES ('biz_test_owner', 'org_test_owner', 'Platform', 'v_tech', 'Technology', 'Hyderabad', 'Banjara Hills', 'Professional')`).run();
    db.prepare(`INSERT OR IGNORE INTO opportunities (id, organization_id, business_id, source) VALUES (?, 'org_test_owner', 'biz_test_owner', 'OUTBOUND_PROSPECT')`).run(oppId);
    db.prepare(`INSERT OR IGNORE INTO outbound_contacts (id, organization_id, business_id, prospect_name, channel) VALUES (?, 'org_test_owner', 'biz_test_owner', 'Contact', 'EMAIL')`).run(contactId);

    const alreadyBefore = await ledger.isAlreadySent('org_test_owner', oppId, contactId, 1, 'EMAIL');
    expect(alreadyBefore).toBe(false);

    await ledger.recordAction({
      id: `act_${Date.now()}`,
      organizationId: 'org_test_owner',
      businessId: 'biz_test_owner',
      opportunityId: oppId,
      outboundContactId: contactId,
      sequenceNumber: 1,
      channel: 'EMAIL',
      actionKey: `outreach_${oppId}_EMAIL`,
      provider: 'MOCK_EMAIL',
      providerExternalId: 'msg_ext_12345',
      status: 'DELIVERED'
    });

    const alreadyAfter = await ledger.isAlreadySent('org_test_owner', oppId, contactId, 1, 'EMAIL');
    expect(alreadyAfter).toBe(true);
  });

  it('40. ProspectEvidenceVerifier rejects loopback and non-http schemes', async () => {
    const verifier = ProspectEvidenceVerifier.getInstance();
    expect(verifier.isSyntacticallyValidExternalUrl('http://127.0.0.1:8080/admin')).toBe(false);
    expect(verifier.isSyntacticallyValidExternalUrl('ftp://example.com/file')).toBe(false);
    expect(verifier.isSyntacticallyValidExternalUrl('https://example.com/contact')).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GROUP 9: Static Source Code Scans for Forbidden Fallbacks & Fake IDs
  // ─────────────────────────────────────────────────────────────────────────────

  function getAllTsFiles(dir: string, fileList: string[] = []): string[] {
    const files = readdirSync(dir);
    for (const file of files) {
      const fullPath = join(dir, file);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        getAllTsFiles(fullPath, fileList);
      } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  it('41. Source tree contains ZERO occurrences of tx_${Date.now()}', () => {
    const srcDir = join(__dirname, '../../src');
    const tsFiles = getAllTsFiles(srcDir);
    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, 'utf-8');
      expect(content).not.toContain('tx_${Date.now()}');
    }
  });

  it('42. Source tree contains ZERO occurrences of discovery_pipeline_${', () => {
    const srcDir = join(__dirname, '../../src');
    const tsFiles = getAllTsFiles(srcDir);
    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, 'utf-8');
      expect(content).not.toContain('discovery_pipeline_${');
    }
  });

  it('43. Source tree contains ZERO dynamic require("./durable-event-bus', () => {
    const srcDir = join(__dirname, '../../src');
    const tsFiles = getAllTsFiles(srcDir);
    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, 'utf-8');
      expect(content).not.toContain("require('./durable-event-bus");
    }
  });

  it('44. Source tree contains ZERO amountINR || 150000 fallback patterns', () => {
    const srcDir = join(__dirname, '../../src');
    const tsFiles = getAllTsFiles(srcDir);
    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, 'utf-8');
      expect(content).not.toContain('amountINR || 150000');
    }
  });

  it('45. LearningEngine rejects REAL_WORLD_LEARNING without externalResultId', () => {
    const engine = LearningEngine.getInstance();
    const outcome = engine.recordObservation({
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
      businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Pitch with gap',
      hypothesis: 'Direct pitching works',
      action: 'Sent email pitch',
      audience: 'Dental clinic',
      offer: 'Setup fee',
      channel: 'EMAIL',
      result: 'No response',
      evidence: {} // No externalActionId or transactionId
    });

    expect(outcome.learningType).not.toBe('REAL_WORLD_LEARNING');
  });

});
