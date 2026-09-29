import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { PlatformProspectDiscoveryEngine, DiscoveredProspectCandidate } from '../../src/revenue/platform-prospect-discovery-engine.js';

describe('Prospect Discovery Evidence Requirements (Tavily Only)', () => {
  let engine: PlatformProspectDiscoveryEngine;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    (PlatformProspectDiscoveryEngine as any).instance = undefined;
    engine = PlatformProspectDiscoveryEngine.getInstance();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const baseValidCandidate: DiscoveredProspectCandidate = {
    businessName: 'Apex Dental Care & Implant Centre',
    vertical: 'dental',
    city: 'Hyderabad',
    websiteUrl: 'https://apexdentalcare.in',
    contactPerson: 'Dr. Suresh Kumar',
    contactPhone: '+919849123456',
    contactEmail: 'appointments@apexdentalcare.in',
    observedGap: 'Manual inquiry triage observed.',
    evidenceSourceUrl: 'https://apexdentalcare.in/contact',
    evidenceSnippet: 'Apex Dental Care & Implant Centre offers comprehensive dental treatments in Hyderabad. Contact +919849123456.',
    evidenceTimestamp: new Date().toISOString()
  };

  it('rejects candidates without evidenceSourceUrl', () => {
    const emptyUrlCandidate: DiscoveredProspectCandidate = {
      ...baseValidCandidate,
      evidenceSourceUrl: ''
    };
    expect(engine.validateCandidate(emptyUrlCandidate)).toBe(false);

    const nonHttpCandidate: DiscoveredProspectCandidate = {
      ...baseValidCandidate,
      evidenceSourceUrl: 'ftp://apexdentalcare.in/contact'
    };
    expect(engine.validateCandidate(nonHttpCandidate)).toBe(false);

    const undefinedUrlCandidate: any = {
      ...baseValidCandidate,
      evidenceSourceUrl: undefined
    };
    expect(engine.validateCandidate(undefinedUrlCandidate)).toBe(false);
  });

  it('rejects candidates without evidenceSnippet', () => {
    // Missing both evidenceSnippet and observedGap
    const candidateNoSnippetOrGap: DiscoveredProspectCandidate = {
      ...baseValidCandidate,
      evidenceSnippet: undefined,
      observedGap: ''
    };
    expect(engine.validateCandidate(candidateNoSnippetOrGap)).toBe(false);

    // Empty whitespace evidenceSnippet
    const candidateWhitespaceSnippet: DiscoveredProspectCandidate = {
      ...baseValidCandidate,
      evidenceSnippet: '   '
    };
    expect(engine.validateCandidate(candidateWhitespaceSnippet)).toBe(false);

    // Empty string evidenceSnippet
    const candidateEmptySnippet: DiscoveredProspectCandidate = {
      ...baseValidCandidate,
      evidenceSnippet: ''
    };
    expect(engine.validateCandidate(candidateEmptySnippet)).toBe(false);
  });

  it('accepts candidates with valid Tavily evidence (source URL and evidenceSnippet)', () => {
    expect(engine.validateCandidate(baseValidCandidate)).toBe(true);
  });

  it('provides deterministic evidence-backed fixtures with snippets when TAVILY_API_KEY is absent in test environment', async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const result = await engine.discoverProspects(
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      OwnerAuthService.OWNER_ORGANIZATION_ID,
      { vertical: 'dental', city: 'Hyderabad', limit: 2 }
    );

    expect(result.status).toBe('PROSPECTS_DISCOVERED');
    expect(result.source).toBe('TAVILY_RESEARCH');
    expect(result.count).toBeGreaterThan(0);
    expect(result.prospects[0].businessName).toBe('Apex Dental Care & Implant Centre');
    expect(result.prospects[0].websiteUrl).toMatch(/^https?:\/\//);

    // Verify stored evidence contains real snippet
    const db = getDb();
    const prospect = db.prepare('SELECT * FROM platform_prospects WHERE id = ?').get(result.prospects[0].id) as any;
    expect(prospect).toBeDefined();
    const evidence = JSON.parse(prospect.discovery_evidence_json);
    expect(evidence.evidenceSourceUrl).toMatch(/^https?:\/\//);
    expect(evidence.evidenceSnippet).toBeTruthy();
    expect(evidence.evidenceSnippet.length).toBeGreaterThan(20);
  });

  it('returns BLOCKED_NO_FREE_RESEARCH_CAPABILITY in production when TAVILY_API_KEY is absent', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TAVILY_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const result = await engine.discoverProspects(
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      OwnerAuthService.OWNER_ORGANIZATION_ID
    );

    expect(result.status).toBe('BLOCKED_NO_FREE_RESEARCH_CAPABILITY');
    expect(result.count).toBe(0);
    expect(result.prospects).toHaveLength(0);
  });
});
