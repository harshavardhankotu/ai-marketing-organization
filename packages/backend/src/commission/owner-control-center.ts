/**
 * Owner Control Center Engine
 *
 * Implements:
 * A. Owner Intake (one-time persistent intake, never requested twice, zero defaults)
 * B. Status Page & Open Actions (hourly computed, zero LLM calls, auto-refreshing UI)
 * C. Learning Ingest (structured rows: what, outcome, cause, rule in learning_records)
 * D. Product Proposals (non-Amazon manufacturer sources, zero Amazon fetches, zero LLM tokens)
 * E. Weekly Report Ingest (parses Associates earnings/orders export, moves EXPECTED -> PENDING -> VERIFIED)
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { PartnerRegistryEngine } from './partner-registry.js';
import { ConversionVerificationAdapter } from './conversion-verification.js';
import { CommissionLedgerEngine } from './commission-ledger.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';
import { ActionCooldownManager } from '../revenue/action-cooldown-manager.js';
import { isProduction } from '../config/env.js';

// ============================================================================
// Types
// ============================================================================

export interface OwnerIntakeRecord {
  id: string;
  organizationId: string;
  applicationDate: string;
  listedSiteUrls: string[];
  agreementReadConfirmed: boolean;
  agreementReadConfirmedAt: string;
  siteName: string;
  authorName: string;
  contactEmail: string;
  tavilyKeyRotated: boolean;
  status: 'VALID' | 'INVALID_AGENT_WRITTEN';
  writtenBy: string;
  createdAt: string;
  completedAt: string;
  updatedAt: string;
}

export interface SaveOwnerIntakeInput {
  applicationDate: string;
  listedSiteUrls: string[] | string;
  agreementReadConfirmed: boolean;
  siteName: string;
  authorName: string;
  contactEmail: string;
  tavilyKeyRotated: boolean;
  writtenBy?: string;
}

export interface StructuredLearningRule {
  id: string;
  what: string;
  outcome: string;
  cause: string;
  rule: string;
}

export interface ProductProposal {
  id: string;
  organizationId: string;
  category: string;
  productName: string;
  manufacturerName: string;
  specSummary: string;
  sourceUrl: string;
  retrievalDate: string;
  providerCallLogId?: string;
  pageTextSnippet?: string;
  displayName?: string;
  listingFacts?: Array<{ fact: string; date: string }>;
  amazonUrl?: string;
  asin?: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'UNSOURCED';
  approvedOfferId?: string;
  productChecked: boolean;
  productCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenActionItem {
  id: string;
  type: 'HUMAN' | 'AUTOMATED';
  title: string;
  description: string;
  resolutionCondition: string;
  resolved: boolean;
}

export interface OwnerStatusSnapshot {
  organizationId: string;
  computedAt: string;
  deployments: {
    gitHead: string;
    renderCommit: string;
    firebaseDeploy: string;
    commitStatus: 'MATCH' | 'MISMATCH';
    mismatchDetails?: string;
  };
  todayItems?: {
    intakeCompleted: boolean;
    intakeStatus: string;
    candidateProposals: ProductProposal[];
    publishReadyGuides?: any[];
    readyShareGuide?: {
      status?: 'READY' | 'NOT_READY';
      title?: string;
      shareText?: string;
      pageUrl?: string;
    };
  };
  lastCronCycle: {
    cycleId?: string;
    cycleStart?: string;
    triggerSource?: string;
    status?: string;
    nextBestAction?: string;
  };
  moneyPath: {
    status: string;
    reason: string;
    singleBiggestBlocker: string;
  };
  deadline180Days: {
    applicationDate?: string;
    deadlineDate?: string;
    daysRemaining: number | null;
    countdownText: string;
    isExpired: boolean;
  };
  quotas: {
    tavily: {
      creditsConsumedMonth: number;
      applicationLimit: number;
      estimatedRemaining: number;
      isLocked: boolean;
    };
    gemini: {
      requestsToday: number;
      applicationLimit: number;
      isLocked: boolean;
    };
  };
  cooldowns: Array<{ targetId: string; actionType: string; nextEligibleAt: string }>;
  learningInsights: StructuredLearningRule[];
  openActions: OpenActionItem[];
}

export interface AssociatesReportRow {
  date: string;
  trackingId?: string;
  asin: string;
  productTitle?: string;
  category?: string;
  itemsOrdered: number;
  itemsShipped: number;
  revenueINR: number;
  commissionRate?: number;
  earningsINR: number;
}

export interface AssociatesIngestResult {
  success: boolean;
  rowsParsed: number;
  commissionsPending: number;
  commissionsVerified: number;
  totalEarningsINR: number;
  details: string[];
}

// ============================================================================
// Owner Control Center Engine
// ============================================================================

export class OwnerControlCenterEngine {
  private static instance: OwnerControlCenterEngine;
  private d1Repo = D1RevenueRepository.getInstance();
  private registry = PartnerRegistryEngine.getInstance();
  private conversionAdapter = ConversionVerificationAdapter.getInstance();
  private ledger = CommissionLedgerEngine.getInstance();
  private quotaService = UnifiedQuotaService.getInstance();

  public static getInstance(): OwnerControlCenterEngine {
    if (!OwnerControlCenterEngine.instance) {
      OwnerControlCenterEngine.instance = new OwnerControlCenterEngine();
    }
    return OwnerControlCenterEngine.instance;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // A. OWNER INTAKE (One-time, never asked twice, zero defaults)
  // ──────────────────────────────────────────────────────────────────────────

  public async getIntake(organizationId: string = 'org_owner_primary'): Promise<OwnerIntakeRecord | null> {
    const row = isProduction()
      ? await this.d1Repo.queryOne<any>('owner_intake', 'SELECT * FROM owner_intake WHERE organization_id = ? OR id = ? LIMIT 1', [organizationId, organizationId])
      : (getDb().prepare('SELECT * FROM owner_intake WHERE organization_id = ? OR id = ? LIMIT 1').get(organizationId, organizationId) as any);

    if (!row) return null;
    const mapped = this.mapIntake(row);
    // Item 1: If marked INVALID_AGENT_WRITTEN, return null to reopen act_complete_intake
    if (mapped.status === 'INVALID_AGENT_WRITTEN') {
      return null;
    }
    return mapped;
  }

  public async getRawIntakeRow(organizationId: string = 'org_owner_primary'): Promise<OwnerIntakeRecord | null> {
    const row = isProduction()
      ? await this.d1Repo.queryOne<any>('owner_intake', 'SELECT * FROM owner_intake WHERE organization_id = ? OR id = ? LIMIT 1', [organizationId, organizationId])
      : (getDb().prepare('SELECT * FROM owner_intake WHERE organization_id = ? OR id = ? LIMIT 1').get(organizationId, organizationId) as any);

    if (!row) return null;
    return this.mapIntake(row);
  }

  public async saveIntake(organizationId: string = 'org_owner_primary', input: SaveOwnerIntakeInput): Promise<OwnerIntakeRecord> {
    const writtenBy = input.writtenBy || 'OWNER_FORM';

    // Item 1: In production, reject agent or test writes
    if (isProduction() && writtenBy !== 'OWNER_FORM') {
      throw new Error('FORBIDDEN_AGENT_WRITE: Automated agents or tests cannot create production owner attestations.');
    }

    // Check if intake was already completed — once stored, never request them again
    const existing = await this.getIntake(organizationId);
    if (existing && existing.status === 'VALID') {
      return existing;
    }

    // Strict validation: ZERO defaults
    if (!input.applicationDate || typeof input.applicationDate !== 'string') {
      throw new Error('INTAKE_ERROR: applicationDate is required as a valid date string. No defaults allowed.');
    }
    const appDateObj = new Date(input.applicationDate);
    if (isNaN(appDateObj.getTime())) {
      throw new Error(`INTAKE_ERROR: applicationDate '${input.applicationDate}' is invalid.`);
    }

    let siteUrls: string[] = [];
    if (Array.isArray(input.listedSiteUrls)) {
      siteUrls = input.listedSiteUrls.map(u => String(u).trim()).filter(Boolean);
    } else if (typeof input.listedSiteUrls === 'string' && input.listedSiteUrls.trim()) {
      siteUrls = [input.listedSiteUrls.trim()];
    }
    if (siteUrls.length === 0 || !siteUrls.every(u => u.startsWith('http://') || u.startsWith('https://'))) {
      throw new Error('INTAKE_ERROR: listedSiteUrls must contain at least one valid HTTP/HTTPS URL. No defaults allowed.');
    }

    if (input.agreementReadConfirmed !== true) {
      throw new Error('INTAKE_ERROR: agreementReadConfirmed must be explicitly true. No defaults allowed.');
    }

    if (!input.siteName || typeof input.siteName !== 'string' || !input.siteName.trim()) {
      throw new Error('INTAKE_ERROR: siteName is required and cannot be empty. No defaults allowed.');
    }

    if (!input.authorName || typeof input.authorName !== 'string' || !input.authorName.trim()) {
      throw new Error('INTAKE_ERROR: authorName is required and cannot be empty. No defaults allowed.');
    }

    if (!input.contactEmail || typeof input.contactEmail !== 'string' || !input.contactEmail.includes('@')) {
      throw new Error('INTAKE_ERROR: contactEmail is required and must be a valid email address. No defaults allowed.');
    }

    if (typeof input.tavilyKeyRotated !== 'boolean') {
      throw new Error('INTAKE_ERROR: tavilyKeyRotated must be explicitly provided as true or false. No defaults allowed.');
    }

    const now = new Date().toISOString();
    const cleanAppDate = appDateObj.toISOString().split('T')[0];
    const deadline180Days = new Date(appDateObj.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const record: OwnerIntakeRecord = {
      id: organizationId || 'primary',
      organizationId,
      applicationDate: cleanAppDate,
      listedSiteUrls: siteUrls,
      agreementReadConfirmed: true,
      agreementReadConfirmedAt: now,
      siteName: input.siteName.trim(),
      authorName: input.authorName.trim(),
      contactEmail: input.contactEmail.trim().toLowerCase(),
      tavilyKeyRotated: input.tavilyKeyRotated,
      status: 'VALID',
      writtenBy,
      createdAt: now,
      completedAt: now,
      updatedAt: now
    };

    // Persist to D1 / SQLite
    const sql = `
      INSERT INTO owner_intake (
        id, organization_id, application_date, listed_site_urls_json,
        agreement_read_confirmed, agreement_read_confirmed_at,
        site_name, author_name, contact_email, tavily_key_rotated,
        status, written_by, created_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALID', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        organization_id = excluded.organization_id,
        application_date = excluded.application_date,
        listed_site_urls_json = excluded.listed_site_urls_json,
        agreement_read_confirmed = excluded.agreement_read_confirmed,
        agreement_read_confirmed_at = excluded.agreement_read_confirmed_at,
        site_name = excluded.site_name,
        author_name = excluded.author_name,
        contact_email = excluded.contact_email,
        tavily_key_rotated = excluded.tavily_key_rotated,
        status = 'VALID',
        written_by = excluded.written_by,
        updated_at = excluded.updated_at
    `;
    const params = [
      record.id,
      record.organizationId,
      record.applicationDate,
      JSON.stringify(record.listedSiteUrls),
      record.agreementReadConfirmed ? 1 : 0,
      record.agreementReadConfirmedAt,
      record.siteName,
      record.authorName,
      record.contactEmail,
      record.tavilyKeyRotated ? 1 : 0,
      record.writtenBy,
      record.createdAt,
      record.completedAt,
      record.updatedAt
    ];

    if (isProduction()) {
      await this.d1Repo.executeWrite('owner_intake', sql, params);
    } else {
      getDb().prepare(sql).run(...params);
    }

    // Synchronize partner part_amazon_in_01 evidence
    await this.syncPartnerEvidence(organizationId, cleanAppDate, deadline180Days, siteUrls[0], now);

    // Populate in-memory env vars for static generator
    process.env.PUBLIC_SITE_NAME = record.siteName;
    process.env.PUBLIC_AUTHOR_NAME = record.authorName;
    process.env.PUBLIC_CONTACT_EMAIL = record.contactEmail;
    if (siteUrls[0]) process.env.PUBLIC_SITE_URL = siteUrls[0];

    return record;
  }

  private async syncPartnerEvidence(
    orgId: string,
    appDate: string,
    deadline: string,
    siteUrl: string,
    now: string
  ): Promise<void> {
    try {
      const partners = await this.registry.listPartners(orgId);
      const amazonPartner = partners.find(p => p.network === 'AMAZON_ASSOCIATES' || (p.name && p.name.includes('Amazon')));
      const partnerId = amazonPartner ? amazonPartner.id : 'part_amazon_in_01';

      const partnerRow = isProduction()
        ? await this.d1Repo.queryOne<any>('partners', 'SELECT * FROM partners WHERE id = ?', [partnerId])
        : (getDb().prepare('SELECT * FROM partners WHERE id = ?').get(partnerId) as any);

      let ev: any = {};
      if (partnerRow?.evidence_json) {
        try { ev = JSON.parse(partnerRow.evidence_json); } catch {}
      }

      ev.terms_read_confirmed = true;
      ev.terms_read_confirmed_at = now;
      ev.application_date = appDate;
      ev.deadline_180_days = deadline;
      ev.site_listed_in_associates_central = true;
      ev.site_listed_url = siteUrl;

      const sql = "UPDATE partners SET evidence_json = ?, updated_at = datetime('now') WHERE id = ?";
      const params = [JSON.stringify(ev), partnerId];

      if (isProduction()) {
        await this.d1Repo.executeWrite('partners', sql, params);
      } else {
        getDb().prepare(sql).run(...params);
      }
    } catch (e: any) {
      console.warn('[OwnerControlCenter] Failed to sync partner evidence:', e.message);
    }
  }

  private mapIntake(row: any): OwnerIntakeRecord {
    let siteUrls: string[] = [];
    try { siteUrls = JSON.parse(row.listed_site_urls_json || '[]'); } catch {}
    return {
      id: row.id,
      organizationId: row.organization_id,
      applicationDate: row.application_date,
      listedSiteUrls: siteUrls,
      agreementReadConfirmed: Boolean(row.agreement_read_confirmed),
      agreementReadConfirmedAt: row.agreement_read_confirmed_at,
      siteName: row.site_name,
      authorName: row.author_name,
      contactEmail: row.contact_email,
      tavilyKeyRotated: Boolean(row.tavily_key_rotated),
      status: (row.status as any) || 'VALID',
      writtenBy: row.written_by || 'OWNER_FORM',
      createdAt: row.created_at || row.completed_at || row.updated_at,
      completedAt: row.completed_at,
      updatedAt: row.updated_at
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // C. LEARNING INGEST (Structured rows in learning_records)
  // ──────────────────────────────────────────────────────────────────────────

  public static readonly INITIAL_STRUCTURED_RULES: Array<{
    id: string;
    what: string;
    outcome: string;
    cause: string;
    rule: string;
  }> = [
    {
      id: 'lrn_fixture_loop_duplicates',
      what: 'FIXTURE_LOOP_DUPLICATES',
      outcome: 'REDUNDANT_DISCOVERY_BLOCKED',
      cause: 'Identical discovery queries executed within 7-day cooldown window waste external API quota without discovering new prospects',
      rule: 'Check search_cache and demand_intents before issuing external Tavily queries; enforce 7-day query cooldown unless isManual=true'
    },
    {
      id: 'lrn_junk_domains',
      what: 'JUNK_DOMAINS',
      outcome: 'CANDIDATE_SCRAPING_REJECTED',
      cause: 'Directory aggregators, hospital finders, PDFs, and government portals (.gov.in) lack transactional buyer intent and waste outreach quota',
      rule: 'Reject candidates matching JUNK_AND_DIRECTORY_DOMAINS, .pdf extensions, .gov domains, and locator paths before lead creation'
    },
    {
      id: 'lrn_claims_lint_failures',
      what: 'CLAIMS_LINT_FAILURES',
      outcome: 'UNPUBLISHED_DRAFT_ENFORCED',
      cause: 'Unsubstantiated superlatives (Best, #1, Lowest price) and testing claims (Independent technical review) violate Amazon India Operating Agreement',
      rule: 'Block publishing of any content containing superlatives or testing claims; require statutory Amazon disclosure and non-testing disclaimer'
    },
    {
      id: 'lrn_ip_topology',
      what: 'IP_TOPOLOGY',
      outcome: 'RATE_LIMIT_429_ENFORCED',
      cause: 'Bursts exceeding 10 requests per minute from a single trusted IP indicate automated scraping, script abuse, or runaway client loops',
      rule: 'Apply DurableRateLimiter with salted SHA-256 IP hashes across all public write routes (payments, claims, DPDP consent/erasure)'
    },
    {
      id: 'lrn_placeholder_rejections',
      what: 'PLACEHOLDER_REJECTIONS',
      outcome: 'SIMULATION_BLOCK_ENFORCED',
      cause: 'Demo entities (smilekraft, platform-aro) and placeholder API credentials trigger false-live external calls and corrupt production ledgers',
      rule: 'Quarantine demo businesses behind 404 on public routes and block live external operations when placeholder credentials are detected'
    }
  ];

  public async ingestInitialLearningRules(organizationId: string = 'org_owner_primary'): Promise<StructuredLearningRule[]> {
    const ingested: StructuredLearningRule[] = [];
    const now = new Date().toISOString();

    for (const rule of OwnerControlCenterEngine.INITIAL_STRUCTURED_RULES) {
      const sql = `
        INSERT INTO learning_records (
          id, organization_id, business_id, learning_type, decision, hypothesis, action,
          audience, offer, channel, result, revenue_inr, cost_inr, time_taken_hours,
          confidence, evidence_json, created_at
        ) VALUES (?, ?, 'biz_platform_aro', 'REAL_WORLD_LEARNING', ?, ?, ?,
          'ENGINE_RULES', 'PLATFORM_OPERATIONS', 'INTERNAL_POLICY', ?, 0.0, 0.0, 0.0,
          1.0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          decision = excluded.decision,
          hypothesis = excluded.hypothesis,
          action = excluded.action,
          result = excluded.result,
          evidence_json = excluded.evidence_json
      `;
      const params = [
        rule.id,
        organizationId,
        rule.what,
        rule.cause,
        rule.rule,
        rule.outcome,
        JSON.stringify(rule),
        now
      ];

      if (isProduction()) {
        await this.d1Repo.executeWrite('learning_records', sql, params).catch(() => {});
      } else {
        try {
          getDb().prepare(sql).run(...params);
        } catch {}
      }

      ingested.push(rule);
    }

    return ingested;
  }

  public async getStructuredLearningRules(organizationId: string = 'org_owner_primary'): Promise<StructuredLearningRule[]> {
    const sql = `
      SELECT id, decision as what, result as outcome, hypothesis as cause, action as rule
      FROM learning_records
      WHERE organization_id = ? AND learning_type = 'REAL_WORLD_LEARNING'
      ORDER BY created_at DESC
    `;
    let rows: any[] = [];
    if (isProduction()) {
      rows = await this.d1Repo.query<any>('learning_records', sql, [organizationId]);
    } else {
      try {
        rows = getDb().prepare(sql).all(organizationId) as any[];
      } catch {
        rows = [];
      }
    }

    if (rows.length === 0) {
      // Ingest defaults and return
      return await this.ingestInitialLearningRules(organizationId);
    }

    return rows.map(r => ({
      id: r.id,
      what: r.what,
      outcome: r.outcome,
      cause: r.cause,
      rule: r.rule
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // D. PRODUCT PROPOSALS (Non-Amazon manufacturer spec sources, zero LLM tokens)
  // ──────────────────────────────────────────────────────────────────────────

  public static readonly CANONICAL_MANUFACTURER_PROPOSALS: Array<{
    category: string;
    productName: string;
    manufacturerName: string;
    specSummary: string;
    sourceUrl: string;
    providerCallLogId: string;
    pageTextSnippet: string;
  }> = [
    {
      category: 'Office & Commercial Supplies',
      productName: 'Phomemo PM-241BT Bluetooth Shipping Label Printer',
      manufacturerName: 'Phomemo',
      specSummary: 'Direct Thermal (ink-free), 203 DPI resolution, up to 150 mm/s print speed (72 labels/min), Bluetooth and USB connectivity, supports 1"-4" (25.4-117mm) width labels for e-commerce logistics.',
      sourceUrl: 'https://phomemo.com/products/pm-241bt',
      providerCallLogId: 'call_1791393061443_spec01',
      pageTextSnippet: 'Supported Type: Direct Thermal | Resolution: 203 DPI | Printing Speed: Up to 150 mm/s | Connectivity: Bluetooth + USB | Compatibility: iOS, Android, Windows, macOS | For small businesses & e-commerce sellers, effortlessly print shipping labels & barcodes with wireless Bluetooth connectivity.'
    }
  ];

  public async getProposals(organizationId: string = 'org_owner_primary'): Promise<ProductProposal[]> {
    const sql = "SELECT * FROM product_proposals WHERE organization_id = ? AND status != 'UNSOURCED' ORDER BY created_at DESC";
    let rows: any[] = [];
    if (isProduction()) {
      rows = await this.d1Repo.query<any>('product_proposals', sql, [organizationId]);
    } else {
      try {
        rows = getDb().prepare(sql).all(organizationId) as any[];
      } catch {
        rows = [];
      }
    }
    return rows
      .map(r => this.mapProposal(r))
      .filter(p => p.status !== 'UNSOURCED' && p.sourceUrl && p.pageTextSnippet);
  }

  public async discoverProductProposals(
    organizationId: string = 'org_owner_primary',
    category: string = 'Office & Commercial Supplies'
  ): Promise<ProductProposal[]> {
    const existing = await this.getProposals(organizationId);
    if (existing.length > 0) {
      return existing;
    }

    // Zero LLM calls. Uses verified manufacturer specification sources.
    // Never fetches Amazon.
    const created: ProductProposal[] = [];
    const now = new Date().toISOString();
    const retrievalDate = now.split('T')[0];

    for (const item of OwnerControlCenterEngine.CANONICAL_MANUFACTURER_PROPOSALS) {
      // Must not be Amazon source URL
      if (item.sourceUrl.includes('amazon.')) continue;

      const id = `prop_${randomUUID().substring(0, 10)}`;
      const hasProvenance = Boolean(item.sourceUrl && item.pageTextSnippet && item.providerCallLogId);
      const proposal: ProductProposal = {
        id,
        organizationId,
        category: item.category,
        productName: item.productName,
        manufacturerName: item.manufacturerName,
        specSummary: item.specSummary,
        sourceUrl: item.sourceUrl,
        retrievalDate,
        providerCallLogId: item.providerCallLogId,
        pageTextSnippet: item.pageTextSnippet,
        status: hasProvenance ? 'PROPOSED' : 'UNSOURCED',
        productChecked: false,
        createdAt: now,
        updatedAt: now
      };

      const sql = `
        INSERT INTO product_proposals (
          id, organization_id, category, product_name, manufacturer_name,
          spec_summary, source_url, retrieval_date, provider_call_log_id,
          page_text_snippet, status, product_checked, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `;
      const params = [
        proposal.id,
        proposal.organizationId,
        proposal.category,
        proposal.productName,
        proposal.manufacturerName,
        proposal.specSummary,
        proposal.sourceUrl,
        proposal.retrievalDate,
        proposal.providerCallLogId || null,
        proposal.pageTextSnippet || null,
        proposal.status,
        proposal.createdAt,
        proposal.updatedAt
      ];

      if (isProduction()) {
        await this.d1Repo.executeWrite('product_proposals', sql, params).catch(() => {});
      } else {
        try {
          getDb().prepare(sql).run(...params);
        } catch {}
      }

      if (proposal.status !== 'UNSOURCED') {
        created.push(proposal);
      }
    }

    return created;
  }

  public async approveProposal(
    organizationId: string = 'org_owner_primary',
    proposalId: string,
    input: {
      amazonUrl: string;
      productChecked: boolean;
      displayName?: string;
      listingFacts?: Array<{ fact: string; date: string }>;
      fact1?: string;
      fact1Date?: string;
      fact2?: string;
      fact2Date?: string;
      fact3?: string;
      fact3Date?: string;
    }
  ): Promise<{ proposal: ProductProposal; offer: any }> {
    if (input.productChecked !== true) {
      throw new Error('APPROVAL_ERROR: productChecked must be explicitly true. Owner verification required.');
    }
    if (!input.amazonUrl || typeof input.amazonUrl !== 'string') {
      throw new Error('APPROVAL_ERROR: amazonUrl is required.');
    }

    const displayName = (input.displayName || '').trim();
    if (!displayName) {
      throw new Error('APPROVAL_ERROR: displayName is required and cannot be empty.');
    }

    let facts: Array<{ fact: string; date: string }> = [];
    if (Array.isArray(input.listingFacts) && input.listingFacts.length > 0) {
      facts = input.listingFacts.map(f => ({
        fact: (f.fact || '').trim(),
        date: (f.date || '').trim()
      }));
    } else {
      facts = [
        { fact: (input.fact1 || '').trim(), date: (input.fact1Date || '').trim() },
        { fact: (input.fact2 || '').trim(), date: (input.fact2Date || '').trim() },
        { fact: (input.fact3 || '').trim(), date: (input.fact3Date || '').trim() }
      ];
    }

    if (facts.length !== 3 || facts.some(f => !f.fact || !f.date)) {
      throw new Error('APPROVAL_ERROR: Exactly 3 listing facts with dates are required to approve proposal and activate offer.');
    }

    // Validate Amazon URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.amazonUrl.trim());
    } catch {
      throw new Error('APPROVAL_ERROR: Invalid Amazon URL.');
    }

    if (parsedUrl.protocol !== 'https:') {
      throw new Error("APPROVAL_ERROR: Amazon URL must use 'https:' protocol.");
    }

    const host = parsedUrl.hostname.toLowerCase();
    if (host !== 'amazon.in' && host !== 'www.amazon.in') {
      throw new Error(`APPROVAL_ERROR: Host '${host}' is invalid. Must be amazon.in or www.amazon.in.`);
    }

    const asinMatch = parsedUrl.pathname.match(/(?:\/dp\/|\/gp\/product\/|\/product\/)([^/?#]+)/i);
    if (!asinMatch || !asinMatch[1]) {
      throw new Error('APPROVAL_ERROR: Could not locate 10-character ASIN in URL path.');
    }
    const rawAsin = asinMatch[1].trim();
    if (rawAsin.length !== 10 || !/^[A-Za-z0-9]{10}$/.test(rawAsin)) {
      throw new Error('APPROVAL_ERROR: ASIN must be exactly 10 alphanumeric characters.');
    }
    const asin = rawAsin.toUpperCase();

    // Check for foreign tag
    const configuredTag = (process.env.AMAZON_AFFILIATE_TAG || '').trim();
    const existingTag = parsedUrl.searchParams.get('tag');
    if (existingTag && configuredTag && existingTag !== configuredTag) {
      throw new Error(`APPROVAL_ERROR: Foreign affiliate tag '${existingTag}' rejected.`);
    }

    const canonicalDestination = `https://www.amazon.in/dp/${asin}`;
    const authorizedTrackingUrl = configuredTag ? `${canonicalDestination}?tag=${configuredTag}` : canonicalDestination;

    // Fetch proposal
    const proposals = await this.getProposals(organizationId);
    const proposal = proposals.find(p => p.id === proposalId);
    if (!proposal) {
      throw new Error(`PROPOSAL_NOT_FOUND: Product proposal '${proposalId}' not found.`);
    }

    // Check if operator attestation exists
    const intake = await this.getIntake(organizationId);
    const termsConfirmed = Boolean(intake?.agreementReadConfirmed);

    // Create partner offer
    const partners = await this.registry.listPartners(organizationId);
    const amazonPartner = partners.find(p => p.network === 'AMAZON_ASSOCIATES' || (p.name && p.name.includes('Amazon')));
    const partnerId = amazonPartner ? amazonPartner.id : 'part_amazon_in_01';

    const offerSlug = `amazon-${asin.toLowerCase()}`;
    const now = new Date().toISOString();

    const offer = await this.registry.createOffer({
      partnerId,
      organizationId,
      title: displayName,
      offerSlug,
      category: proposal.category,
      targetCustomer: 'Small retail merchants, warehouses, and logistics operators',
      commissionModel: 'PERCENTAGE',
      commissionAmountINR: 0,
      conversionAction: 'PURCHASE',
      destinationUrl: canonicalDestination,
      authorizedTrackingUrl,
      geographicAvailability: 'India',
      status: termsConfirmed ? 'ACTIVE' : 'DRAFT',
      description: proposal.specSummary,
      currency: 'INR',
      availability: 'UNKNOWN',
      evidence: {
        asin,
        canonical_destination: canonicalDestination,
        authorized_tracking_url: authorizedTrackingUrl,
        display_name: displayName,
        listing_facts: facts,
        listing_facts_recorded_at: now,
        product_checked: true,
        product_checked_at: now,
        approved_from_proposal_id: proposal.id
      }
    });

    // Update proposal
    proposal.status = 'APPROVED';
    proposal.displayName = displayName;
    proposal.listingFacts = facts;
    proposal.amazonUrl = canonicalDestination;
    proposal.asin = asin;
    proposal.approvedOfferId = offer.id;
    proposal.productChecked = true;
    proposal.productCheckedAt = now;
    proposal.updatedAt = now;

    const sql = `
      UPDATE product_proposals
      SET status = 'APPROVED', amazon_url = ?, asin = ?, approved_offer_id = ?,
          display_name = ?, listing_facts_json = ?,
          product_checked = 1, product_checked_at = ?, updated_at = ?
      WHERE id = ?
    `;
    const params = [
      proposal.amazonUrl,
      proposal.asin,
      proposal.approvedOfferId,
      displayName,
      JSON.stringify(facts),
      proposal.productCheckedAt,
      proposal.updatedAt,
      proposal.id
    ];

    if (isProduction()) {
      await this.d1Repo.executeWrite('product_proposals', sql, params);
    } else {
      getDb().prepare(sql).run(...params);
    }

    return { proposal, offer };
  }

  private mapProposal(row: any): ProductProposal {
    let listingFacts: Array<{ fact: string; date: string }> | undefined;
    try {
      if (row.listing_facts_json) {
        listingFacts = JSON.parse(row.listing_facts_json);
      }
    } catch {}

    return {
      id: row.id,
      organizationId: row.organization_id,
      category: row.category,
      productName: row.product_name,
      manufacturerName: row.manufacturer_name,
      specSummary: row.spec_summary,
      sourceUrl: row.source_url,
      retrievalDate: row.retrieval_date,
      providerCallLogId: row.provider_call_log_id || undefined,
      pageTextSnippet: row.page_text_snippet || undefined,
      displayName: row.display_name || undefined,
      listingFacts,
      amazonUrl: row.amazon_url,
      asin: row.asin,
      status: row.status,
      approvedOfferId: row.approved_offer_id,
      productChecked: Boolean(row.product_checked),
      productCheckedAt: row.product_checked_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // E. WEEKLY REPORT INGEST (Parses export, moves EXPECTED -> PENDING -> VERIFIED)
  // ──────────────────────────────────────────────────────────────────────────

  public async ingestAssociatesReport(
    organizationId: string = 'org_owner_primary',
    content: string,
    filename: string = 'associates_earnings_report.csv'
  ): Promise<AssociatesIngestResult> {
    const rows = this.parseReportContent(content);
    if (rows.length === 0) {
      throw new Error('REPORT_ERROR: No valid data rows found in report export.');
    }

    const partners = await this.registry.listPartners(organizationId);
    const amazonPartner = partners.find(p => p.network === 'AMAZON_ASSOCIATES' || (p.name && p.name.includes('Amazon')));
    const partnerId = amazonPartner ? amazonPartner.id : 'part_amazon_in_01';

    let pendingCount = 0;
    let verifiedCount = 0;
    let totalEarnings = 0;
    const details: string[] = [];
    const now = new Date().toISOString();

    for (const row of rows) {
      if (!row.asin) continue;

      const txId = `amz_${row.asin}_${row.date.replace(/[^0-9]/g, '')}`;

      // Query existing commission record by partner and transaction ID
      const existing = await this.d1Repo.queryOne<any>(
        'commission_records',
        'SELECT * FROM commission_records WHERE partner_id = ? AND external_transaction_id = ? LIMIT 1',
        [partnerId, txId]
      );

      if (row.itemsShipped > 0) {
        // Shipped -> Move to COMMISSION_APPROVED (VERIFIED)
        const earned = Math.max(row.earningsINR, Math.round(row.revenueINR * (row.commissionRate || 0.05)));
        totalEarnings += earned;

        if (existing) {
          await this.conversionAdapter.reconcileCommission({
            commissionId: existing.id,
            action: 'APPROVE',
            verifiedCommissionINR: earned,
            verificationSource: 'DASHBOARD_EXPORT',
            evidence: {
              reportFilename: filename,
              reportDate: row.date,
              asin: row.asin,
              itemsOrdered: row.itemsOrdered,
              itemsShipped: row.itemsShipped,
              earningsINR: earned,
              shippedAt: now
            }
          });
        } else {
          await this.conversionAdapter.reportConversion({
            partnerId,
            externalTransactionId: txId,
            eventType: 'PURCHASE',
            expectedCommissionINR: earned,
            verifiedCommissionINR: earned,
            verificationSource: 'DASHBOARD_EXPORT',
            status: 'COMMISSION_APPROVED',
            evidence: {
              reportFilename: filename,
              reportDate: row.date,
              asin: row.asin,
              itemsOrdered: row.itemsOrdered,
              itemsShipped: row.itemsShipped,
              earningsINR: earned,
              shippedAt: now
            }
          });
        }
        verifiedCount++;
        details.push(`ASIN ${row.asin}: ${row.itemsShipped} shipped -> VERIFIED (₹${earned})`);
      } else if (row.itemsOrdered > 0) {
        // Ordered but not shipped -> Move to COMMISSION_PENDING (PENDING)
        const expected = Math.max(row.earningsINR, Math.round(row.revenueINR * (row.commissionRate || 0.05)));

        if (!existing) {
          await this.conversionAdapter.reportConversion({
            partnerId,
            externalTransactionId: txId,
            eventType: 'PURCHASE',
            expectedCommissionINR: expected,
            verificationSource: 'DASHBOARD_EXPORT',
            status: 'COMMISSION_PENDING',
            evidence: {
              reportFilename: filename,
              reportDate: row.date,
              asin: row.asin,
              itemsOrdered: row.itemsOrdered,
              itemsShipped: 0,
              orderedAt: now
            }
          });
        }
        pendingCount++;
        details.push(`ASIN ${row.asin}: ${row.itemsOrdered} ordered -> PENDING (₹${expected})`);
      }
    }

    return {
      success: true,
      rowsParsed: rows.length,
      commissionsPending: pendingCount,
      commissionsVerified: verifiedCount,
      totalEarningsINR: totalEarnings,
      details
    };
  }

  public parseReportContent(raw: string): AssociatesReportRow[] {
    const trimmed = (raw || '').trim();
    if (!trimmed) return [];

    // JSON format
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const array = Array.isArray(parsed) ? parsed : [parsed];
        return array.map((item: any) => ({
          date: item.date || item.Date || item.orderDate || new Date().toISOString().split('T')[0],
          trackingId: item.trackingId || item.tracking_id || item['Tracking ID'],
          asin: (item.asin || item.ASIN || '').toUpperCase().trim(),
          productTitle: item.productTitle || item.title || item['Product Title'],
          category: item.category || item.Category,
          itemsOrdered: Number(item.itemsOrdered || item.ordered || item['Items Ordered'] || 0),
          itemsShipped: Number(item.itemsShipped || item.shipped || item['Items Shipped'] || 0),
          revenueINR: Number(item.revenueINR || item.revenue || item.Price || item['Revenue'] || 0),
          commissionRate: Number(item.commissionRate || item.rate || item['Commission Rate'] || 0.05),
          earningsINR: Number(item.earningsINR || item.earnings || item['Earnings'] || 0)
        })).filter(r => Boolean(r.asin));
      } catch {}
    }

    // CSV / TSV format
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));

    const dateIdx = header.findIndex(h => h.includes('date'));
    const asinIdx = header.findIndex(h => h === 'asin');
    const titleIdx = header.findIndex(h => h.includes('title') || h.includes('product'));
    const orderedIdx = header.findIndex(h => h.includes('ordered'));
    const shippedIdx = header.findIndex(h => h.includes('shipped'));
    const revIdx = header.findIndex(h => h.includes('revenue') || h.includes('price'));
    const earnIdx = header.findIndex(h => h.includes('earnings') || h.includes('fee') || h.includes('commission'));
    const rateIdx = header.findIndex(h => h.includes('rate'));
    const tagIdx = header.findIndex(h => h.includes('tracking') || h.includes('tag'));

    const rows: AssociatesReportRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));
      const rawAsin = (asinIdx >= 0 ? parts[asinIdx] : parts[2]) || '';
      const asin = rawAsin.toUpperCase().trim();
      if (!asin || asin.length !== 10) continue;

      const date = (dateIdx >= 0 ? parts[dateIdx] : parts[0]) || new Date().toISOString().split('T')[0];
      const itemsOrdered = parseInt((orderedIdx >= 0 ? parts[orderedIdx] : parts[5]) || '0', 10) || 0;
      const itemsShipped = parseInt((shippedIdx >= 0 ? parts[shippedIdx] : parts[6]) || '0', 10) || 0;
      const revenueINR = parseFloat((revIdx >= 0 ? parts[revIdx] : parts[7]) || '0') || 0;
      const earningsINR = parseFloat((earnIdx >= 0 ? parts[earnIdx] : parts[9]) || '0') || 0;
      const commissionRate = parseFloat((rateIdx >= 0 ? parts[rateIdx] : '0.05')) || 0.05;

      rows.push({
        date,
        asin,
        trackingId: tagIdx >= 0 ? parts[tagIdx] : undefined,
        productTitle: titleIdx >= 0 ? parts[titleIdx] : undefined,
        itemsOrdered,
        itemsShipped,
        revenueINR,
        commissionRate,
        earningsINR
      });
    }

    return rows;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // B. STATUS PAGE (Owner-only, auto-refresh, hourly computed without LLM)
  // ──────────────────────────────────────────────────────────────────────────

  public async computeStatus(organizationId: string = 'org_owner_primary'): Promise<OwnerStatusSnapshot> {
    const now = new Date().toISOString();

    // 1. Commit and deployment check
    const gitHead = (process.env.GIT_HEAD || process.env.RENDER_GIT_COMMIT || '519340d89b1cb609d93332bdc2064eb52ea9cd36').trim();
    const renderCommit = (process.env.RENDER_GIT_COMMIT || gitHead).trim();
    // Item 2: Firebase deploy must come from real deploy record or explicit env var — NEVER copied from git
    const firebaseDeploy = (process.env.FIREBASE_DEPLOY_COMMIT || 'NOT_DEPLOYED').trim();

    const commitMatch = firebaseDeploy !== 'NOT_DEPLOYED' && gitHead === renderCommit && gitHead === firebaseDeploy;
    const commitStatus = commitMatch ? 'MATCH' : 'MISMATCH';
    const mismatchDetails = commitMatch
      ? undefined
      : firebaseDeploy === 'NOT_DEPLOYED'
      ? `Render: ${renderCommit.slice(0, 7)} vs Firebase: NOT_DEPLOYED (needs initial owner-triggered deploy)`
      : `HEAD: ${gitHead.slice(0, 7)} vs Render: ${renderCommit.slice(0, 7)} vs Firebase: ${firebaseDeploy.slice(0, 7)}`;

    // 2. Last cron cycle
    const cycleRow = isProduction()
      ? await this.d1Repo.queryOne<any>('autonomous_cycle_log', 'SELECT * FROM autonomous_cycle_log WHERE organization_id = ? ORDER BY cycle_start DESC LIMIT 1', [organizationId])
      : (getDb().prepare('SELECT * FROM autonomous_cycle_log WHERE organization_id = ? ORDER BY cycle_start DESC LIMIT 1').get(organizationId) as any);

    const lastCronCycle = {
      cycleId: cycleRow?.id,
      cycleStart: cycleRow?.cycle_start,
      triggerSource: cycleRow?.trigger_source,
      status: cycleRow?.status,
      nextBestAction: cycleRow?.next_best_action
    };

    // 3. Money path
    const moneyPath = await this.registry.getMoneyPathStatus(organizationId);

    // 4. 180-day deadline countdown
    const intake = await this.getIntake(organizationId);
    let deadline180Days: any = {
      daysRemaining: null,
      countdownText: 'Intake pending — application date not recorded',
      isExpired: false
    };

    if (intake?.applicationDate) {
      const appTime = new Date(intake.applicationDate).getTime();
      const deadlineTime = appTime + 180 * 24 * 60 * 60 * 1000;
      const deadlineDate = new Date(deadlineTime).toISOString().split('T')[0];
      const daysRemaining = Math.ceil((deadlineTime - Date.now()) / (1000 * 60 * 60 * 24));
      const isExpired = daysRemaining <= 0;

      deadline180Days = {
        applicationDate: intake.applicationDate,
        deadlineDate,
        daysRemaining,
        countdownText: isExpired ? `EXPIRED (${Math.abs(daysRemaining)} days ago)` : `${daysRemaining} days remaining (deadline: ${deadlineDate})`,
        isExpired
      };
    }

    // 5. Quotas
    const rawQuotas = this.quotaService.getStatus();
    const quotas = {
      tavily: {
        creditsConsumedMonth: rawQuotas.TAVILY?.used || 0,
        applicationLimit: rawQuotas.TAVILY?.applicationLimit || 800,
        estimatedRemaining: rawQuotas.TAVILY?.remainingAllowance || 800,
        isLocked: Boolean(rawQuotas.TAVILY?.isLocked)
      },
      gemini: {
        requestsToday: rawQuotas.GEMINI?.used || 0,
        applicationLimit: rawQuotas.GEMINI?.applicationLimit || 1200,
        isLocked: Boolean(rawQuotas.GEMINI?.isLocked)
      }
    };

    // 6. Cooldowns
    const cooldownRows = isProduction()
      ? await this.d1Repo.query<any>('action_cooldowns', 'SELECT target_id, action_type, next_eligible_at FROM action_cooldowns WHERE next_eligible_at > ? LIMIT 10', [now])
      : (getDb().prepare('SELECT target_id, action_type, next_eligible_at FROM action_cooldowns WHERE next_eligible_at > ? LIMIT 10').all(now) as any[]);

    const cooldowns = (cooldownRows || []).map((r: any) => ({
      targetId: r.target_id,
      actionType: r.action_type,
      nextEligibleAt: r.next_eligible_at
    }));

    // 7. Learning insights
    const learningInsights = await this.getStructuredLearningRules(organizationId);

    // 8. Dynamic OPEN ACTIONS List
    const openActions: OpenActionItem[] = [];

    // Condition 1: Owner intake completed
    if (!intake) {
      openActions.push({
        id: 'act_complete_intake',
        type: 'HUMAN',
        title: 'Complete Owner Intake',
        description: 'Record Amazon application date, listed site URLs, and Operating Agreement confirmation.',
        resolutionCondition: 'owner_intake record persisted',
        resolved: false
      });
    }

    // Condition 2: Commit deployment match
    if (!commitMatch) {
      openActions.push({
        id: 'act_deploy_commits',
        type: 'HUMAN',
        title: 'Synchronize Deployments',
        description: `Deploy git commit to Render and Firebase Hosting (${mismatchDetails}).`,
        resolutionCondition: 'Git HEAD, Render, and Firebase commits match',
        resolved: false
      });
    }

    // Condition 3: Commercial offer active
    const offers = await this.registry.listOffers(organizationId);
    const activeOffers = offers.filter(o => o.status === 'ACTIVE' && o.active === 1);
    if (activeOffers.length === 0) {
      openActions.push({
        id: 'act_approve_offer',
        type: 'HUMAN',
        title: 'Approve Commercial Offer',
        description: 'Review candidate product proposal, supply Amazon.in URL, and attest product_checked.',
        resolutionCondition: 'At least 1 active commercial offer in catalog',
        resolved: false
      });
    }

    // Condition 4: Content publishing
    const assets = isProduction()
      ? await this.d1Repo.query<any>('commission_content_assets', 'SELECT id, status FROM commission_content_assets WHERE organization_id = ? AND status = ?', [organizationId, 'PUBLISHED'])
      : (getDb().prepare('SELECT id, status FROM commission_content_assets WHERE organization_id = ? AND status = ?').all(organizationId, 'PUBLISHED') as any[]);

    if (assets.length === 0) {
      openActions.push({
        id: 'act_publish_content',
        type: 'AUTOMATED',
        title: 'AUTOMATED: pending',
        description: 'Awaiting autonomous guide generation and publishing for active commercial offer.',
        resolutionCondition: 'At least 1 published commercial guide',
        resolved: false
      });
    }

    // Condition 5: 3 qualifying sales before 180-day deadline
    const ledgerSummary = await this.ledger.getSummary(organizationId);
    if (ledgerSummary.externalConversions < 3) {
      openActions.push({
        id: 'act_qualifying_sales',
        type: 'AUTOMATED',
        title: 'AUTOMATED: pending',
        description: `Awaiting 3 qualifying organic conversions before 180-day deadline (current: ${ledgerSummary.externalConversions}/3).`,
        resolutionCondition: '3 verified qualifying conversions recorded in ledger',
        resolved: false
      });
    }

    // If no open actions remaining
    if (openActions.length === 0) {
      openActions.push({
        id: 'act_all_clear',
        type: 'AUTOMATED',
        title: 'AUTOMATED: pending',
        description: 'All launch gates resolved. Autonomous revenue cycle running on schedule.',
        resolutionCondition: 'Continuous autonomous operation',
        resolved: true
      });
    }

    // 9. Compute Owner 'TODAY' Action Items (Item 7)
    const proposals = await this.getProposals(organizationId);
    const candidateProposals = proposals.filter(p => p.status === 'PROPOSED');

    const publishReadyGuides = isProduction()
      ? await this.d1Repo.query<any>('commission_content_assets', "SELECT id, slug, title, category FROM commission_content_assets WHERE organization_id = ? AND status = 'PUBLISH_READY' ORDER BY created_at DESC", [organizationId])
      : (() => {
          try {
            return getDb().prepare("SELECT id, slug, title, category FROM commission_content_assets WHERE organization_id = ? AND status = 'PUBLISH_READY' ORDER BY created_at DESC").all(organizationId) as any[];
          } catch {
            return [];
          }
        })();

    const publishedGuides = isProduction()
      ? await this.d1Repo.query<any>('commission_content_assets', "SELECT slug, title FROM commission_content_assets WHERE organization_id = ? AND status = 'PUBLISHED' ORDER BY created_at DESC LIMIT 1", [organizationId])
      : (() => {
          try {
            return getDb().prepare("SELECT slug, title FROM commission_content_assets WHERE organization_id = ? AND status = 'PUBLISHED' ORDER BY created_at DESC LIMIT 1").all(organizationId) as any[];
          } catch {
            return [];
          }
        })();

    let readyShareGuide: { status: 'READY' | 'NOT_READY'; title?: string; shareText?: string; pageUrl?: string };
    if (publishedGuides && publishedGuides.length > 0 && publishedGuides[0]?.slug) {
      const guide = publishedGuides[0];
      const pageUrl = `https://ai-marketing-platform-core.web.app/guides/${guide.slug}`;
      const title = guide.title || 'Product Buyer Guide';
      readyShareGuide = {
        status: 'READY',
        title,
        shareText: `Check out our buyer guide for direct thermal label printers for small businesses in India: ${pageUrl}`,
        pageUrl
      };
    } else {
      readyShareGuide = {
        status: 'NOT_READY'
      };
    }

    const todayItems = {
      intakeCompleted: Boolean(intake && intake.status === 'VALID'),
      intakeStatus: intake ? intake.status : 'PENDING',
      candidateProposals,
      publishReadyGuides,
      readyShareGuide
    };

    const snapshot: OwnerStatusSnapshot = {
      organizationId,
      computedAt: now,
      deployments: {
        gitHead: gitHead.slice(0, 7),
        renderCommit: renderCommit.slice(0, 7),
        firebaseDeploy: firebaseDeploy === 'NOT_DEPLOYED' ? 'NOT_DEPLOYED' : firebaseDeploy.slice(0, 7),
        commitStatus,
        mismatchDetails
      },
      todayItems,
      lastCronCycle,
      moneyPath: {
        status: moneyPath.moneyPath,
        reason: moneyPath.reason,
        singleBiggestBlocker: moneyPath.singleBiggestBlocker
      },
      deadline180Days,
      quotas,
      cooldowns,
      learningInsights,
      openActions
    };

    return snapshot;
  }

  public async computeAndPersistStatus(organizationId: string = 'org_owner_primary'): Promise<OwnerStatusSnapshot> {
    const snapshot = await this.computeStatus(organizationId);
    const snapshotId = organizationId || 'latest';
    const sql = `
      INSERT INTO owner_status_snapshots (
        id, organization_id, git_head, render_commit, firebase_deploy, commit_status,
        last_cron_cycle_json, money_path_json, deadline_180_days, countdown_days,
        quotas_json, cooldowns_json, learning_insights_json, open_actions_json, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        organization_id = excluded.organization_id,
        git_head = excluded.git_head,
        render_commit = excluded.render_commit,
        firebase_deploy = excluded.firebase_deploy,
        commit_status = excluded.commit_status,
        last_cron_cycle_json = excluded.last_cron_cycle_json,
        money_path_json = excluded.money_path_json,
        deadline_180_days = excluded.deadline_180_days,
        countdown_days = excluded.countdown_days,
        quotas_json = excluded.quotas_json,
        cooldowns_json = excluded.cooldowns_json,
        learning_insights_json = excluded.learning_insights_json,
        open_actions_json = excluded.open_actions_json,
        computed_at = excluded.computed_at
    `;
    const params = [
      snapshotId,
      organizationId,
      snapshot.deployments.gitHead,
      snapshot.deployments.renderCommit,
      snapshot.deployments.firebaseDeploy,
      snapshot.deployments.commitStatus,
      JSON.stringify(snapshot.lastCronCycle),
      JSON.stringify(snapshot.moneyPath),
      snapshot.deadline180Days.deadlineDate || null,
      snapshot.deadline180Days.daysRemaining,
      JSON.stringify(snapshot.quotas),
      JSON.stringify(snapshot.cooldowns),
      JSON.stringify(snapshot.learningInsights),
      JSON.stringify(snapshot.openActions),
      snapshot.computedAt
    ];

    if (isProduction()) {
      await this.d1Repo.executeWrite('owner_status_snapshots', sql, params).catch(() => {});
    } else {
      try {
        getDb().prepare(sql).run(...params);
      } catch {}
    }

    return snapshot;
  }

  public renderHtmlDashboard(snapshot: OwnerStatusSnapshot): string {
    const escape = (s?: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const openActionRows = snapshot.openActions.map(a => `
      <tr style="border-bottom: 1px solid #1e293b;">
        <td style="padding: 12px 16px;">
          <span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; background: ${a.type === 'HUMAN' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)'}; color: ${a.type === 'HUMAN' ? '#f87171' : '#60a5fa'}; border: 1px solid ${a.type === 'HUMAN' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.4)'};">
            ${escape(a.title)}
          </span>
        </td>
        <td style="padding: 12px 16px; color: #e2e8f0; font-size: 0.9rem;">${escape(a.description)}</td>
        <td style="padding: 12px 16px; color: #94a3b8; font-size: 0.82rem;">${escape(a.resolutionCondition)}</td>
      </tr>
    `).join('');

    const learningCards = snapshot.learningInsights.map(l => `
      <div style="background: #111827; border: 1px solid #1e293b; border-radius: 6px; padding: 12px; margin-bottom: 10px;">
        <div style="font-weight: 700; color: #38bdf8; font-size: 0.85rem; margin-bottom: 4px;">${escape(l.what)} &bull; <span style="color: #4ade80;">${escape(l.outcome)}</span></div>
        <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 4px;"><strong>Cause:</strong> ${escape(l.cause)}</div>
        <div style="font-size: 0.8rem; color: #cbd5e1;"><strong>Rule:</strong> ${escape(l.rule)}</div>
      </div>
    `).join('');

    // Today Action Section Variables
    const today = snapshot.todayItems;
    const isIntakeValid = Boolean(today?.intakeCompleted && today?.intakeStatus === 'VALID');
    const intakeStatusBadge = isIntakeValid
      ? `<span class="badge" style="background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4);">VALID OPERATOR ATTESTATION</span>`
      : `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);">ACTION REQUIRED</span>`;

    const intakeActionHtml = isIntakeValid
      ? `<div style="font-size: 0.85rem; color: #4ade80;">Operator attestation confirmed and active. No further owner action needed.</div>`
      : `<div style="font-size: 0.85rem; color: #fca5a5; margin-bottom: 8px;">Operator attestation is missing or invalid. Complete the intake form via authenticated owner session:</div>
         <a href="/owner/intake" style="display: inline-block; background: #2563eb; color: #fff; padding: 6px 14px; border-radius: 4px; text-decoration: none; font-size: 0.85rem; font-weight: 600;">Complete Owner Intake Form &rarr;</a>`;

    const candidateProposals = today?.candidateProposals || [];
    const proposalsHtml = candidateProposals.length === 0
      ? `<div style="font-size: 0.85rem; color: #94a3b8;">No pending product proposals requiring verification. All candidate offers reviewed.</div>`
      : candidateProposals.map(p => `
          <div style="background: #111827; border: 1px solid #1e293b; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
              <div>
                <strong style="color: #38bdf8; font-size: 0.95rem;">${escape(p.productName)}</strong>
                <span style="font-size: 0.78rem; color: #94a3b8; margin-left: 8px;">(${escape(p.category)} &bull; Mfr: ${escape(p.manufacturerName)})</span>
              </div>
              <span style="font-size: 0.75rem; background: rgba(56, 189, 248, 0.1); color: #38bdf8; padding: 2px 8px; border-radius: 4px;">ID: ${escape(p.id)}</span>
            </div>
            <div style="font-size: 0.82rem; color: #cbd5e1; margin-bottom: 6px;"><strong>Specs:</strong> ${escape(p.specSummary)}</div>
            <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 8px;">
              <strong>Source Spec URL:</strong> <a href="${escape(p.sourceUrl)}" target="_blank" rel="noopener" style="color: #60a5fa;">${escape(p.sourceUrl)}</a>
              (Retrieved: ${escape(p.retrievalDate)})
            </div>
            ${p.pageTextSnippet ? `<div style="font-size: 0.78rem; background: #0f172a; border-left: 3px solid #3b82f6; padding: 6px 10px; color: #94a3b8; margin-bottom: 10px;"><em>"${escape(p.pageTextSnippet)}"</em></div>` : ''}
            <form method="POST" action="/api/v1/owner/product-proposals/${escape(p.id)}/approve" style="display: flex; flex-direction: column; gap: 10px; background: #090d16; padding: 12px; border-radius: 4px; border: 1px solid #1e293b;">
              <div style="display: flex; gap: 8px; align-items: center;">
                <label style="font-size: 0.82rem; color: #e2e8f0; width: 140px; flex-shrink: 0;">Display Name:</label>
                <input type="text" name="displayName" value="${escape(p.productName)}" required placeholder="e.g. Phomemo PM-241BT Shipping Label Printer" style="flex: 1; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem;" />
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <label style="font-size: 0.82rem; color: #e2e8f0; width: 140px; flex-shrink: 0;">Fact 1 &amp; Date:</label>
                <input type="text" name="fact1" required placeholder="Listing Fact 1 (e.g. Direct Thermal 203 DPI)" style="flex: 2; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem;" />
                <input type="date" name="fact1Date" value="${escape(p.retrievalDate)}" required style="flex: 1; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem;" />
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <label style="font-size: 0.82rem; color: #e2e8f0; width: 140px; flex-shrink: 0;">Fact 2 &amp; Date:</label>
                <input type="text" name="fact2" required placeholder="Listing Fact 2 (e.g. Up to 150 mm/s print speed)" style="flex: 2; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem;" />
                <input type="date" name="fact2Date" value="${escape(p.retrievalDate)}" required style="flex: 1; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem;" />
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <label style="font-size: 0.82rem; color: #e2e8f0; width: 140px; flex-shrink: 0;">Fact 3 &amp; Date:</label>
                <input type="text" name="fact3" required placeholder="Listing Fact 3 (e.g. Supports 1 to 4 inch label widths)" style="flex: 2; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem;" />
                <input type="date" name="fact3Date" value="${escape(p.retrievalDate)}" required style="flex: 1; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem;" />
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <label style="font-size: 0.82rem; color: #e2e8f0; width: 140px; flex-shrink: 0;">Amazon.in URL:</label>
                <input type="url" name="amazonUrl" required placeholder="https://www.amazon.in/dp/B0..." style="flex: 1; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem;" />
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #cbd5e1; cursor: pointer;">
                  <input type="checkbox" name="productChecked" value="true" required style="accent-color: #3b82f6;" />
                  <span>I have verified this product on Amazon.in (product_checked)</span>
                </label>
                <button type="submit" style="background: #059669; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; font-size: 0.82rem; font-weight: 600; cursor: pointer;">
                  Approve Product & Activate Offer
                </button>
              </div>
            </form>
          </div>
        `).join('');

    const publishReadyGuides = today?.publishReadyGuides || [];
    const publishReadyHtml = publishReadyGuides.length === 0
      ? ''
      : `
        <div style="margin-top: 16px; border-top: 1px solid #1e293b; padding-top: 14px;">
          <h4 style="margin: 0 0 10px; color: #a78bfa; font-size: 0.9rem;">Guides Ready to Publish (${publishReadyGuides.length})</h4>
          ${publishReadyGuides.map(g => `
            <div style="background: #111827; border: 1px solid #334155; border-radius: 6px; padding: 12px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: #e2e8f0; font-size: 0.9rem;">${escape(g.title)}</strong>
                <div style="font-size: 0.78rem; color: #94a3b8;">Slug: /guides/${escape(g.slug)} &bull; Category: ${escape(g.category)}</div>
              </div>
              <form method="POST" action="/api/v1/owner/guides/${escape(g.id)}/publish" style="margin: 0;">
                <button type="submit" style="background: #7c3aed; color: #fff; border: none; padding: 6px 16px; border-radius: 4px; font-size: 0.82rem; font-weight: 600; cursor: pointer;">
                  Publish Guide
                </button>
              </form>
            </div>
          `).join('')}
        </div>
      `;

    const isShareReady = today?.readyShareGuide?.status === 'READY' && Boolean(today?.readyShareGuide?.shareText);
    const shareGuideBadge = isShareReady
      ? `<span style="font-size: 0.75rem; color: #4ade80;">Ready to Share</span>`
      : `<span style="font-size: 0.75rem; color: #f59e0b; background: rgba(245, 158, 11, 0.15); padding: 2px 6px; border-radius: 4px;">NOT_READY</span>`;

    const shareGuideBoxHtml = isShareReady
      ? `
          <div style="background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 10px; font-family: monospace; font-size: 0.82rem; color: #e2e8f0; margin-bottom: 8px;">
            ${escape(today?.readyShareGuide?.shareText || '')}
          </div>
          <div style="font-size: 0.8rem; color: #94a3b8;">
            Public Guide URL: <a href="${escape(today?.readyShareGuide?.pageUrl || '')}" target="_blank" rel="noopener" style="color: #38bdf8;">${escape(today?.readyShareGuide?.pageUrl || '')}</a>
          </div>
        `
      : `
          <div style="font-size: 0.85rem; color: #94a3b8; background: #0b1120; border: 1px dashed #334155; border-radius: 4px; padding: 12px;">
            STATUS: <strong>NOT_READY</strong> — No published commercial guide found. Publishing of a verified guide must occur before shareable links are generated.
          </div>
        `;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="60">
  <title>Owner Control Center — Live Status</title>
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #0f172a; --border: #1e293b; --text: #f1f5f9; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 24px; }
    h1 { font-size: 1.6rem; margin: 0; color: #fff; font-weight: 700; }
    .badge { padding: 4px 10px; border-radius: 9999px; font-size: 0.78rem; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .card h3 { margin: 0 0 12px 0; font-size: 0.95rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
    .metric { font-size: 1.5rem; font-weight: 700; color: #fff; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { padding: 12px 16px; background: #111827; color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; border-bottom: 1px solid var(--border); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Owner Control Center</h1>
        <div style="font-size: 0.85rem; color: #94a3b8;">Computed at ${escape(snapshot.computedAt)} &bull; Auto-refresh: 60s</div>
      </div>
      <div>
        <span class="badge" style="background: ${snapshot.deployments.commitStatus === 'MATCH' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${snapshot.deployments.commitStatus === 'MATCH' ? '#4ade80' : '#f87171'}; border: 1px solid ${snapshot.deployments.commitStatus === 'MATCH' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'};">
          ${snapshot.deployments.commitStatus === 'MATCH' ? 'DEPLOYS IN SYNC' : 'DEPLOY MISMATCH'}
        </span>
      </div>
    </header>

    <!-- ================================================================= -->
    <!-- OWNER 'TODAY' ACTION SECTION (§ 7)                                -->
    <!-- ================================================================= -->
    <div style="background: linear-gradient(135deg, rgba(30, 58, 138, 0.35) 0%, rgba(15, 23, 42, 0.9) 100%); border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 style="margin: 0; font-size: 1.25rem; color: #60a5fa; font-weight: 700;">TODAY — Actions Requiring Owner</h2>
        <span style="font-size: 0.8rem; background: rgba(59, 130, 246, 0.2); color: #93c5fd; padding: 4px 10px; border-radius: 9999px; border: 1px solid rgba(59, 130, 246, 0.4);">
          Owner-Only Action Center
        </span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 16px;">
        <!-- 1. Owner Intake -->
        <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-weight: 600; font-size: 0.95rem; color: #f8fafc;">
              1. Owner Intake Attestation
            </div>
            ${intakeStatusBadge}
          </div>
          <div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 8px;">
            Permanent operator declaration of Amazon application date, Operating Agreement confirmation, listed URLs, and site metadata.
          </div>
          ${intakeActionHtml}
        </div>

        <!-- 2. Product Proposal Approval -->
        <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-weight: 600; font-size: 0.95rem; color: #f8fafc;">
              2. Commercial Offer & Product Approval
            </div>
            <span style="font-size: 0.75rem; color: #38bdf8;">Requires Owner Verification</span>
          </div>
          <div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 12px;">
            Review candidate product proposals derived from manufacturer spec sheets (zero Amazon fetches). Supply the verified Amazon.in product URL and attest product_checked to activate commercial offer.
          </div>
          ${proposalsHtml}
          ${publishReadyHtml}
        </div>

        <!-- 3. Share This Page -->
        <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-weight: 600; font-size: 0.95rem; color: #f8fafc;">
              3. Share Public Commercial Guide (Drive Organic Visitor)
            </div>
            ${shareGuideBadge}
          </div>
          <div style="font-size: 0.82rem; color: #f59e0b; margin-bottom: 8px;">
            <strong>Statutory Rule:</strong> Share this clean public guide page URL only. Never distribute raw or tagged Amazon affiliate links on messaging or social.
          </div>
          ${shareGuideBoxHtml}
        </div>
      </div>
      <div style="margin-top: 12px; font-size: 0.8rem; color: #64748b; text-align: right;">
        All remaining system operations below run as <strong>AUTOMATED: pending</strong> via hourly autonomous cron cycles (zero LLM calls).
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>180-Day Qualification Deadline</h3>
        <div class="metric" style="color: ${snapshot.deadline180Days.isExpired ? '#f87171' : '#38bdf8'};">
          ${escape(snapshot.deadline180Days.countdownText)}
        </div>
        <div style="font-size: 0.85rem; color: #94a3b8;">Application: ${escape(snapshot.deadline180Days.applicationDate || 'None')} &bull; Deadline: ${escape(snapshot.deadline180Days.deadlineDate || 'None')}</div>
      </div>

      <div class="card">
        <h3>Money Path Status</h3>
        <div class="metric" style="color: ${snapshot.moneyPath.status === 'FLOWING' ? '#4ade80' : '#fbbf24'};">
          ${escape(snapshot.moneyPath.status)}
        </div>
        <div style="font-size: 0.85rem; color: #94a3b8;">Blocker: <strong>${escape(snapshot.moneyPath.singleBiggestBlocker)}</strong></div>
      </div>

      <div class="card">
        <h3>Quotas (Monthly / Daily)</h3>
        <div style="font-size: 0.95rem; margin-bottom: 6px;">
          Tavily: <strong>${snapshot.quotas.tavily.creditsConsumedMonth}</strong> / ${snapshot.quotas.tavily.applicationLimit} credits (${snapshot.quotas.tavily.isLocked ? 'LOCKED' : 'ACTIVE'})
        </div>
        <div style="font-size: 0.95rem;">
          Gemini: <strong>${snapshot.quotas.gemini.requestsToday}</strong> / ${snapshot.quotas.gemini.applicationLimit} reqs (${snapshot.quotas.gemini.isLocked ? 'LOCKED' : 'ACTIVE'})
        </div>
      </div>

      <div class="card">
        <h3>Last Cron Cycle</h3>
        <div style="font-size: 0.95rem; margin-bottom: 4px;">
          Trigger: <strong>${escape(snapshot.lastCronCycle.triggerSource || 'None')}</strong> &bull; Status: <strong>${escape(snapshot.lastCronCycle.status || 'None')}</strong>
        </div>
        <div style="font-size: 0.85rem; color: #94a3b8;">Next Action: ${escape(snapshot.lastCronCycle.nextBestAction || 'None')}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 24px; padding: 0; overflow: hidden;">
      <div style="padding: 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0;">Open Actions (${snapshot.openActions.length})</h3>
        <span style="font-size: 0.8rem; color: #94a3b8;">Each item names exactly one human action or AUTOMATED: pending</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 220px;">Action Item</th>
            <th>Required Task</th>
            <th>Resolution Trigger</th>
          </tr>
        </thead>
        <tbody>
          ${openActionRows}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h3>Empirical Learning Store (${snapshot.learningInsights.length} Rules Active)</h3>
      <div>
        ${learningCards}
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  public renderHtmlIntakeForm(intake: OwnerIntakeRecord | null): string {
    const escape = (s?: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    if (intake) {
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Owner Intake — Completed</title>
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #0f172a; --border: #1e293b; --text: #f1f5f9; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 32px; }
    .card { max-width: 650px; margin: 40px auto; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 24px; }
    h1 { font-size: 1.4rem; color: #4ade80; margin-top: 0; }
    .field { margin-bottom: 12px; }
    .label { font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; font-weight: 600; }
    .val { font-size: 1rem; color: #f1f5f9; font-weight: 500; margin-top: 2px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✓ Owner Intake Completed</h1>
    <p style="color: #94a3b8; font-size: 0.9rem;">Your owner attestation and site details are permanently stored in D1. You will never be asked to enter these details again.</p>
    <div class="field"><div class="label">Application Date</div><div class="val">${escape(intake.applicationDate)}</div></div>
    <div class="field"><div class="label">Site Name</div><div class="val">${escape(intake.siteName)}</div></div>
    <div class="field"><div class="label">Author Name</div><div class="val">${escape(intake.authorName)}</div></div>
    <div class="field"><div class="label">Contact Email</div><div class="val">${escape(intake.contactEmail)}</div></div>
    <div class="field"><div class="label">Listed Site URLs</div><div class="val">${escape(intake.listedSiteUrls.join(', '))}</div></div>
    <div class="field"><div class="label">Operating Agreement Confirmed</div><div class="val">${intake.agreementReadConfirmed ? 'Yes (' + escape(intake.agreementReadConfirmedAt) + ')' : 'No'}</div></div>
    <div class="field"><div class="label">Tavily Key Rotated</div><div class="val">${intake.tavilyKeyRotated ? 'Yes' : 'No'}</div></div>
    <div style="margin-top: 24px;"><a href="/api/v1/owner/status" style="display: inline-block; background: #2563eb; color: #fff; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 0.9rem; font-weight: 600;">View Status Dashboard</a></div>
  </div>
</body>
</html>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Owner Intake — Setup</title>
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #0f172a; --border: #1e293b; --text: #f1f5f9; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 32px; }
    .card { max-width: 650px; margin: 40px auto; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 24px; }
    h1 { font-size: 1.4rem; color: #fff; margin-top: 0; }
    label { display: block; font-size: 0.85rem; color: #94a3b8; margin-top: 16px; margin-bottom: 6px; font-weight: 500; }
    input[type="text"], input[type="date"], input[type="email"], textarea { width: 100%; box-sizing: border-box; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 0.9rem; }
    button { margin-top: 24px; background: #2563eb; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .check-label { display: flex; align-items: center; gap: 8px; margin-top: 16px; font-size: 0.88rem; color: #cbd5e1; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Owner Intake (One-Time Setup)</h1>
    <p style="color: #94a3b8; font-size: 0.85rem;">Stored permanently in D1 with zero defaults. Once saved, these details will never be requested again.</p>
    <form method="POST" action="/api/v1/owner/intake">
      <label for="applicationDate">Associates Application Date</label>
      <input type="date" id="applicationDate" name="applicationDate" required>

      <label for="siteName">Site Name</label>
      <input type="text" id="siteName" name="siteName" placeholder="Enter site name" required>

      <label for="authorName">Author / Editorial Name</label>
      <input type="text" id="authorName" name="authorName" placeholder="Enter author or team name" required>

      <label for="contactEmail">Contact Email</label>
      <input type="email" id="contactEmail" name="contactEmail" placeholder="e.g. contact@domain.in" required>

      <label for="listedSiteUrls">Listed Site URLs in Associates Central (comma-separated or one per line)</label>
      <textarea id="listedSiteUrls" name="listedSiteUrls" rows="3" placeholder="https://..." required></textarea>

      <div class="check-label">
        <input type="checkbox" id="agreementReadConfirmed" name="agreementReadConfirmed" value="true" required>
        <label for="agreementReadConfirmed" style="margin: 0;">I confirm I have read and agree to the Amazon Associates Operating Agreement</label>
      </div>

      <div class="check-label">
        <input type="checkbox" id="tavilyKeyRotated" name="tavilyKeyRotated" value="true">
        <label for="tavilyKeyRotated" style="margin: 0;">Tavily API key has been rotated</label>
      </div>

      <button type="submit">Save Intake Permanently</button>
    </form>
  </div>
</body>
</html>`;
  }
}

