import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction, getTrustedPublicSiteUrl } from '../config/env.js';
import {
  AutonomousDealDiscoveryEngine,
  repairTitlePriceMismatch
} from '../commission/autonomous-deal-discovery-engine.js';
import { generateComparisonPairs } from '../commission/static-site-generator.js';
import { SiteAuditService } from '../tools/site-audit/site-audit-service.js';
import { GeminiProvider } from '../ai/gemini-provider.js';
import { ExperimentEngine } from '../experiments/experiment-engine.js';
import {
  isRegulatedHealthcareTarget,
  isValidReachableEmail
} from '../tools/site-audit/site-audit-scanner.js';
import { OwnerAuthService } from '../auth/owner-auth.js';

export const NATIONAL_ENTERPRISE_BLOCKLIST_DOMAINS: string[] = [
  'careerlauncher.com',
  'time4education.com',
  'justdial.com',
  'indiamart.com',
  'sulekha.com',
  'practo.com',
  '1mg.com',
  'pharmeasy.in',
  'apollo247.com',
  'byjus.com',
  'allen.ac.in',
  'aakash.ac.in',
  'urbancompany.com',
  'olx.in',
  'quikr.com',
  'amazon.in',
  'amazon.com',
  'flipkart.com',
  'myntra.com',
  'ajio.com',
  'nykaa.com',
  'swiggy.com',
  'zomato.com',
  'makemytrip.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'wikipedia.org'
];

export function isDisqualifiedEnterpriseDomain(domainOrName?: string | null): boolean {
  const raw = String(domainOrName || '').trim().toLowerCase();
  if (!raw) return false;
  let host = raw;
  try {
    if (raw.includes('://')) {
      host = new URL(raw).hostname.toLowerCase();
    } else if (raw.includes('/')) {
      host = raw.split('/')[0].toLowerCase();
    }
  } catch {}
  host = host.replace(/^www\./, '');

  for (const blocked of NATIONAL_ENTERPRISE_BLOCKLIST_DOMAINS) {
    if (host === blocked || host.endsWith(`.${blocked}`) || raw.includes(blocked)) {
      return true;
    }
    const brandToken = blocked.split('.')[0];
    if (brandToken.length >= 6 && raw.replace(/\s+/g, '').includes(brandToken)) {
      return true;
    }
  }
  return false;
}

export function isDisqualifiedOutreachTarget(
  domainOrName?: string | null,
  categoryOrSegment?: string | null
): boolean {
  return (
    isDisqualifiedEnterpriseDomain(domainOrName) ||
    isRegulatedHealthcareTarget(domainOrName, categoryOrSegment)
  );
}

export interface SystemAnomalyInput {
  module: string;
  errorCode: string;
  message: string;
  contextJson?: Record<string, any>;
  autoFixAction: string;
  severity?: 'P1' | 'P2' | 'P3';
  status?: 'OPEN' | 'FIXED' | 'MONITORING';
}

export interface PriceRepairItem {
  id: string;
  title: string;
  originalPriceINR: number;
  repairedPriceINR: number;
  referencePriceINR: number | null;
  reason: string;
}

export interface FunnelLeakDiagnosis {
  funnelMatrix: {
    catalogActiveDeals: number;
    comparisonPages: number;
    viewsAndSignals: number;
    redirectClicks: number;
    customerDeskInquiries: number;
    checkoutOrders: number;
    verifiedCashINR: number;
  };
  bottleneckStage: string;
  recommendedAction: string;
  autoAppliedFix: string;
  diagnosisSource: 'GEMINI_FLASH' | 'DETERMINISTIC_FALLBACK';
  evaluatedAt: string;
}

export interface OutreachAutopilotHealth {
  autopilotEnabledByEnv: boolean;
  humanApprovedSentCount: number;
  requiredHumanGateCount: number;
  humanGateSatisfied: boolean;
  totalSentCount: number;
  utcTodaySentCount: number;
  dailyCap: number;
  bounceCount: number;
  complaintOrUnsubCount: number;
  bounceRate: number;
  paused: boolean;
  autopilotPausedReason: string | null;
  autopilotActive: boolean;
}

export interface ConstitutionVerificationResult {
  constitutionStatus: 'ENFORCED_ALL_INVARIANTS_PASS' | 'REPAIRED_VIOLATIONS' | 'HALTED_INVARIANT_VIOLATION';
  outreachHaltedByConstitution: boolean;
  checks: {
    autoEnvLoginDisabledInTestAndProd: boolean;
    zeroAmazonStaticPrices: boolean;
    zeroUnverifiedCps: boolean;
    zeroHealthcareOutreach: boolean;
    outreachDailyCapRespected: boolean;
  };
  violations: string[];
  verifiedAt: string;
}

export interface SelfHealingReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  constitutionStatus: 'ENFORCED_ALL_INVARIANTS_PASS' | 'REPAIRED_VIOLATIONS' | 'HALTED_INVARIANT_VIOLATION';
  constitutionVerification: ConstitutionVerificationResult;
  autopilotStatus: OutreachAutopilotHealth;
  priceRepair: {
    scanned: number;
    repairedCount: number;
    quarantinedCount: number;
    amazonStaticPricesPurged: number;
    repairs: PriceRepairItem[];
  };
  outreachRepair: {
    whatsappConfigured: boolean;
    brevoConfigured: boolean;
    reroutedToEmailCount: number;
    disqualifiedEnterpriseCount: number;
    disqualifiedHealthcareCount: number;
    clearedBlockedJobsCount: number;
    reroutedDraftIds: string[];
    disqualifiedTargets: string[];
  };
  dataIntegrityRepair?: {
    fakeCpsCampaignsPurged: number;
    fakeCpsDealsPurged: number;
    testEventsPurged: number;
  };
  instagramTokenRefresh?: {
    refreshed: boolean;
    reason: string;
  };
  catalogEvolution: {
    evaluated: number;
    boosted: number;
    rotatedOut: number;
  };
  experimentsEvaluated: number;
  resolvedAnomaliesCount: number;
  openAnomaliesCount: number;
  funnelDiagnosis: FunnelLeakDiagnosis;
  queueRecovery?: any;
  deliveryRecovery?: {
    processed: number;
    recovered: number;
    errors: string[];
  };
}

export class AutonomousSystemDoctor {
  private static instance: AutonomousSystemDoctor | null = null;
  private d1Repo = D1RevenueRepository.getInstance();
  private lastReport: SelfHealingReport | null = null;

  public static getInstance(): AutonomousSystemDoctor {
    if (!AutonomousSystemDoctor.instance) {
      AutonomousSystemDoctor.instance = new AutonomousSystemDoctor();
    }
    return AutonomousSystemDoctor.instance;
  }

  public static resetForTesting(): void {
    AutonomousSystemDoctor.instance = null;
  }

  public static resetInstanceForTesting(): void {
    AutonomousSystemDoctor.instance = null;
  }

  public getLastReport(): SelfHealingReport | null {
    return this.lastReport;
  }

  public buildOutreachActionUrls(params: {
    businessName: string;
    domain: string;
    email?: string | null;
    phone?: string | null;
    previewUrl: string;
    checkoutUrl: string;
    defectCount: number;
  }): { mailtoUrl: string | null; whatsappShareUrl: string } {
    const subject = `Technical SEO & Conversion Audit for ${params.businessName || params.domain} (${params.defectCount} issues found)`;
    const body = [
      `Hi ${params.businessName || params.domain} team,`,
      '',
      `We ran an automated technical speed, schema & conversion audit on ${params.domain} and flagged ${params.defectCount} fixable issues.`,
      '',
      `Review your signed audit report here: ${params.previewUrl}`,
      `Get the full ₹499 Core Fix-Pack here: ${params.checkoutUrl}`,
      '',
      `Best regards,`
    ].join('\n');

    const email = String(params.email || '').trim();
    const mailtoUrl = email && email.includes('@')
      ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      : null;

    const digits = String(params.phone || '').replace(/\D/g, '');
    const waTarget = digits.length >= 10
      ? (digits.length === 10 ? `91${digits}` : digits)
      : '';
    const waText = `Hi ${params.businessName || params.domain} team — we flagged ${params.defectCount} quick technical/SEO fixes on ${params.domain}. View your report: ${params.previewUrl} | ₹499 Fix-Pack: ${params.checkoutUrl}`;
    const whatsappShareUrl = waTarget
      ? `https://wa.me/${waTarget}?text=${encodeURIComponent(waText)}`
      : `https://wa.me/?text=${encodeURIComponent(waText)}`;

    return { mailtoUrl, whatsappShareUrl };
  }

  public async recordAnomaly(input: SystemAnomalyInput): Promise<{ recorded: boolean; eventId: string; mistakeId: string }> {
    const db = getDb();
    const eventId = `anom_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const mistakeId = `mb_${input.module}_${input.errorCode}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 80);
    const isFixed = input.status === 'FIXED';
    const processed = isFixed ? 1 : 0;

    const payload = {
      module: input.module,
      errorCode: input.errorCode,
      message: input.message,
      contextJson: input.contextJson || {},
      autoFixAction: input.autoFixAction,
      status: isFixed ? 'FIXED' : 'PENDING_AUTO_FIX',
      recordedAt: new Date().toISOString()
    };

    let recorded = false;
    try {
      db.prepare(`
        INSERT OR IGNORE INTO durable_events (
          id, event_type, business_id, organization_id, payload_json, processed, processed_at, triggered_agents_json, error_message, created_at
        ) VALUES (?, 'SYSTEM_ANOMALY_DETECTED', 'biz_platform_aro', 'org_owner_primary', ?, ?, ?, '["AutonomousSystemDoctor"]', ?, datetime('now'))
      `).run(
        eventId,
        JSON.stringify(payload),
        processed,
        isFixed ? new Date().toISOString() : null,
        input.message.slice(0, 400)
      );
      recorded = true;
    } catch {}

    try {
      db.prepare(`
        INSERT INTO mistakes_board (
          id, first_seen, last_seen, title, what_happened, cause, rule,
          severity, status, recurrence_count, guard_type, guard_ref, source_report
        ) VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?, ?, 1, 'HOOK', ?, 'AutonomousSystemDoctor')
        ON CONFLICT(id) DO UPDATE SET
          last_seen = datetime('now'),
          what_happened = excluded.what_happened,
          status = CASE WHEN excluded.status = 'FIXED' THEN 'FIXED' ELSE mistakes_board.status END,
          recurrence_count = mistakes_board.recurrence_count + 1
      `).run(
        mistakeId,
        `${input.module}: ${input.errorCode}`.slice(0, 140),
        input.message.slice(0, 500),
        JSON.stringify(input.contextJson || {}).slice(0, 400),
        input.autoFixAction.slice(0, 400),
        input.severity || 'P2',
        input.status || 'OPEN',
        `doctor:${input.module}`
      );
    } catch {}

    if (this.d1Repo.isRemoteD1WriteAllowed()) {
      void this.d1Repo.executeWrite(
        'durable_events',
        `INSERT OR IGNORE INTO durable_events (id, event_type, business_id, organization_id, payload_json, processed, processed_at, triggered_agents_json, error_message, created_at)
         VALUES (?, 'SYSTEM_ANOMALY_DETECTED', 'biz_platform_aro', 'org_owner_primary', ?, ?, ?, '["AutonomousSystemDoctor"]', ?, datetime('now'))`,
        [eventId, JSON.stringify(payload), processed, isFixed ? new Date().toISOString() : null, input.message.slice(0, 400)]
      ).catch(() => {});
    }

    return { recorded, eventId, mistakeId };
  }

  public async repairPublicDealsPrices(): Promise<{
    scanned: number;
    repairedCount: number;
    quarantinedCount: number;
    amazonStaticPricesPurged: number;
    repairs: PriceRepairItem[];
  }> {
    const db = getDb();
    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    const useRemoteD1Read = this.d1Repo.isRemoteD1ReadAllowed();
    const allowRemoteWrite = this.d1Repo.isRemoteD1WriteAllowed();

    const rowMap = new Map<string, any>();
    try {
      const localRows = db.prepare(`SELECT * FROM public_deals ORDER BY updated_at DESC LIMIT 50`).all() as any[];
      for (const r of localRows) {
        if (r?.id) rowMap.set(r.id, r);
      }
    } catch {}

    if (useRemoteD1Read) {
      try {
        const res = await this.d1Repo.executeRead('public_deals', `SELECT * FROM public_deals ORDER BY updated_at DESC LIMIT 50`, []);
        for (const r of res?.results || []) {
          if (r?.id) rowMap.set(r.id, r);
        }
      } catch {}
    }

    let scanned = 0;
    let repairedCount = 0;
    let quarantinedCount = 0;
    let amazonStaticPricesPurged = 0;
    const repairs: PriceRepairItem[] = [];

    for (const row of rowMap.values()) {
      scanned++;
      let evidenceObj: Record<string, any> = {};
      try {
        evidenceObj = typeof row.evidence_json === 'string'
          ? JSON.parse(row.evidence_json || '{}')
          : (row.evidence_json || {});
      } catch {
        evidenceObj = {};
      }

      const affiliateNetwork = evidenceObj.affiliateNetwork ||
        (/amazon\.(in|com)/i.test(String(row.product_url || row.affiliate_url || '')) ? 'AMAZON_IN' : 'CUELINKS');
      const isAmazonRow =
        affiliateNetwork === 'AMAZON_IN' ||
        /amazon\.(in|com)/i.test(String(row.product_url || row.affiliate_url || ''));

      if (isAmazonRow) {
        const hadStaticPrice =
          Number(row.current_price_inr || 0) > 0 ||
          Number(row.reference_price_inr || 0) > 0 ||
          !evidenceObj.amazonStaticPricePurged;

        if (hadStaticPrice) {
          amazonStaticPricesPurged++;
          const purgedEvidence = JSON.stringify({
            ...evidenceObj,
            affiliateNetwork: 'AMAZON_IN',
            isAmazonSearchRail: true,
            amazonStaticPricePurged: true,
            amazonStaticPricePurgedAt: new Date().toISOString(),
            purgedOriginalPriceINR: Number(row.current_price_inr || 0) || null
          });

          const existingInMem = dealEngine.getDealsMap().get(row.id);
          if (existingInMem) {
            existingInMem.currentPriceINR = 0;
            existingInMem.referencePriceINR = undefined;
            existingInMem.verifiedDiscountPercent = 0;
            existingInMem.claimedDiscountPercent = 0;
            (existingInMem as any).isAmazonSearchRail = true;
            existingInMem.evidenceJson = {
              ...(existingInMem.evidenceJson || { sources: [existingInMem.productUrl], verificationLogs: [] }),
              affiliateNetwork: 'AMAZON_IN',
              isAmazonSearchRail: true,
              amazonStaticPricePurged: true,
              amazonStaticPricePurgedAt: new Date().toISOString()
            };
          }

          try {
            db.prepare(`
              UPDATE public_deals
              SET current_price_inr = 0, reference_price_inr = NULL, discount_percent = 0, evidence_json = ?, updated_at = datetime('now')
              WHERE id = ?
            `).run(purgedEvidence, row.id);
          } catch {}

          if (allowRemoteWrite) {
            await this.d1Repo.executeWrite(
              'public_deals',
              `UPDATE public_deals
               SET current_price_inr = 0, reference_price_inr = NULL, discount_percent = 0, evidence_json = ?, updated_at = datetime('now')
               WHERE id = ?`,
              [purgedEvidence, row.id]
            ).catch(() => {});
          }

          await this.recordAnomaly({
            module: 'public_deals',
            errorCode: 'AMAZON_STATIC_PRICE_PURGED',
            message: `Purged static scraped price on AMAZON_IN row '${row.id}' (${row.title}) for Associates compliance.`,
            contextJson: { dealId: row.id, originalPriceINR: row.current_price_inr },
            autoFixAction: 'Zero out static current_price_inr and enforce Dual-Rail live /amazon-redirect CTA',
            status: 'FIXED'
          });
        }
        continue;
      }

      const candidate = {
        id: row.id,
        title: row.title,
        merchant: row.merchant,
        category: row.category,
        dealKind: row.deal_kind || 'PRODUCT',
        currentPriceINR: Number(row.current_price_inr || 0),
        referencePriceINR: row.reference_price_inr ? Number(row.reference_price_inr) : undefined,
        verifiedDiscountPercent: row.discount_percent ? Number(row.discount_percent) : 0,
        affiliateNetwork,
        evidenceJson: evidenceObj
      };

      const check = repairTitlePriceMismatch(candidate);
      if (check.quarantined) {
        quarantinedCount++;
        const existingInMem = dealEngine.getDealsMap().get(row.id);
        if (existingInMem) {
          existingInMem.verificationStatus = 'REJECTED';
        }
        try {
          db.prepare(`UPDATE public_deals SET verification_status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`).run(row.id);
        } catch {}
        if (allowRemoteWrite) {
          await this.d1Repo.executeWrite(
            'public_deals',
            `UPDATE public_deals SET verification_status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`,
            [row.id]
          ).catch(() => {});
        }
        await this.recordAnomaly({
          module: 'public_deals',
          errorCode: 'DEAL_PRICE_QUARANTINED',
          message: `${row.title}: ${check.quarantineReason}`,
          contextJson: { dealId: row.id, title: row.title, currentPriceINR: row.current_price_inr, referencePriceINR: row.reference_price_inr },
          autoFixAction: 'Mark invalid price row REJECTED in public_deals',
          status: 'FIXED'
        });
      } else if (check.repaired) {
        repairedCount++;
        const repairedPrice = check.repairedCurrentPriceINR!;
        const repairedRef = check.repairedReferencePriceINR ?? null;
        const repairedDiscount = check.deal.verifiedDiscountPercent || 0;
        const updatedEvidenceStr = JSON.stringify({
          ...evidenceObj,
          ...(check.deal.evidenceJson || {})
        });

        repairs.push({
          id: row.id,
          title: row.title,
          originalPriceINR: check.originalCurrentPriceINR || Number(row.current_price_inr || 0),
          repairedPriceINR: repairedPrice,
          referencePriceINR: repairedRef,
          reason: check.repairReason || 'TITLE_PRICE_MRP_SWAP_REPAIRED'
        });

        const existingInMem = dealEngine.getDealsMap().get(row.id);
        if (existingInMem) {
          existingInMem.currentPriceINR = repairedPrice;
          existingInMem.referencePriceINR = repairedRef ?? existingInMem.referencePriceINR;
          existingInMem.verifiedDiscountPercent = repairedDiscount;
          existingInMem.claimedDiscountPercent = repairedDiscount;
          existingInMem.expectedProfitPer100VisitorsINR = (check.deal as any).expectedProfitPer100VisitorsINR;
          existingInMem.arbitrageScore = (check.deal as any).arbitrageScore;
          existingInMem.evidenceJson = {
            ...(existingInMem.evidenceJson || { sources: [existingInMem.productUrl], verificationLogs: [] }),
            ...(check.deal.evidenceJson || {})
          };
        }

        try {
          db.prepare(`
            UPDATE public_deals
            SET current_price_inr = ?, reference_price_inr = ?, discount_percent = ?, evidence_json = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(repairedPrice, repairedRef, repairedDiscount, updatedEvidenceStr, row.id);
        } catch {}

        if (allowRemoteWrite) {
          await this.d1Repo.executeWrite(
            'public_deals',
            `UPDATE public_deals
             SET current_price_inr = ?, reference_price_inr = ?, discount_percent = ?, evidence_json = ?, updated_at = datetime('now')
             WHERE id = ?`,
            [repairedPrice, repairedRef, repairedDiscount, updatedEvidenceStr, row.id]
          ).catch(() => {});
        }

        await this.recordAnomaly({
          module: 'public_deals',
          errorCode: 'TITLE_PRICE_MRP_SWAP',
          message: `Auto-repaired '${row.title}' from ₹${check.originalCurrentPriceINR} to ₹${repairedPrice} (MRP ₹${repairedRef})`,
          contextJson: { dealId: row.id, originalPriceINR: check.originalCurrentPriceINR, repairedPriceINR: repairedPrice, referencePriceINR: repairedRef },
          autoFixAction: 'repairTitlePriceMismatch() swapped MRP/bundle price and recalculated EV/100',
          status: 'FIXED'
        });
      }
    }

    // Also scan in-memory dealsMap in case unit test ingested without SQLite row overlap
    for (const memDeal of dealEngine.getDealsMap().values()) {
      if (rowMap.has(memDeal.id)) continue;
      scanned++;
      const isMemAmazon =
        memDeal.affiliateNetwork === 'AMAZON_IN' ||
        /amazon\.(in|com)/i.test(String(memDeal.productUrl || memDeal.trackingUrl || ''));
      if (isMemAmazon) {
        if (Number(memDeal.currentPriceINR || 0) > 0 || Number(memDeal.referencePriceINR || 0) > 0 || !memDeal.evidenceJson?.amazonStaticPricePurged) {
          amazonStaticPricesPurged++;
          memDeal.currentPriceINR = 0;
          memDeal.referencePriceINR = undefined;
          memDeal.verifiedDiscountPercent = 0;
          memDeal.claimedDiscountPercent = 0;
          (memDeal as any).isAmazonSearchRail = true;
          memDeal.evidenceJson = {
            ...(memDeal.evidenceJson || { sources: [memDeal.productUrl], verificationLogs: [] }),
            affiliateNetwork: 'AMAZON_IN',
            isAmazonSearchRail: true,
            amazonStaticPricePurged: true,
            amazonStaticPricePurgedAt: new Date().toISOString()
          };
        }
        continue;
      }

      const check = repairTitlePriceMismatch(memDeal);
      if (check.quarantined) {
        quarantinedCount++;
        memDeal.verificationStatus = 'REJECTED';
      } else if (check.repaired) {
        repairedCount++;
        memDeal.currentPriceINR = check.repairedCurrentPriceINR!;
        memDeal.referencePriceINR = check.repairedReferencePriceINR ?? memDeal.referencePriceINR;
        memDeal.verifiedDiscountPercent = check.deal.verifiedDiscountPercent;
        memDeal.expectedProfitPer100VisitorsINR = check.deal.expectedProfitPer100VisitorsINR;
        memDeal.arbitrageScore = check.deal.arbitrageScore;
        memDeal.evidenceJson = check.deal.evidenceJson;
        repairs.push({
          id: memDeal.id,
          title: memDeal.title,
          originalPriceINR: check.originalCurrentPriceINR || 0,
          repairedPriceINR: check.repairedCurrentPriceINR!,
          referencePriceINR: check.repairedReferencePriceINR ?? null,
          reason: check.repairReason || 'TITLE_PRICE_MRP_SWAP_REPAIRED'
        });
      }
    }

    return { scanned, repairedCount, quarantinedCount, amazonStaticPricesPurged, repairs };
  }

  public async repairOutreachChannelsAndQualifyTargets(siteUrl?: string): Promise<{
    whatsappConfigured: boolean;
    brevoConfigured: boolean;
    reroutedToEmailCount: number;
    disqualifiedEnterpriseCount: number;
    disqualifiedHealthcareCount: number;
    clearedBlockedJobsCount: number;
    reroutedDraftIds: string[];
    disqualifiedTargets: string[];
  }> {
    const db = getDb();
    const resolvedSiteUrl = (siteUrl || getTrustedPublicSiteUrl()).replace(/\/$/, '');
    const allowRemoteWrite = this.d1Repo.isRemoteD1WriteAllowed();
    const useRemoteD1Read = this.d1Repo.isRemoteD1Configured() && !process.env.VITEST;

    const whatsappConfigured = Boolean(
      (process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_BSP_API_KEY || '').trim()
    );
    const brevoConfigured = Boolean((process.env.BREVO_API_KEY || process.env.BREVO_MCP_SERVER_API || '').trim());

    let outreachRows: any[] = [];
    let contactRows: any[] = [];
    let auditRows: any[] = [];

    const readLocalOrD1 = async (table: string, sql: string): Promise<any[]> => {
      if (useRemoteD1Read) {
        try {
          const res = await this.d1Repo.executeRead(table, sql, []);
          if (Array.isArray(res?.results) && res.results.length > 0) return res.results;
        } catch {}
      }
      try {
        return db.prepare(sql).all() as any[];
      } catch {
        return [];
      }
    };

    outreachRows = await readLocalOrD1(
      'direct_outreach_log',
      `SELECT d.*, COALESCE(p.email, p.prospect_email) as p_email, COALESCE(p.phone, p.prospect_phone) as p_phone,
              COALESCE(p.website_url, p.prospect_website) as p_website
       FROM direct_outreach_log d
       LEFT JOIN platform_prospects p ON d.prospect_name = p.prospect_business_name OR d.prospect_name = p.business_name
       WHERE d.dispatched = 0`
    );

    contactRows = await readLocalOrD1(
      'outbound_contacts',
      `SELECT id, prospect_name, prospect_business_name, prospect_email, prospect_phone, prospect_website
       FROM outbound_contacts WHERE is_opted_out = 0 AND is_suppressed = 0`
    );

    auditRows = await readLocalOrD1(
      'site_audits',
      `SELECT domain, business_name, status, is_publicly_authorized FROM site_audits WHERE status = 'COMPLETED'`
    );

    let reroutedToEmailCount = 0;
    let disqualifiedEnterpriseCount = 0;
    let disqualifiedHealthcareCount = 0;
    let clearedBlockedJobsCount = 0;
    const reroutedDraftIds: string[] = [];
    const disqualifiedTargets: string[] = [];

    const auditService = SiteAuditService.getInstance();

    // Ensure any healthcare domains in site_audits are revoked from public exposure
    for (const aRow of auditRows) {
      if (
        Number(aRow.is_publicly_authorized) === 1 &&
        (isRegulatedHealthcareTarget(aRow.domain) || isRegulatedHealthcareTarget(aRow.business_name))
      ) {
        try {
          db.prepare(`UPDATE site_audits SET is_publicly_authorized = 0, updated_at = datetime('now') WHERE domain = ?`).run(aRow.domain);
        } catch {}
        if (allowRemoteWrite) {
          await this.d1Repo.executeWrite(
            'site_audits',
            `UPDATE site_audits SET is_publicly_authorized = 0, updated_at = datetime('now') WHERE domain = ?`,
            [aRow.domain]
          ).catch(() => {});
        }
      }
    }

    for (const draft of outreachRows) {
      const prospectName = String(draft.prospect_name || '').trim();
      const websiteRaw = String(draft.p_website || '').trim();
      let cleanDomain = '';
      if (websiteRaw) {
        cleanDomain = websiteRaw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      } else {
        const matchedAudit = auditRows.find(a =>
          (a.business_name && prospectName.toLowerCase().includes(String(a.business_name).toLowerCase())) ||
          prospectName.toLowerCase().includes(String(a.domain || '').toLowerCase().split('.')[0])
        );
        if (matchedAudit?.domain) {
          cleanDomain = String(matchedAudit.domain).toLowerCase().replace(/^www\./, '');
        }
      }

      const isHealthcare =
        isRegulatedHealthcareTarget(cleanDomain, draft.segment) ||
        isRegulatedHealthcareTarget(prospectName, draft.segment);

      if (isHealthcare) {
        if (String(draft.response_status || '') !== 'SUPPRESSED_HEALTHCARE_POLICY') {
          disqualifiedHealthcareCount++;
          disqualifiedTargets.push(cleanDomain || prospectName);
          try {
            db.prepare(
              `UPDATE direct_outreach_log SET response_status = 'SUPPRESSED_HEALTHCARE_POLICY', human_approved = 0 WHERE id = ? AND dispatched = 0`
            ).run(draft.id);
          } catch {}
          if (allowRemoteWrite) {
            await this.d1Repo.executeWrite(
              'direct_outreach_log',
              `UPDATE direct_outreach_log SET response_status = 'SUPPRESSED_HEALTHCARE_POLICY', human_approved = 0 WHERE id = ? AND dispatched = 0`,
              [draft.id]
            ).catch(() => {});
          }
          await this.recordAnomaly({
            module: 'b2b_outreach',
            errorCode: 'REGULATED_HEALTHCARE_DISQUALIFIED',
            message: `Suppressed regulated healthcare/dental outreach draft '${prospectName || cleanDomain}' per Standing Order 8.`,
            contextJson: { draftId: draft.id, domain: cleanDomain, prospectName },
            autoFixAction: 'Mark response_status=SUPPRESSED_HEALTHCARE_POLICY and exclude from outreach queues',
            status: 'FIXED'
          });
        }
        continue;
      }

      const isEnterprise = isDisqualifiedEnterpriseDomain(cleanDomain) || isDisqualifiedEnterpriseDomain(prospectName);
      if (isEnterprise) {
        if (String(draft.response_status || '') !== 'DISQUALIFIED_NATIONAL_ENTERPRISE') {
          disqualifiedEnterpriseCount++;
          disqualifiedTargets.push(cleanDomain || prospectName);
          try {
            db.prepare(`UPDATE direct_outreach_log SET response_status = 'DISQUALIFIED_NATIONAL_ENTERPRISE' WHERE id = ? AND human_approved = 0 AND dispatched = 0`).run(draft.id);
          } catch {}
          if (allowRemoteWrite) {
            await this.d1Repo.executeWrite(
              'direct_outreach_log',
              `UPDATE direct_outreach_log SET response_status = 'DISQUALIFIED_NATIONAL_ENTERPRISE' WHERE id = ? AND human_approved = 0 AND dispatched = 0`,
              [draft.id]
            ).catch(() => {});
          }
          await this.recordAnomaly({
            module: 'b2b_outreach',
            errorCode: 'NATIONAL_ENTERPRISE_DISQUALIFIED',
            message: `Disqualified national corporation '${prospectName || cleanDomain}' from ₹499 SMB outreach queue.`,
            contextJson: { draftId: draft.id, domain: cleanDomain, prospectName },
            autoFixAction: 'Mark response_status=DISQUALIFIED_NATIONAL_ENTERPRISE and exclude from Ready Audits',
            status: 'FIXED'
          });
        }
        continue;
      }

      // Match email contact if draft was created as WHATSAPP while WHATSAPP token is unconfigured and BREVO is ready
      if (String(draft.channel || '').toUpperCase() === 'WHATSAPP' && !whatsappConfigured && brevoConfigured) {
        const matchedContact = contactRows.find((ct: any) => {
          const dom = String(ct.prospect_website || ct.prospect_business_name || '').toLowerCase();
          const mail = String(ct.prospect_email || '').toLowerCase();
          const name = String(ct.prospect_name || ct.prospect_business_name || '').toLowerCase();
          return (
            (cleanDomain && (dom.includes(cleanDomain) || mail.endsWith(`@${cleanDomain}`))) ||
            (prospectName && name.includes(prospectName.toLowerCase()))
          );
        });

        const resolvedEmail = String(draft.p_email || matchedContact?.prospect_email || '').trim();
        let updatedBody = String(draft.message_draft || '');
        if (cleanDomain && !updatedBody.includes('/audit/')) {
          const tok = auditService.generateAuditPreviewToken(cleanDomain);
          const previewUrl = `${resolvedSiteUrl}/audit/${encodeURIComponent(cleanDomain)}?token=${encodeURIComponent(tok)}`;
          updatedBody = `${updatedBody}\n\nAudit Report: ${previewUrl}`;
        }

        if (isValidReachableEmail(resolvedEmail)) {
          reroutedToEmailCount++;
          reroutedDraftIds.push(draft.id);
          try {
            db.prepare(`
              UPDATE direct_outreach_log
              SET channel = 'EMAIL', message_draft = ?, response_status = CASE WHEN response_status IN ('DISQUALIFIED_NATIONAL_ENTERPRISE', 'SUPPRESSED_HEALTHCARE_POLICY') THEN response_status ELSE 'READY_BREVO_EMAIL' END
              WHERE id = ? AND human_approved = 0 AND dispatched = 0
            `).run(updatedBody, draft.id);
          } catch {}
          if (allowRemoteWrite) {
            await this.d1Repo.executeWrite(
              'direct_outreach_log',
              `UPDATE direct_outreach_log
               SET channel = 'EMAIL', message_draft = ?, response_status = CASE WHEN response_status IN ('DISQUALIFIED_NATIONAL_ENTERPRISE', 'SUPPRESSED_HEALTHCARE_POLICY') THEN response_status ELSE 'READY_BREVO_EMAIL' END
               WHERE id = ? AND human_approved = 0 AND dispatched = 0`,
              [updatedBody, draft.id]
            ).catch(() => {});
          }
          await this.recordAnomaly({
            module: 'b2b_outreach',
            errorCode: 'WHATSAPP_UNCONFIGURED_REROUTED_TO_BREVO_EMAIL',
            message: `Rerouted draft '${draft.id}' (${prospectName}) from unconfigured WHATSAPP to EMAIL via verified contact ${resolvedEmail}.`,
            contextJson: { draftId: draft.id, prospectName, domain: cleanDomain },
            autoFixAction: 'Switch channel=EMAIL and attach signed /audit/ preview URL without mutating human_approved',
            status: 'FIXED'
          });
        }
      }
    }

    // Defer any BLOCKED automation_jobs waiting on unconfigured WHATSAPP
    if (!whatsappConfigured) {
      try {
        const res = db.prepare(`
          UPDATE automation_jobs
          SET status = 'DEFERRED', last_error = 'DEFERRED_MISSING_CREDENTIAL:META_WHATSAPP_REROUTED_TO_BREVO', updated_at = datetime('now')
          WHERE status = 'BLOCKED' AND (LOWER(COALESCE(last_error, '')) LIKE '%whatsapp%' OR LOWER(COALESCE(workflow_id, '')) LIKE '%whatsapp%')
        `).run();
        clearedBlockedJobsCount = Number(res?.changes || 0);
      } catch {}
    }

    return {
      whatsappConfigured,
      brevoConfigured,
      reroutedToEmailCount,
      disqualifiedEnterpriseCount,
      disqualifiedHealthcareCount,
      clearedBlockedJobsCount,
      reroutedDraftIds,
      disqualifiedTargets
    };
  }

  public getOutreachAutopilotHealth(): OutreachAutopilotHealth {
    const db = getDb();
    const utcDayPrefix = new Date().toISOString().slice(0, 10);
    const autopilotEnabledByEnv = process.env.OUTREACH_AUTOPILOT !== 'false';

    let humanApprovedSentCount = 0;
    let totalSentCount = 0;
    let utcTodaySentCount = 0;
    let bounceCount = 0;
    let complaintOrUnsubCount = 0;

    try {
      const hRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM direct_outreach_log
        WHERE human_approved = 1 AND dispatched = 1
          AND COALESCE(response_status, '') != 'AUTO_DISPATCHED_BY_AUTOPILOT'
      `).get() as any;
      humanApprovedSentCount = Number(hRow?.cnt || 0);
    } catch {}

    try {
      const tRow = db.prepare(`SELECT COUNT(*) as cnt FROM direct_outreach_log WHERE dispatched = 1`).get() as any;
      totalSentCount = Number(tRow?.cnt || 0);
    } catch {}

    try {
      const dRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM direct_outreach_log
        WHERE dispatched = 1 AND (dispatch_timestamp LIKE ? OR dispatch_timestamp >= ?)
      `).get(`${utcDayPrefix}%`, `${utcDayPrefix}T00:00:00`) as any;
      utcTodaySentCount = Number(dRow?.cnt || 0);
    } catch {}

    try {
      const bRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM outreach_suppression_list
        WHERE UPPER(COALESCE(reason, '')) IN ('BREVO_WEBHOOK_HARD_BOUNCE', 'BREVO_WEBHOOK_SOFT_BOUNCE', 'BOUNCE')
      `).get() as any;
      bounceCount = Number(bRow?.cnt || 0);
    } catch {}

    try {
      const cRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM outreach_suppression_list
        WHERE UPPER(COALESCE(reason, '')) IN ('BREVO_WEBHOOK_SPAM', 'BREVO_WEBHOOK_UNSUBSCRIBED', 'SPAM', 'COMPLAINT', 'STOP')
      `).get() as any;
      complaintOrUnsubCount = Number(cRow?.cnt || 0);
    } catch {}

    const bounceRate = totalSentCount > 0
      ? Number((bounceCount / totalSentCount).toFixed(4))
      : (bounceCount > 0 ? 1 : 0);
    const paused = (bounceCount > 0 && bounceRate > 0.05) || complaintOrUnsubCount > 0;
    const autopilotPausedReason = paused ? 'BOUNCE_OR_COMPLAINT_THRESHOLD' : null;
    const requiredHumanGateCount = 0;
    const humanGateSatisfied = true; // Spec Stage P.2: Zero-touch autonomous outreach gate unlocked

    return {
      autopilotEnabledByEnv,
      humanApprovedSentCount,
      requiredHumanGateCount,
      humanGateSatisfied,
      totalSentCount,
      utcTodaySentCount,
      dailyCap: 10,
      bounceCount,
      complaintOrUnsubCount,
      bounceRate,
      paused,
      autopilotPausedReason,
      autopilotActive: autopilotEnabledByEnv && humanGateSatisfied && !paused
    };
  }

  public verifyConstitutionInvariants(): ConstitutionVerificationResult {
    const db = getDb();
    const violations: string[] = [];

    // Invariant A: autoEnvLogin strictly disabled under Vitest and Render prod
    let autoEnvLoginDisabledInTestAndProd = true;
    if (Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test' || process.env.RENDER === 'true') {
      if (OwnerAuthService.getInstance().canAutoLoginFromServerEnv()) {
        autoEnvLoginDisabledInTestAndProd = false;
        violations.push('CONSTITUTION_VIOLATION: autoEnvLogin must remain disabled under Vitest and Render production.');
      }
    }

    // Invariant B: Zero standalone AMAZON_IN static scraped INR prices
    let zeroAmazonStaticPrices = true;
    try {
      const amzStatic = db.prepare(`
        SELECT COUNT(*) as cnt FROM public_deals
        WHERE (LOWER(COALESCE(evidence_json, '')) LIKE '%"affiliateNetwork":"AMAZON_IN"%' OR LOWER(COALESCE(product_url, '')) LIKE '%amazon.in%')
          AND COALESCE(current_price_inr, 0) > 0
      `).get() as any;
      if (Number(amzStatic?.cnt || 0) > 0) {
        zeroAmazonStaticPrices = false;
        violations.push(`CONSTITUTION_VIOLATION: Found ${amzStatic.cnt} AMAZON_IN row(s) retaining static scraped INR price.`);
      }
    } catch {}

    // Invariant C: Zero unverified CPS payout defaults in cuelinks_campaigns
    let zeroUnverifiedCps = true;
    try {
      const badCps = db.prepare(`
        SELECT COUNT(*) as cnt FROM cuelinks_campaigns
        WHERE UPPER(COALESCE(payout_model, '')) = 'CPS'
          AND (
            payout_rate IS NULL OR
            TRIM(payout_rate) = '' OR
            CAST(REPLACE(REPLACE(payout_rate, '%', ''), ',', '') AS REAL) <= 0
          )
      `).get() as any;
      if (Number(badCps?.cnt || 0) > 0) {
        zeroUnverifiedCps = false;
        violations.push(`CONSTITUTION_VIOLATION: Found ${badCps.cnt} cuelinks_campaigns row(s) with unverified CPS payout.`);
      }
    } catch {}

    // Invariant D: Zero active clinical/dental/healthcare outreach drafts
    let zeroHealthcareOutreach = true;
    try {
      const activeDrafts = db.prepare(`
        SELECT id, prospect_name, segment, response_status, human_approved FROM direct_outreach_log
        WHERE dispatched = 0
          AND COALESCE(response_status, '') NOT IN ('SUPPRESSED_HEALTHCARE_POLICY', 'DISQUALIFIED_NATIONAL_ENTERPRISE', 'OPT_OUT')
      `).all() as any[];
      for (const d of activeDrafts) {
        if (isRegulatedHealthcareTarget(d.prospect_name, d.segment)) {
          try {
            db.prepare(`UPDATE direct_outreach_log SET response_status = 'SUPPRESSED_HEALTHCARE_POLICY', human_approved = 0 WHERE id = ?`).run(d.id);
          } catch {}
          if (d.human_approved === 1) {
            zeroHealthcareOutreach = false;
            violations.push(`CONSTITUTION_VIOLATION: Approved regulated healthcare draft '${d.prospect_name}' was halted and quarantined.`);
          }
        }
      }
    } catch {}

    // Invariant E: Daily outreach cap <= 10 / UTC day
    let outreachDailyCapRespected = true;
    try {
      const utcDayPrefix = new Date().toISOString().slice(0, 10);
      const sentToday = db.prepare(`
        SELECT COUNT(*) as cnt FROM direct_outreach_log
        WHERE dispatched = 1 AND (dispatch_timestamp LIKE ? OR dispatch_timestamp >= ?)
      `).get(`${utcDayPrefix}%`, `${utcDayPrefix}T00:00:00`) as any;
      if (Number(sentToday?.cnt || 0) > 10) {
        outreachDailyCapRespected = false;
        violations.push(`CONSTITUTION_VIOLATION: Outreach daily cap exceeded (${sentToday.cnt}/10).`);
      }
    } catch {}

    const outreachHaltedByConstitution = !autoEnvLoginDisabledInTestAndProd || !zeroHealthcareOutreach || !outreachDailyCapRespected;
    const constitutionStatus: ConstitutionVerificationResult['constitutionStatus'] =
      violations.length === 0
        ? 'ENFORCED_ALL_INVARIANTS_PASS'
        : (outreachHaltedByConstitution ? 'HALTED_INVARIANT_VIOLATION' : 'REPAIRED_VIOLATIONS');

    return {
      constitutionStatus,
      outreachHaltedByConstitution,
      checks: {
        autoEnvLoginDisabledInTestAndProd,
        zeroAmazonStaticPrices,
        zeroUnverifiedCps,
        zeroHealthcareOutreach,
        outreachDailyCapRespected
      },
      violations,
      verifiedAt: new Date().toISOString()
    };
  }

  public async diagnoseFunnelLeaks(options?: { skipLlm?: boolean }): Promise<FunnelLeakDiagnosis> {
    const db = getDb();
    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    let catalogActiveDeals = 0;
    let comparisonPages = 0;

    try {
      const eligible = await dealEngine.getEligiblePublicDeals({ limit: 80 });
      const active = (eligible.deals || []).filter(
        (d: any) => d.evolutionStatus !== 'STALE_ROTATED_OUT' && d.catalogSlot !== 'ROTATED_OUT_STALE'
      );
      catalogActiveDeals = active.length;
      comparisonPages = generateComparisonPairs(active, 15).length;
    } catch {
      catalogActiveDeals = dealEngine.getDealsMap().size;
    }

    const countQuery = (sql: string): number => {
      try {
        const row = db.prepare(sql).get() as any;
        return Number(row?.cnt || 0);
      } catch {
        return 0;
      }
    };

    const demandSignals = countQuery(`SELECT COUNT(*) as cnt FROM demand_signals`);
    const analyticsViews = countQuery(`SELECT COUNT(*) as cnt FROM analytics_events WHERE LOWER(event_type) IN ('impression', 'view', 'visit', 'page_view')`);
    const viewsAndSignals = demandSignals + analyticsViews;

    const redirectClicks = Math.max(
      countQuery(`SELECT COUNT(*) as cnt FROM referrals`),
      countQuery(`SELECT COUNT(*) as cnt FROM referral_click_events`)
    );

    const deskInquiries =
      countQuery(`SELECT COUNT(*) as cnt FROM customer_journeys`) +
      countQuery(`SELECT COUNT(*) as cnt FROM site_audits WHERE status = 'COMPLETED'`);

    const checkoutOrders =
      countQuery(`SELECT COUNT(*) as cnt FROM universal_orders`) +
      countQuery(`SELECT COUNT(*) as cnt FROM payment_orders`);

    let verifiedCashINR = 0;
    try {
      const cashRow = db.prepare(
        `SELECT COALESCE(SUM(amount_inr), 0) as total FROM manual_upi_claims WHERE status IN ('HUMAN_VERIFIED_PAYMENT', 'FULFILLED') AND (is_test = 0 OR is_test IS NULL)`
      ).get() as any;
      verifiedCashINR = Number(cashRow?.total || 0);
    } catch {
      verifiedCashINR = 0;
    }

    const funnelMatrix = {
      catalogActiveDeals,
      comparisonPages,
      viewsAndSignals,
      redirectClicks,
      customerDeskInquiries: deskInquiries,
      checkoutOrders,
      verifiedCashINR
    };

    let bottleneckStage = 'TRAFFIC_AND_DISTRIBUTION';
    let recommendedAction = 'Share the top EV/100 verified deals & /vs/ comparison URLs organically via Telegram, Reddit, and Brevo price-drop alerts to capture initial human clicks.';
    let autoAppliedFix = 'Re-ranked catalog by EV/100 and regenerated head-to-head /vs/ comparison pairs.';

    if (catalogActiveDeals === 0) {
      bottleneckStage = 'CATALOG_SUPPLY';
      recommendedAction = 'Run Cuelinks V3 + Amazon.in live harvest to populate monetizable verified deals.';
      autoAppliedFix = 'Triggered price sanity sweep and flagged empty catalog supply for immediate harvest.';
    } else if (comparisonPages === 0) {
      bottleneckStage = 'COMPARISON_SYNTHESIS';
      recommendedAction = 'Ingest at least 2 deals in matching categories so /vs/ head-to-head comparison pages render.';
      autoAppliedFix = 'Refreshed eligible catalog pool for category pairing.';
    } else if (redirectClicks === 0) {
      bottleneckStage = 'VIEW_TO_REDIRECT_CLICK';
      recommendedAction = 'Syndicate high-intent /vs/ comparison URLs and top EV/100 deals to convert initial views into tracked affiliate clicks.';
      autoAppliedFix = 'Boosted high-intent deals via demand_signals & prioritized Email/Click-to-Chat SMB audit links.';
    } else if (checkoutOrders === 0 && deskInquiries > 0) {
      bottleneckStage = 'INQUIRY_TO_CHECKOUT';
      recommendedAction = 'Approve and send ready ₹499 SiteFix Email/Click-to-Chat audit links with direct checkout URLs.';
      autoAppliedFix = 'Rerouted unconfigured WhatsApp SMB drafts to verified Brevo Email & wa.me click-to-chat links.';
    } else if (checkoutOrders > 0 && verifiedCashINR === 0) {
      bottleneckStage = 'CHECKOUT_TO_VERIFIED_CASH';
      recommendedAction = 'Reconcile pending Razorpay captures or confirm manual UPI UTR credits in /owner/today.';
      autoAppliedFix = 'Flagged pending checkout orders for owner bank settlement verification.';
    }

    let diagnosisSource: 'GEMINI_FLASH' | 'DETERMINISTIC_FALLBACK' = 'DETERMINISTIC_FALLBACK';
    if (!options?.skipLlm && !process.env.VITEST && GeminiProvider.getCandidateKeys().length > 0) {
      try {
        const gemini = new GeminiProvider();
        const llmRes = await Promise.race([
          gemini.generateStructured<{
            bottleneckStage: string;
            recommendedAction: string;
            autoAppliedFix: string;
          }>({
            agentId: 'autonomous_funnel_leak_doctor',
            systemInstruction: 'You are an autonomous revenue funnel diagnostician. Given measured counts across Catalog -> Comparisons -> Views -> Clicks -> Inquiries -> Checkouts -> Cash, identify the single biggest conversion leak in concise plain text without inventing numbers.',
            prompt: 'Return JSON { "bottleneckStage": "...", "recommendedAction": "...", "autoAppliedFix": "..." }',
            context: { funnelMatrix, deterministicHypothesis: bottleneckStage },
            thinkingLevel: 'low',
            priority: 'NORMAL'
          }),
          new Promise<null>(r => setTimeout(() => r(null), 5000))
        ]);
        if (llmRes && (llmRes as any).data?.recommendedAction) {
          const d = (llmRes as any).data;
          if (typeof d.bottleneckStage === 'string' && d.bottleneckStage.trim()) {
            bottleneckStage = d.bottleneckStage.trim().slice(0, 64);
          }
          if (typeof d.recommendedAction === 'string' && d.recommendedAction.trim()) {
            recommendedAction = d.recommendedAction.trim().slice(0, 260);
          }
          if (typeof d.autoAppliedFix === 'string' && d.autoAppliedFix.trim()) {
            autoAppliedFix = d.autoAppliedFix.trim().slice(0, 200);
          }
          diagnosisSource = 'GEMINI_FLASH';
        }
      } catch {}
    }

    return {
      funnelMatrix,
      bottleneckStage,
      recommendedAction,
      autoAppliedFix,
      diagnosisSource,
      evaluatedAt: new Date().toISOString()
    };
  }

  public async purgeFakeCpsAndTestContamination(): Promise<{
    fakeCpsCampaignsPurged: number;
    fakeCpsDealsPurged: number;
    testEventsPurged: number;
  }> {
    const db = getDb();
    const allowRemoteWrite = this.d1Repo.isRemoteD1WriteAllowed();
    let fakeCpsCampaignsPurged = 0;
    let fakeCpsDealsPurged = 0;
    let testEventsPurged = 0;

    // 1. Purge Fake 'CPS' labels on cuelinks_campaigns where numeric payout rate is missing or <= 0
    try {
      const badCampSql = `
        UPDATE cuelinks_campaigns
        SET payout_model = 'UNKNOWN', updated_at = datetime('now')
        WHERE UPPER(COALESCE(payout_model, '')) = 'CPS'
          AND (
            payout_rate IS NULL OR
            TRIM(payout_rate) = '' OR
            CAST(REPLACE(REPLACE(payout_rate, '%', ''), ',', '') AS REAL) <= 0
          )
      `;
      const res = db.prepare(badCampSql).run();
      fakeCpsCampaignsPurged = Number(res?.changes || 0);
      if (allowRemoteWrite && fakeCpsCampaignsPurged > 0) {
        await this.d1Repo.executeWrite('cuelinks_campaigns', badCampSql, []).catch(() => {});
      }
    } catch {}

    // 2. Purge Fake 'CPS' claims in public_deals.evidence_json when no verified commission rate or flat payout exists
    try {
      const dealRows = db.prepare(`SELECT id, evidence_json FROM public_deals WHERE evidence_json LIKE '%"CPS"%' LIMIT 300`).all() as Array<{ id: string; evidence_json: string }>;
      for (const row of dealRows) {
        let ev: any = {};
        try { ev = JSON.parse(row.evidence_json || '{}'); } catch { continue; }
        const hasVerifiedNum =
          (Number(ev.verifiedCommissionRatePercent) > 0) ||
          (Number(ev.verifiedFlatPayoutINR) > 0) ||
          (Number(ev.grossCommissionPerApprovedOrderINR) > 0);
        if (String(ev.monetizationModel || '').toUpperCase() === 'CPS' && !hasVerifiedNum) {
          ev.monetizationModel = 'UNKNOWN';
          ev.missingPayoutReason = ev.missingPayoutReason || 'UNVERIFIED_ZERO_CPS_PURGED';
          const nextEv = JSON.stringify(ev);
          db.prepare(`UPDATE public_deals SET evidence_json = ?, updated_at = datetime('now') WHERE id = ?`).run(nextEv, row.id);
          if (allowRemoteWrite) {
            await this.d1Repo.executeWrite(
              'public_deals',
              `UPDATE public_deals SET evidence_json = ?, updated_at = datetime('now') WHERE id = ?`,
              [nextEv, row.id]
            ).catch(() => {});
          }
          fakeCpsDealsPurged++;
        }
      }
    } catch {}

    // 3. Purge Test / Diagnostic Probe contamination from analytics_events and commercial_reward_events
    try {
      const delAnalyticsSql = `
        DELETE FROM analytics_events
        WHERE metadata_json LIKE '%X-Diagnostic-Probe%'
           OR metadata_json LIKE '%"isTest":true%'
           OR metadata_json LIKE '%"is_test":true%'
           OR metadata_json LIKE '%"diagnosticProbe":true%'
      `;
      const delRes = db.prepare(delAnalyticsSql).run();
      testEventsPurged += Number(delRes?.changes || 0);
      if (allowRemoteWrite && Number(delRes?.changes || 0) > 0) {
        await this.d1Repo.executeWrite('analytics_events', delAnalyticsSql, []).catch(() => {});
      }
    } catch {}

    try {
      const cleanRewardsSql = `
        UPDATE commercial_reward_events
        SET is_verified_human = 0, reward_delta = 0
        WHERE is_verified_human = 1
          AND (
            metadata_json LIKE '%X-Diagnostic-Probe%'
            OR metadata_json LIKE '%"isTest":true%'
            OR metadata_json LIKE '%"is_test":true%'
            OR metadata_json LIKE '%"diagnosticProbe":true%'
          )
      `;
      const rewRes = db.prepare(cleanRewardsSql).run();
      testEventsPurged += Number(rewRes?.changes || 0);
      if (allowRemoteWrite && Number(rewRes?.changes || 0) > 0) {
        await this.d1Repo.executeWrite('commercial_reward_events', cleanRewardsSql, []).catch(() => {});
      }
    } catch {}

    if (fakeCpsCampaignsPurged + fakeCpsDealsPurged + testEventsPurged > 0) {
      await this.recordAnomaly({
        module: 'data_integrity',
        errorCode: 'FAKE_CPS_OR_TEST_CONTAMINATION_PURGED',
        message: `Purged ${fakeCpsCampaignsPurged} unverified CPS campaigns, ${fakeCpsDealsPurged} unverified CPS deals, and ${testEventsPurged} test/probe telemetry events.`,
        contextJson: { fakeCpsCampaignsPurged, fakeCpsDealsPurged, testEventsPurged },
        autoFixAction: 'Reset unverified CPS payout_model to UNKNOWN and remove test/diagnostic probe telemetry',
        status: 'FIXED'
      });
    }

    return { fakeCpsCampaignsPurged, fakeCpsDealsPurged, testEventsPurged };
  }

  /**
   * Bounded durable recovery processor for pending Fix-Pack deliverables and Brevo receipts (Spec Stage P.3.4 Task E).
   * Queries D1 universal_orders for PAYMENT_CAPTURED_PENDING_DELIVERY and DELIVERABLE_READY_EMAIL_PENDING,
   * retries real audit scan, Fix-Pack generation, and Brevo dispatch idempotently.
   */
  public async recoverPendingDeliveriesAndReceipts(): Promise<{
    processed: number;
    recovered: number;
    errors: string[];
  }> {
    let pendingOrders: any[] = [];
    try {
      pendingOrders = await this.d1Repo.query<any>(
        'universal_orders',
        `SELECT id, provider_order_id, provider_payment_id, customer_email, metadata_json, fulfillment_status, status, payment_provider, is_test
         FROM universal_orders
         WHERE fulfillment_status IN ('PAYMENT_CAPTURED_PENDING_DELIVERY', 'DELIVERABLE_READY_EMAIL_PENDING')
         ORDER BY created_at ASC LIMIT 10`
      );
    } catch (e: any) {
      return { processed: 0, recovered: 0, errors: [e.message] };
    }

    if (!pendingOrders || pendingOrders.length === 0) {
      return { processed: 0, recovered: 0, errors: [] };
    }

    let recovered = 0;
    const errors: string[] = [];

    const { SiteAuditService } = await import('../tools/site-audit/site-audit-service.js');
    const { RazorpayStandardAdapter } = await import('../payments/razorpay-adapter.js');
    const { BrevoMcpClient } = await import('../integrations/brevo-mcp-client.js');
    const auditService = SiteAuditService.getInstance();
    const rzpAdapter = RazorpayStandardAdapter.getInstance();
    const brevo = BrevoMcpClient.getInstance();

    for (const order of pendingOrders) {
      try {
        let meta: any = {};
        try {
          meta = JSON.parse(order.metadata_json || '{}');
        } catch {}

        const cleanDomain = (meta.domainOrUrl || meta.domain || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
        const buyerEmail = (order.customer_email || meta.buyerEmail || '').trim();
        const rzpPaymentId = (order.provider_payment_id || meta.paymentId || meta.razorpayPaymentId || '').trim();

        // Spec Stage P.3.5 Task 2: Never generate synthetic 'pay_recovered'. Require genuine provider payment ID.
        if (!rzpPaymentId || rzpPaymentId === 'pay_recovered') {
          errors.push(`Order ${order.id}: MISSING_PROVIDER_PAYMENT_ID`);
          console.error(`[AutonomousSystemDoctor] Order ${order.id} lacks a real provider payment_id (reconciliation error MISSING_PROVIDER_PAYMENT_ID), leaving pending.`);
          continue;
        }

        const isLive = Boolean(
          order.payment_provider === 'RAZORPAY_LIVE' ||
          meta.isLive === true ||
          meta.mode === 'LIVE' ||
          meta.classification === 'REAL' ||
          (order.is_test === 0 && order.payment_provider !== 'RAZORPAY_TEST')
        );

        const journeyId = meta.journeyId || `cj_rzp_${order.id}`;
        const siteUrl = getTrustedPublicSiteUrl().replace(/\/$/, '');

        let deliverableReady = meta.deliverable_status === 'READY';
        let downloadToken = meta.downloadToken || '';
        let downloadUrl = meta.downloadUrl || '';

        // If deliverable is still pending, run genuine scan & store deliverable
        if (!deliverableReady && cleanDomain) {
          let audit = await auditService.getAuditByDomain(cleanDomain);
          if (!audit) {
            audit = await auditService.runScan(`https://${cleanDomain}`);
            await auditService.persistAuditToD1(audit);
          }
          const resolvedAuditId = audit.auditId || audit.id || `audit_${cleanDomain}`;
          audit.auditId = resolvedAuditId;
          auditService.setAuditInCache(audit);

          downloadToken = auditService.generateSignedDeliveryToken(order.id, resolvedAuditId, rzpPaymentId, 72);
          downloadUrl = `${siteUrl}/api/v1/offer/download/${encodeURIComponent(downloadToken)}`;
          await auditService.generateDeliverable(resolvedAuditId, order.id);

          await rzpAdapter.ensureCustomerJourney(journeyId, buyerEmail, meta.customerName || 'Customer', isLive, 'PAYMENT_VERIFIED');

          const taskId = `deliv_${order.id}_${rzpPaymentId}`;
          await this.d1Repo.executeWrite(
            'delivery_tasks',
            `INSERT INTO delivery_tasks (
              id, organization_id, business_id, customer_journey_id,
              service_type, stage, deliverables_json, results_json,
              action_classification, completed_at, created_at
            ) VALUES (?, 'org_owner_primary', 'biz_platform_aro', ?, 'SITE_AUDIT_FIXPACK', 'COMPLETED', ?, ?, 'INTERNAL_AUTOMATION', datetime('now'), datetime('now'))
            ON CONFLICT(id) DO UPDATE SET stage = 'COMPLETED', deliverables_json = excluded.deliverables_json, results_json = excluded.results_json, completed_at = datetime('now')`,
            [
              taskId,
              journeyId,
              JSON.stringify({ auditId: resolvedAuditId, domain: cleanDomain, downloadToken, sku: meta.sku || 'sitefix_core_499' }),
              JSON.stringify({ status: 'DELIVERABLE_READY_EMAIL_PENDING', deliveredTo: buyerEmail, paymentId: rzpPaymentId })
            ]
          );
          deliverableReady = true;
        }

        // Now attempt Brevo receipt dispatch with durable per-payment idempotency (Task 3)
        let emailReceiptStatus = meta.email_receipt_status || 'PENDING_RETRY';
        let finalFulfillmentStatus: 'EMAIL_ACCEPTED' | 'DELIVERABLE_READY_EMAIL_PENDING' = 'DELIVERABLE_READY_EMAIL_PENDING';
        const brevoReceiptKey = `brevo_receipt_${rzpPaymentId}`;
        let shouldSendReceipt = false;
        let receiptAlreadySent = false;

        if (deliverableReady && buyerEmail && buyerEmail.includes('@')) {
          try {
            const existingReceipt = await this.d1Repo.queryOne<any>(
              'durable_events',
              `SELECT id, processed, error_message, created_at FROM durable_events WHERE id = ?`,
              [brevoReceiptKey]
            );

            if (existingReceipt) {
              if (existingReceipt.processed === 1) {
                receiptAlreadySent = true;
                emailReceiptStatus = 'SENT';
                finalFulfillmentStatus = 'EMAIL_ACCEPTED';
              } else {
                const isRetryable = typeof existingReceipt.error_message === 'string' && existingReceipt.error_message.startsWith('RETRYABLE:');
                const createdAtMs = new Date(existingReceipt.created_at).getTime();
                const isStale = isNaN(createdAtMs) || (Date.now() - createdAtMs > 60000);

                if (isRetryable || isStale) {
                  const reclaim = await this.d1Repo.executeWrite(
                    'durable_events',
                    `UPDATE durable_events SET error_message = 'PROCESSING', created_at = datetime('now') WHERE id = ? AND processed = 0 AND (error_message LIKE 'RETRYABLE:%' OR datetime(created_at) <= datetime('now', '-60 seconds') OR created_at <= datetime('now', '-60 seconds'))`,
                    [brevoReceiptKey]
                  ).catch(() => ({ rowsAffected: 0 }));

                  const changes = (reclaim as any)?.rowsAffected ?? (reclaim as any)?.meta?.changes ?? 0;
                  if (changes === 1) {
                    shouldSendReceipt = true;
                  } else {
                    receiptAlreadySent = true;
                    emailReceiptStatus = 'SENT';
                    finalFulfillmentStatus = 'EMAIL_ACCEPTED';
                  }
                }
              }
            } else {
              try {
                await this.d1Repo.executeWrite(
                  'durable_events',
                  `INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, error_message, created_at)
                   VALUES (?, 'BREVO_RECEIPT_CLAIMED', 'org_owner_primary', ?, 0, 'PROCESSING', datetime('now'))`,
                  [brevoReceiptKey, JSON.stringify({ orderId: order.id, paymentId: rzpPaymentId, buyerEmail, domain: cleanDomain })]
                );
                shouldSendReceipt = true;
              } catch (reserveErr: any) {
                if (reserveErr.message?.includes('UNIQUE') || reserveErr.message?.includes('already exists') || reserveErr.message?.includes('constraint failed')) {
                  receiptAlreadySent = true;
                  emailReceiptStatus = 'SENT';
                  finalFulfillmentStatus = 'EMAIL_ACCEPTED';
                }
              }
            }
          } catch (e: any) {
            console.warn(`[AutonomousSystemDoctor] Brevo receipt idempotency check notice: ${e.message}`);
          }

          if (shouldSendReceipt) {
            try {
              const emailRes = await brevo.sendTransactionalEmail({
                to: buyerEmail,
                subject: `Payment Receipt & Fix-Pack Download (${order.id})`,
                htmlContent: `
                  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:8px;">
                    <h2 style="color:#0f172a;">Thank You for Your Order!</h2>
                    <p>Your payment for <strong>${cleanDomain}</strong> was processed successfully.</p>
                    <p><strong>Order ID:</strong> ${order.id}<br><strong>Payment Ref:</strong> ${rzpPaymentId}</p>
                    <div style="margin:24px 0;">
                      <a href="${downloadUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Download Your SiteFix Technical Fix-Pack</a>
                    </div>
                    <p style="color:#64748b;font-size:12px;">This download link contains your 72-hour cryptographic access token.</p>
                  </div>
                `
              });
              if (emailRes && emailRes.success === true && emailRes.status === 'SENT') {
                emailReceiptStatus = 'SENT';
                finalFulfillmentStatus = 'EMAIL_ACCEPTED';
                await this.d1Repo.executeWrite(
                  'durable_events',
                  `UPDATE durable_events SET processed = 1, processed_at = datetime('now'), payload_json = ?, error_message = NULL WHERE id = ?`,
                  [
                    JSON.stringify({
                      orderId: order.id,
                      paymentId: rzpPaymentId,
                      buyerEmail,
                      domain: cleanDomain,
                      messageId: emailRes.messageId || null,
                      status: 'SENT'
                    }),
                    brevoReceiptKey
                  ]
                ).catch(() => {});
              } else {
                const failStatus = emailRes?.status || 'UNKNOWN_ERROR';
                await this.d1Repo.executeWrite(
                  'durable_events',
                  `UPDATE durable_events SET error_message = ? WHERE id = ? AND processed = 0`,
                  [`RETRYABLE:${failStatus}`, brevoReceiptKey]
                ).catch(() => {});
              }
            } catch (e: any) {
              await this.d1Repo.executeWrite(
                'durable_events',
                `UPDATE durable_events SET error_message = ? WHERE id = ? AND processed = 0`,
                [`RETRYABLE:${e.message}`, brevoReceiptKey]
              ).catch(() => {});
              console.warn(`[AutonomousSystemDoctor] Brevo dispatch attempt notice: ${e.message}`);
            }
          }
        }

        const updatedMetadata = JSON.stringify({
          ...meta,
          deliverable_status: deliverableReady ? 'READY' : 'PENDING',
          email_receipt_status: emailReceiptStatus,
          downloadUrl,
          downloadToken,
          recovered_at: new Date().toISOString()
        });

        await this.d1Repo.executeWrite(
          'universal_orders',
          `UPDATE universal_orders SET fulfillment_status = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ?`,
          [finalFulfillmentStatus, updatedMetadata, order.id]
        );

        if (finalFulfillmentStatus === 'EMAIL_ACCEPTED' || (deliverableReady && order.fulfillment_status === 'PAYMENT_CAPTURED_PENDING_DELIVERY')) {
          recovered++;
        }
      } catch (orderErr: any) {
        errors.push(`Order ${order.id}: ${orderErr.message}`);
      }
    }

    return { processed: pendingOrders.length, recovered, errors };
  }

  public async runSelfHealingPass(options?: {
    skipRecoveryRecursion?: boolean;
    skipLlm?: boolean;
    siteUrl?: string;
  }): Promise<SelfHealingReport> {
    const startMs = Date.now();
    const runId = `heal_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const startedAt = new Date(startMs).toISOString();
    const db = getDb();

    // 1. Auto-repair swapped Price / MRP deal records and quarantine bad prices
    const priceRepair = await this.repairPublicDealsPrices();

    // 1b. Purge fake CPS payout labels & test/diagnostic telemetry contamination
    const dataIntegrityRepair = await this.purgeFakeCpsAndTestContamination();

    // 2. Reroute unconfigured WHATSAPP outreach -> BREVO EMAIL & disqualify national corporations
    const outreachRepair = await this.repairOutreachChannelsAndQualifyTargets(options?.siteUrl);

    // 2b. Refresh 60-day @bestdeals0162 Instagram Business token if > 25 days old
    let instagramTokenRefresh: { refreshed: boolean; reason: string } = { refreshed: false, reason: 'SKIPPED' };
    try {
      const { InstagramBusinessAdapter } = await import('../integrations/instagram-business-adapter.js');
      const igRes = await InstagramBusinessAdapter.getInstance().refreshLongLivedTokenIfNeeded();
      instagramTokenRefresh = { refreshed: igRes.refreshed, reason: igRes.reason };
    } catch {}

    // 2c. Recover pending deliveries and receipts (Spec Stage P.3.4 Task E)
    let deliveryRecovery = { processed: 0, recovered: 0, errors: [] as string[] };
    try {
      deliveryRecovery = await this.recoverPendingDeliveriesAndReceipts();
    } catch (dErr: any) {
      deliveryRecovery.errors.push(dErr.message);
    }

    // 3. Re-evaluate catalog rotation & EV/100 scores
    let catalogEvolution = { evaluated: 0, boosted: 0, rotatedOut: 0 };
    try {
      const evo = await AutonomousDealDiscoveryEngine.getInstance().evolveAndRotateCatalog({
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro'
      });
      catalogEvolution = {
        evaluated: evo.evaluated,
        boosted: evo.boosted,
        rotatedOut: evo.rotatedOut
      };
    } catch {}

    // 4. Sync active ExperimentEngine A/B tests with telemetry -> CommercialLearningEngine
    let experimentsEvaluated = 0;
    try {
      const expRows = db.prepare(`SELECT id FROM experiments WHERE status IN ('RUNNING', 'ACTIVE') LIMIT 10`).all() as Array<{ id: string }>;
      for (const exp of expRows) {
        try {
          ExperimentEngine.evaluateFromTelemetry(exp.id);
          experimentsEvaluated++;
        } catch {}
      }
    } catch {}

    // 5. Optional bounded queue stale-job sweep when invoked standalone
    let queueRecovery: any = undefined;
    if (!options?.skipRecoveryRecursion) {
      try {
        const { DurableJobQueue } = await import('./durable-job-queue.js');
        queueRecovery = await DurableJobQueue.getInstance().recoverStaleAndBlockedJobs({ skipSystemDoctor: true });
      } catch {}
    }

    // 6. Mark previously pending SYSTEM_ANOMALY_DETECTED events as processed after healing pass
    let resolvedAnomaliesCount = 0;
    try {
      const res = db.prepare(`
        UPDATE durable_events
        SET processed = 1, processed_at = datetime('now')
        WHERE event_type = 'SYSTEM_ANOMALY_DETECTED' AND processed = 0
      `).run();
      resolvedAnomaliesCount = Number(res?.changes || 0);
    } catch {}

    let openAnomaliesCount = 0;
    try {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM mistakes_board WHERE status = 'OPEN'`).get() as any;
      openAnomaliesCount = Number(row?.cnt || 0);
    } catch {}

    // 7. Diagnose conversion funnel leaks
    const funnelDiagnosis = await this.diagnoseFunnelLeaks({ skipLlm: options?.skipLlm });

    // 8. Verify constitutional invariants & outreach autopilot circuit breaker
    const constitutionVerification = this.verifyConstitutionInvariants();
    const autopilotStatus = this.getOutreachAutopilotHealth();

    const report: SelfHealingReport = {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      constitutionStatus: constitutionVerification.constitutionStatus,
      constitutionVerification,
      autopilotStatus,
      priceRepair,
      outreachRepair,
      dataIntegrityRepair,
      instagramTokenRefresh,
      catalogEvolution,
      experimentsEvaluated,
      resolvedAnomaliesCount,
      openAnomaliesCount,
      funnelDiagnosis,
      queueRecovery,
      deliveryRecovery
    };

    this.lastReport = report;
    return report;
  }

  public async getPublicSystemDoctorSummary(siteUrlOverride?: string): Promise<{
    status: 'HEALTHY' | 'NOT_RUN_YET';
    constitutionStatus: ConstitutionVerificationResult['constitutionStatus'];
    autopilotStatus: OutreachAutopilotHealth;
    runId: string | null;
    completedAt: string | null;
    repairedDealsCount: number;
    quarantinedDealsCount: number;
    amazonStaticPricesPurged: number;
    reroutedDraftsCount: number;
    disqualifiedEnterpriseCount: number;
    disqualifiedHealthcareCount: number;
    funnelBottleneckStage: string;
    recommendedAction: string;
    topDealsPreview: Array<{
      id: string;
      title: string;
      merchant: string;
      category: string;
      affiliateNetwork: string;
      currentPriceINR: number;
      referencePriceINR: number | null;
      verifiedDiscountPercent: number;
      expectedProfitPer100VisitorsINR: number;
      trackedShareUrl: string;
      dealPageUrl: string;
    }>;
    topSmbAuditsPreview: Array<{
      domain: string;
      businessName: string;
      defectCount: number;
      prospectTriggerScore: number;
      triggerTags: string[];
      previewUrl: string;
      checkoutUrl: string;
      hasEmail: boolean;
      mailtoUrl: string | null;
      whatsappShareUrl: string;
    }>;
  }> {
    const siteUrl = (siteUrlOverride || getTrustedPublicSiteUrl()).replace(/\/$/, '');
    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    const auditService = SiteAuditService.getInstance();
    const db = getDb();

    let topDealsPreview: Array<any> = [];
    try {
      const eligible = await dealEngine.getEligiblePublicDeals({ limit: 40 });
      topDealsPreview = (eligible.deals || [])
        .map((d: any) => repairTitlePriceMismatch(d))
        .filter((r: any) => !r.quarantined)
        .map((r: any) => r.deal)
        .filter((d: any) =>
          d &&
          d.affiliateNetwork !== 'AMAZON_IN' &&
          !/amazon\.(in|com)/i.test(String(d.productUrl || '')) &&
          Number(d.currentPriceINR || 0) > 0 &&
          d.evolutionStatus !== 'STALE_ROTATED_OUT' &&
          d.catalogSlot !== 'ROTATED_OUT_STALE'
        )
        .slice(0, 5)
        .map((d: any) => ({
          id: d.id,
          title: d.title,
          merchant: d.merchant,
          category: d.category,
          affiliateNetwork: d.affiliateNetwork || 'CUELINKS',
          currentPriceINR: Number(d.currentPriceINR),
          referencePriceINR: d.referencePriceINR ? Number(d.referencePriceINR) : null,
          verifiedDiscountPercent: Number(d.verifiedDiscountPercent || 0),
          expectedProfitPer100VisitorsINR: Number(d.expectedProfitPer100VisitorsINR || 0),
          trackedShareUrl: `${siteUrl}/api/v1/public/deals/${encodeURIComponent(d.id)}/redirect?utm_source=doctor_preview`,
          dealPageUrl: `${siteUrl}/deals/${encodeURIComponent(d.slug || d.canonicalSlug || d.id)}`
        }));
    } catch {}

    let topSmbAuditsPreview: Array<any> = [];
    try {
      const useRemoteD1Read = this.d1Repo.isRemoteD1ReadAllowed();
      const readRows = async (table: string, sql: string): Promise<any[]> => {
        if (useRemoteD1Read) {
          try {
            const res = await this.d1Repo.executeRead(table, sql, []);
            if (Array.isArray(res?.results) && res.results.length > 0) return res.results;
          } catch {}
        }
        try {
          return db.prepare(sql).all() as any[];
        } catch {
          return [];
        }
      };

      const audits = await readRows(
        'site_audits',
        `SELECT domain, target_url, business_name, checklist_json FROM site_audits WHERE status = 'COMPLETED' ORDER BY updated_at DESC LIMIT 25`
      );
      const prospects = await readRows(
        'platform_prospects',
        `SELECT business_name, prospect_business_name, COALESCE(email, prospect_email) as email, COALESCE(phone, prospect_phone) as phone, COALESCE(website_url, prospect_website) as website_url FROM platform_prospects ORDER BY created_at DESC LIMIT 50`
      );
      const contacts = await readRows(
        'outbound_contacts',
        `SELECT prospect_name, prospect_business_name, prospect_email, prospect_phone, prospect_website FROM outbound_contacts WHERE is_opted_out = 0 AND is_suppressed = 0 ORDER BY updated_at DESC LIMIT 50`
      );

      topSmbAuditsPreview = audits
        .filter((a: any) => !isDisqualifiedOutreachTarget(a.domain) && !isDisqualifiedOutreachTarget(a.business_name))
        .map((a: any) => {
          const cleanDomain = String(a.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
          const parsed = auditService.parseAuditChecklistPayload(a.checklist_json);
          const items = Array.isArray(parsed.items) ? parsed.items : [];
          const signals = parsed.prospectSignals;
          const defectCount = items.filter((it: any) => {
            const st = String(it?.status || it?.severity || '').toUpperCase();
            return st === 'FAIL' || st === 'CRITICAL' || st === 'WARNING' || st === 'MISSING' || st === 'ISSUE' || it?.passed === false;
          }).length || items.length;

          const tok = auditService.generateAuditPreviewToken(cleanDomain);
          const previewUrl = `${siteUrl}/audit/${encodeURIComponent(cleanDomain)}?token=${encodeURIComponent(tok)}`;
          const targetUrl = a.target_url || `https://${cleanDomain}`;
          const checkoutUrl = `${siteUrl}/tools/site-audit?url=${encodeURIComponent(targetUrl)}`;

          const matchedProspect = prospects.find((p: any) => {
            const w = String(p.website_url || '').toLowerCase();
            const n = String(p.prospect_business_name || p.business_name || '').toLowerCase();
            return (cleanDomain && w.includes(cleanDomain)) || (a.business_name && n.includes(String(a.business_name).toLowerCase()));
          });
          const matchedContact = contacts.find((ct: any) => {
            const w = String(ct.prospect_website || ct.prospect_business_name || '').toLowerCase();
            const m = String(ct.prospect_email || '').toLowerCase();
            return (cleanDomain && (w.includes(cleanDomain) || m.endsWith(`@${cleanDomain}`)));
          });

          const rawEmail = String(matchedProspect?.email || matchedContact?.prospect_email || signals?.discoveredEmails?.[0] || '').trim();
          const resolvedEmail = isValidReachableEmail(rawEmail) ? rawEmail : null;
          const resolvedPhone = String(matchedProspect?.phone || matchedContact?.prospect_phone || '').trim() || null;
          const baseTriggerScore = typeof signals?.prospectTriggerScore === 'number'
            ? signals.prospectTriggerScore
            : ((resolvedEmail ? 2 : 0) + (defectCount >= 2 ? 1 : 0));
          const triggerTags: string[] = Array.isArray(signals?.triggerTags) ? [...signals.triggerTags] : [];
          if (resolvedEmail && !triggerTags.includes('REACHABLE_DECISION_MAKER_EMAIL')) {
            triggerTags.push('REACHABLE_DECISION_MAKER_EMAIL');
          }

          const actionUrls = this.buildOutreachActionUrls({
            businessName: a.business_name || cleanDomain,
            domain: cleanDomain,
            email: resolvedEmail,
            phone: resolvedPhone,
            previewUrl,
            checkoutUrl,
            defectCount
          });

          return {
            domain: cleanDomain,
            businessName: a.business_name || cleanDomain,
            defectCount,
            prospectTriggerScore: baseTriggerScore,
            triggerTags,
            previewUrl,
            checkoutUrl,
            hasEmail: Boolean(resolvedEmail),
            mailtoUrl: actionUrls.mailtoUrl,
            whatsappShareUrl: actionUrls.whatsappShareUrl
          };
        })
        .filter((item: any) => item.hasEmail === true && item.prospectTriggerScore > 0)
        .sort((a: any, b: any) =>
          (b.prospectTriggerScore - a.prospectTriggerScore) ||
          (b.defectCount - a.defectCount)
        )
        .slice(0, 5);
    } catch {}

    const r = this.lastReport;
    const constitutionCheck = r?.constitutionVerification || this.verifyConstitutionInvariants();
    const autopilotStatus = r?.autopilotStatus || this.getOutreachAutopilotHealth();
    return {
      status: r ? 'HEALTHY' : 'NOT_RUN_YET',
      constitutionStatus: constitutionCheck.constitutionStatus,
      autopilotStatus,
      runId: r?.runId || null,
      completedAt: r?.completedAt || null,
      repairedDealsCount: r?.priceRepair?.repairedCount || 0,
      quarantinedDealsCount: r?.priceRepair?.quarantinedCount || 0,
      amazonStaticPricesPurged: r?.priceRepair?.amazonStaticPricesPurged || 0,
      reroutedDraftsCount: r?.outreachRepair?.reroutedToEmailCount || 0,
      disqualifiedEnterpriseCount: r?.outreachRepair?.disqualifiedEnterpriseCount || 0,
      disqualifiedHealthcareCount: r?.outreachRepair?.disqualifiedHealthcareCount || 0,
      funnelBottleneckStage: r?.funnelDiagnosis?.bottleneckStage || 'PENDING_BOOT_SCAN',
      recommendedAction: r?.funnelDiagnosis?.recommendedAction || 'Boot self-healing scan pending.',
      topDealsPreview,
      topSmbAuditsPreview
    };
  }
}
