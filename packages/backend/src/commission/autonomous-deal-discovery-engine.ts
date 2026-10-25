/**
 * Autonomous Deal Discovery Engine V1.1 (Spec §§ 1–15)
 * Broad Internet Coverage · Real Verification · Zero Routine Owner Input
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { isProduction } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { DealSsrfGuard } from './deal-ssrf-guard.js';
import { CuelinksSyncManager } from './cuelinks-sync-manager.js';
import { CuelinksV3Client } from './cuelinks-v3-client.js';
import { GrowthExperimentTracker } from './growth-experiment-tracker.js';
import {
  NormalizedDeal,
  DiscoveredDealInput,
  DealSourceRecord,
  DealSourceClass,
  DealVerificationStatus,
  DiscountVerificationType,
  DealAvailability,
  DealQueryParams,
  DealEngineObservabilityMetrics,
  SevenStageCommercialFunnel,
  CommercialFunnelStage,
  CuelinksPaginationCursor
} from './deal-types.js';

export const MAX_OFFER_FRESHNESS_HOURS = 48;

export class AutonomousDealDiscoveryEngine {
  private static instance: AutonomousDealDiscoveryEngine;
  private d1Repo = D1RevenueRepository.getInstance();
  private cuelinksClient: CuelinksV3Client | null = null;
  private fetchFn: typeof fetch = globalThis.fetch;
  private lastCycleScannedSourceIds: Set<string> = new Set();

  // In-memory operational cache synced to durable D1 storage
  private sourcesMap: Map<string, DealSourceRecord> = new Map();
  private dealsMap: Map<string, NormalizedDeal> = new Map();
  private dealFingerprintMap: Map<string, string> = new Map(); // fingerprint -> dealId

  // Hermetic test injection & genuine candidate registration (Zero hardcoded products in production discovery)
  private injectedDealsForTesting: DiscoveredDealInput[] = [];
  private registeredCandidates: DiscoveredDealInput[] = [];

  // Strict 7-Stage Evidence-Based Commercial Funnel Counters
  // DISCOVERY → PAGE VISIT → DEAL CLICK → PROVIDER CLICK → REPORTED CONVERSION → VALIDATED COMMISSION → PAID COMMISSION
  // Strictly separated; zero assumed or inferred conversions; ₹0.00 cash until bank proof.
  private localPageVisitsCount: number = 0;
  private localDealClicksCount: number = 0;
  private verifiedCashReceivedINR: number = 0; // Strictly ₹0.00 until bank statement proof

  private lastCycleId: string = 'NONE';
  private lastScanTimestamp: string = 'NEVER';
  private lastCycleDurationMs: number = 0;
  private lastCycleStatus: string = 'NOT_RUN';

  private constructor() {
    this.seedDefaultIndianSources();
  }

  public static getInstance(): AutonomousDealDiscoveryEngine {
    if (!AutonomousDealDiscoveryEngine.instance) {
      AutonomousDealDiscoveryEngine.instance = new AutonomousDealDiscoveryEngine();
    }
    return AutonomousDealDiscoveryEngine.instance;
  }

  public static resetInstance(): void {
    AutonomousDealDiscoveryEngine.instance = undefined as any;
  }

  public injectDiscoveredDealsForTesting(deals: DiscoveredDealInput[]): void {
    this.injectedDealsForTesting = [...deals];
  }

  public clearInjectedDealsForTesting(): void {
    this.injectedDealsForTesting = [];
  }

  public registerDealCandidate(candidate: DiscoveredDealInput): void {
    this.registeredCandidates.push(candidate);
  }

  public registerDealCandidates(candidates: DiscoveredDealInput[]): void {
    this.registeredCandidates.push(...candidates);
  }

  public clearRegisteredCandidates(): void {
    this.registeredCandidates = [];
  }

  public getCuelinksClient(): CuelinksV3Client {
    if (!this.cuelinksClient) {
      this.cuelinksClient = CuelinksV3Client.getInstance();
    }
    return this.cuelinksClient;
  }

  public setCuelinksClient(client: CuelinksV3Client | null): void {
    this.cuelinksClient = client;
  }

  public setFetchFn(fn: typeof fetch | null): void {
    this.fetchFn = fn || globalThis.fetch;
  }

  public getFetchFn(): typeof fetch {
    return this.fetchFn;
  }

  /**
   * Seed curated initial Indian source inventory across all 4 classes (Spec § 2).
   */
  private seedDefaultIndianSources(): void {
    const defaultSources: DealSourceRecord[] = [
      // Class A: Retailers and Brands
      {
        id: 'src_croma_in',
        domain: 'croma.com',
        name: 'Croma India',
        sourceClass: 'RETAILER_BRAND',
        country: 'India',
        categories: ['Electronics & Appliances', 'Laptops & Computers', 'Audio & Wearables'],
        accessMethod: 'JSON_LD_STRUCTURED',
        documentationUrl: 'https://www.croma.com',
        permissionStatus: 'ALLOWED',
        rateLimitPerMinute: 30,
        trustScore: 92,
        scanFrequencyHours: 6,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_reliancedigital_in',
        domain: 'reliancedigital.in',
        name: 'Reliance Digital',
        sourceClass: 'RETAILER_BRAND',
        country: 'India',
        categories: ['Electronics & Peripherals', 'Home Appliances', 'Smartphones'],
        accessMethod: 'JSON_LD_STRUCTURED',
        documentationUrl: 'https://www.reliancedigital.in',
        permissionStatus: 'ALLOWED',
        rateLimitPerMinute: 30,
        trustScore: 90,
        scanFrequencyHours: 6,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_vijaysales_in',
        domain: 'vijaysales.com',
        name: 'Vijay Sales',
        sourceClass: 'RETAILER_BRAND',
        country: 'India',
        categories: ['Home Appliances', 'Televisions & Audio', 'Kitchen Appliances'],
        accessMethod: 'JSON_LD_STRUCTURED',
        documentationUrl: 'https://www.vijaysales.com',
        permissionStatus: 'ALLOWED',
        rateLimitPerMinute: 20,
        trustScore: 88,
        scanFrequencyHours: 6,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_boat_lifestyle',
        domain: 'boat-lifestyle.com',
        name: 'boAt Lifestyle',
        sourceClass: 'RETAILER_BRAND',
        country: 'India',
        categories: ['Audio & Headphones', 'Smartwatches & Fitness', 'Accessories'],
        accessMethod: 'JSON_LD_STRUCTURED',
        documentationUrl: 'https://www.boat-lifestyle.com',
        permissionStatus: 'ALLOWED',
        rateLimitPerMinute: 40,
        trustScore: 89,
        scanFrequencyHours: 6,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_gonoise_in',
        domain: 'gonoise.com',
        name: 'Noise India',
        sourceClass: 'RETAILER_BRAND',
        country: 'India',
        categories: ['Smartwatches', 'Wireless Audio', 'Personal Electronics'],
        accessMethod: 'JSON_LD_STRUCTURED',
        documentationUrl: 'https://www.gonoise.com',
        permissionStatus: 'ALLOWED',
        rateLimitPerMinute: 40,
        trustScore: 87,
        scanFrequencyHours: 6,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_lenovo_in',
        domain: 'lenovo.com',
        name: 'Lenovo India',
        sourceClass: 'RETAILER_BRAND',
        country: 'India',
        categories: ['Computers & Laptops', 'Monitors & Displays', 'Commercial Office'],
        accessMethod: 'PUBLIC_PROMOTION',
        documentationUrl: 'https://www.lenovo.com/in/en',
        permissionStatus: 'ALLOWED',
        rateLimitPerMinute: 20,
        trustScore: 94,
        scanFrequencyHours: 12,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_tatacliq_in',
        domain: 'tatacliq.com',
        name: 'Tata CLiQ',
        sourceClass: 'RETAILER_BRAND',
        country: 'India',
        categories: ['Electronics', 'Lifestyle & Household', 'Fashion'],
        accessMethod: 'JSON_LD_STRUCTURED',
        documentationUrl: 'https://www.tatacliq.com',
        permissionStatus: 'ALLOWED',
        rateLimitPerMinute: 25,
        trustScore: 91,
        scanFrequencyHours: 6,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_zoho_in',
        domain: 'zoho.com',
        name: 'Zoho India',
        sourceClass: 'RETAILER_BRAND',
        country: 'India',
        categories: ['SaaS & Business Software', 'CRM & Invoicing', 'Productivity'],
        accessMethod: 'PUBLIC_PROMOTION',
        documentationUrl: 'https://www.zoho.com/pricing.html',
        permissionStatus: 'ALLOWED',
        rateLimitPerMinute: 20,
        trustScore: 95,
        scanFrequencyHours: 24,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_oppo_in',
        domain: 'oppo.com',
        name: 'Oppo India',
        sourceClass: 'RETAILER_BRAND',
        country: 'India',
        categories: ['Smartphones & Mobile Accessories', 'Audio & Wearables'],
        accessMethod: 'PUBLIC_PROMOTION',
        documentationUrl: 'https://www.oppo.com/in/',
        permissionStatus: 'ALLOWED',
        rateLimitPerMinute: 30,
        trustScore: 90,
        scanFrequencyHours: 12,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },

      // Class B: Affiliate Networks & Authorized Offer Feeds
      {
        id: 'src_cuelinks_network',
        domain: 'cuelinks.com',
        name: 'Cuelinks India',
        sourceClass: 'AFFILIATE_NETWORK',
        country: 'India',
        categories: ['Multi-Category Indian Retail & eCommerce'],
        accessMethod: 'OFFICIAL_FEED',
        documentationUrl: 'https://www.cuelinks.com',
        permissionStatus: 'CONDITIONAL', // Conditional on operator campaign link / credentials
        rateLimitPerMinute: 60,
        trustScore: 85,
        scanFrequencyHours: 6,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_admitad_india',
        domain: 'admitad.com',
        name: 'Admitad India',
        sourceClass: 'AFFILIATE_NETWORK',
        country: 'India',
        categories: ['Consumer Electronics', 'Travel & Subscriptions'],
        accessMethod: 'OFFICIAL_FEED',
        documentationUrl: 'https://store.admitad.com',
        permissionStatus: 'CONDITIONAL',
        rateLimitPerMinute: 60,
        trustScore: 82,
        scanFrequencyHours: 12,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_earnkaro_india',
        domain: 'earnkaro.com',
        name: 'EarnKaro',
        sourceClass: 'AFFILIATE_NETWORK',
        country: 'India',
        categories: ['Indian eCommerce & Consumer Goods'],
        accessMethod: 'OFFICIAL_FEED',
        documentationUrl: 'https://earnkaro.com',
        permissionStatus: 'CONDITIONAL',
        rateLimitPerMinute: 30,
        trustScore: 80,
        scanFrequencyHours: 12,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },

      // Class C: Public Deal & Coupon Sources
      {
        id: 'src_desidime_public',
        domain: 'desidime.com',
        name: 'DesiDime Public Deals',
        sourceClass: 'PUBLIC_DEAL_FEED',
        country: 'India',
        categories: ['Indian Deal Aggregation', 'Electronics', 'Home & Grocery'],
        accessMethod: 'RSS_FEED',
        documentationUrl: 'https://www.desidime.com/deals.rss',
        permissionStatus: 'ALLOWED',
        rateLimitPerMinute: 15,
        trustScore: 84,
        scanFrequencyHours: 6,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },

      // Class D: Free Technical Discovery (RSS / Schema.org)
      {
        id: 'src_schema_org_offers',
        domain: 'schema.org',
        name: 'Schema.org JSON-LD Offer Engine',
        sourceClass: 'FREE_TECHNICAL_DISCOVERY',
        country: 'India',
        categories: ['Structured Product & Offer Discovery'],
        accessMethod: 'JSON_LD_STRUCTURED',
        documentationUrl: 'https://schema.org/Offer',
        permissionStatus: 'ALLOWED',
        monetizationLedger: 'AFFILIATE_COMMISSION',
        rateLimitPerMinute: 60,
        trustScore: 95,
        scanFrequencyHours: 6,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },

      // Class E & F: Multi-Category Market Discovery & Price Intelligence (Objective B)
      {
        id: 'src_travel_transit_deals',
        domain: 'cuelinks.com',
        name: 'Indian Travel & Transit Deals (Flights, Hotels & Bus)',
        sourceClass: 'AFFILIATE_NETWORK',
        country: 'India',
        categories: ['Travel: Flights, Hotels, Buses & Holiday Packages'],
        accessMethod: 'OFFICIAL_FEED',
        documentationUrl: 'https://developers.cuelinks.com/docs',
        permissionStatus: 'LIVE_VERIFIED',
        monetizationLedger: 'AFFILIATE_COMMISSION',
        rateLimitPerMinute: 60,
        trustScore: 88,
        scanFrequencyHours: 6,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_telecom_broadband_deals',
        domain: 'cuelinks.com',
        name: 'Indian Telecom, Broadband & DTH Plan Savings',
        sourceClass: 'AFFILIATE_NETWORK',
        country: 'India',
        categories: ['Telecom, Broadband & DTH Plans', 'Subscription Services'],
        accessMethod: 'OFFICIAL_FEED',
        documentationUrl: 'https://developers.cuelinks.com/docs',
        permissionStatus: 'LIVE_VERIFIED',
        monetizationLedger: 'AFFILIATE_COMMISSION',
        rateLimitPerMinute: 60,
        trustScore: 86,
        scanFrequencyHours: 12,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_compliant_finance_referrals',
        domain: 'cuelinks.com',
        name: 'Compliant Financial Referrals (Banking & Credit Cards)',
        sourceClass: 'AFFILIATE_NETWORK',
        country: 'India',
        categories: ['Compliant Financial Products: Credit Cards & Banking'],
        accessMethod: 'OFFICIAL_FEED',
        documentationUrl: 'https://developers.cuelinks.com/docs',
        permissionStatus: 'LIVE_VERIFIED',
        monetizationLedger: 'AFFILIATE_COMMISSION',
        complianceRisk: 'Zero unlicensed financial advice or misleading claims. Strictly authorized partner referral programs.',
        rateLimitPerMinute: 60,
        trustScore: 90,
        scanFrequencyHours: 12,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_ppac_fuel_intelligence',
        domain: 'ppac.gov.in',
        name: 'Petroleum Planning & Analysis Cell (PPAC) Daily Fuel Price Intelligence',
        sourceClass: 'PRICE_INTELLIGENCE_UTILITY',
        country: 'India',
        categories: ['Price Intelligence: Petrol & Diesel (Daily Retail Prices)'],
        accessMethod: 'OPEN_DATA_PORTAL',
        documentationUrl: 'https://www.ppac.gov.in',
        permissionStatus: 'LIVE_VERIFIED',
        monetizationLedger: 'PRICE_INTELLIGENCE_UTILITY',
        complianceRisk: 'Distinct consumer price intelligence utility; strictly isolated from affiliate commission ledgers.',
        rateLimitPerMinute: 20,
        trustScore: 99,
        scanFrequencyHours: 24,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      },
      {
        id: 'src_ogd_essential_commodities',
        domain: 'data.gov.in',
        name: 'Open Government Data Platform India (Department of Consumer Affairs)',
        sourceClass: 'OPEN_GOVERNMENT_DATA',
        country: 'India',
        categories: ['Essential Commodities: Daily Retail & Wholesale Prices'],
        accessMethod: 'OPEN_DATA_PORTAL',
        documentationUrl: 'https://data.gov.in',
        permissionStatus: 'LIVE_VERIFIED',
        monetizationLedger: 'CONSUMER_UTILITY',
        complianceRisk: 'Official benchmark public utility data. Zero fake affiliate commission assertions.',
        rateLimitPerMinute: 20,
        trustScore: 99,
        scanFrequencyHours: 24,
        totalOffersFound: 0,
        totalOffersRejected: 0,
        failureCount: 0
      }
    ];

    for (const src of defaultSources) {
      src.offersCollected = src.offersCollected || 0;
      this.sourcesMap.set(src.id, src);
    }
  }

  /**
   * Main Autonomous Deal Discovery Cycle (Spec § 1 & § 11).
   * Executes scheduled discovery across all 4 source classes without waiting for owner input.
   */
  public async runDiscoveryCycle(
    organizationId: string = 'org_owner_primary',
    businessId: string = 'biz_platform_aro'
  ): Promise<{
    cycleId: string;
    sourcesScanned: number;
    offersDiscovered: number;
    offersVerified: number;
    offersRejected: number;
    offersDeduplicated: number;
    activeDealsTotal: number;
    durationMs: number;
  }> {
    const startMs = Date.now();
    const cycleId = `deal_cycle_${startMs}`;
    this.lastCycleId = cycleId;

    console.log(`[DealEngine] Starting autonomous deal discovery cycle ${cycleId} at ${new Date().toISOString()}`);

    // 1. Sync persistent deal state from D1
    await this.syncFromD1Async(organizationId, businessId);

    // 2. Discover promotional deals across available sources
    const rawOffers: DiscoveredDealInput[] = await this.discoverDealsFromAllSources(organizationId, businessId);

    let offersVerified = 0;
    let offersRejected = 0;
    let offersDeduplicated = 0;

    // 3. Process each discovered offer through Verification & Deduplication Pipeline
    for (const raw of rawOffers) {
      const result = await this.ingestAndVerifyDeal(raw, organizationId, businessId);
      if (result.action === 'CREATED_VERIFIED' || result.action === 'UPDATED_VERIFIED') {
        offersVerified++;
      } else if (result.action === 'REJECTED') {
        offersRejected++;
      } else if (result.action === 'DEDUPLICATED') {
        offersDeduplicated++;
      }
    }

    // 4. Clean up expired deals (Spec § 5 Level 4 & Spec § 11)
    await this.deactivateExpiredDeals(organizationId, businessId);

    // 5. Re-rank active deals using Buyer-Value Ranking Engine (Spec § 7)
    this.reRankActiveDeals();

    // 6. Advance 6-hour commercial cycle state in GrowthExperimentTracker
    GrowthExperimentTracker.getInstance().advanceCommercialCycle(cycleId);

    // 7. Record cycle completion
    const durationMs = Date.now() - startMs;
    this.lastCycleDurationMs = durationMs;
    this.lastScanTimestamp = new Date().toISOString();
    this.lastCycleStatus = 'SUCCESS';

    const activeDealsTotal = Array.from(this.dealsMap.values()).filter(
      d => d.verificationStatus === 'VERIFIED' || d.verificationStatus === 'VERIFIED_WITH_CONDITIONS'
    ).length;

    const sourcesScannedCount = this.lastCycleScannedSourceIds ? this.lastCycleScannedSourceIds.size : 0;

    console.log(
      `[DealEngine] Cycle ${cycleId} finished in ${durationMs}ms: ` +
      `scanned ${sourcesScannedCount} sources, discovered ${rawOffers.length} offers, ` +
      `verified ${offersVerified}, deduplicated ${offersDeduplicated}, active deals total: ${activeDealsTotal}`
    );

    return {
      cycleId,
      sourcesScanned: sourcesScannedCount,
      offersDiscovered: rawOffers.length,
      offersVerified,
      offersRejected,
      offersDeduplicated,
      activeDealsTotal,
      durationMs
    };
  }

  /**
   * Discovers deals strictly from genuine, permitted sources (Spec § 2).
   * Hardcoded product records removed from production discovery path.
   */
  public async discoverDealsFromAllSources(
    organizationId: string = 'org_owner_primary',
    businessId: string = 'biz_platform_aro'
  ): Promise<DiscoveredDealInput[]> {
    const discovered: DiscoveredDealInput[] = [];
    const observationTimestamp = new Date().toISOString();

    // 1. Injected test candidates (deterministic unit testing without hardcoding in production path)
    if (this.injectedDealsForTesting.length > 0) {
      for (const d of this.injectedDealsForTesting) {
        discovered.push({
          ...d,
          observedAt: d.observedAt || observationTimestamp
        });
      }
    }

    // 2. Genuine registered deal candidates
    if (this.registeredCandidates.length > 0) {
      for (const d of this.registeredCandidates) {
        discovered.push({
          ...d,
          observedAt: d.observedAt || observationTimestamp
        });
      }
    }

    // 3. Adapter 1: Cuelinks Autonomous Monetization Feed (genuine permitted source with resumable pagination)
    try {
      this.lastCycleScannedSourceIds.add('src_cuelinks_network');
      const cuelinksDeals = await this.runCuelinksAdapter(organizationId, businessId);
      discovered.push(...cuelinksDeals);
    } catch (cuelinksErr: any) {
      console.warn(`[DealEngine] Cuelinks autonomous sync notice: ${cuelinksErr.message}`);
    }

    // 4. Adapter 2: Public Deal Feed RSS/Atom Adapter (e.g. DesiDime public feed)
    try {
      this.lastCycleScannedSourceIds.add('src_desidime_public');
      const rssDeals = await this.runRssDealFeedAdapter('src_desidime_public');
      discovered.push(...rssDeals);
    } catch (rssErr: any) {
      console.warn(`[DealEngine] RSS feed adapter notice: ${rssErr.message}`);
    }

    // 5. Adapter 3: Public Schema.org JSON-LD Structured Data Parser
    try {
      this.lastCycleScannedSourceIds.add('src_schema_org_offers');
      const schemaDeals = await this.runSchemaOrgAdapter('src_schema_org_offers');
      discovered.push(...schemaDeals);
    } catch (schemaErr: any) {
      console.warn(`[DealEngine] Schema.org adapter notice: ${schemaErr.message}`);
    }

    // Seamlessly convert eligible candidate deals through Cuelinks when authenticated (Spec § 5 & § 8)
    const enrichedDeals = await this.enrichCandidateDealsWithCuelinks(discovered);

    return enrichedDeals;
  }

  /**
   * Resumable Continuation Cursor Checkpointing for Cuelinks pagination.
   * Loads cursor from D1 workflows table under 'wf_cuelinks_sync_cursor'.
   */
  public async getCuelinksPaginationCursor(organizationId = 'org_owner_primary'): Promise<CuelinksPaginationCursor> {
    try {
      const sql = `SELECT outputs_json FROM workflows WHERE id = 'wf_cuelinks_sync_cursor'`;
      const row = await this.d1Repo.queryOne('workflows', sql, []);
      if (row && row.outputs_json) {
        const data = typeof row.outputs_json === 'string' ? JSON.parse(row.outputs_json) : row.outputs_json;
        if (typeof data.campaignPage === 'number' && typeof data.offerPage === 'number') {
          return {
            campaignPage: Math.max(1, data.campaignPage),
            offerPage: Math.max(1, data.offerPage),
            lastUpdated: data.lastUpdated || new Date().toISOString()
          };
        }
      }
    } catch {
      // Tolerate during initial bootstrap or test SQLite
    }
    return {
      campaignPage: 1,
      offerPage: 1,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Resumable Continuation Cursor Checkpointing for Cuelinks pagination.
   * Persists cursor into D1 workflows table under 'wf_cuelinks_sync_cursor'.
   */
  public async saveCuelinksPaginationCursor(
    cursor: CuelinksPaginationCursor,
    organizationId = 'org_owner_primary',
    businessId = 'biz_platform_aro'
  ): Promise<void> {
    try {
      const sql = `
        INSERT INTO workflows (
          id, organization_id, business_id, workflow_type, status, current_step,
          last_successful_checkpoint, retry_count, max_retries, inputs_json, outputs_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          current_step = excluded.current_step,
          last_successful_checkpoint = excluded.last_successful_checkpoint,
          inputs_json = excluded.inputs_json,
          outputs_json = excluded.outputs_json,
          updated_at = datetime('now')
      `;
      const inputsJson = JSON.stringify({ type: 'CUELINKS_SYNC_CURSOR' });
      const outputsJson = JSON.stringify(cursor);
      await this.d1Repo.executeWrite('workflows', sql, [
        'wf_cuelinks_sync_cursor',
        organizationId,
        businessId,
        'CUELINKS_SYNC_CURSOR',
        'COMPLETED',
        'PAGINATION_ACTIVE',
        `camp_${cursor.campaignPage}_offer_${cursor.offerPage}`,
        0,
        3,
        inputsJson,
        outputsJson
      ]);
    } catch {
      // Tolerate in test environments
    }
  }

  /**
   * Reset Cuelinks pagination cursor back to page 1.
   */
  public async resetCuelinksPaginationCursor(
    organizationId = 'org_owner_primary',
    businessId = 'biz_platform_aro'
  ): Promise<void> {
    const defaultCursor: CuelinksPaginationCursor = {
      campaignPage: 1,
      offerPage: 1,
      lastUpdated: new Date().toISOString()
    };
    await this.saveCuelinksPaginationCursor(defaultCursor, organizationId, businessId);
  }

  /**
   * Adapter 1: Cuelinks V3 campaigns & offers adapter with resumable pagination checkpointing.
   * Scans 2 pages per cycle, advancing cursor, wrapping around when end reached.
   * Supports both product deals and coupon-only deals (honest pricing; no invented MRPs).
   * Isolates failures so errors do not crash other discovery sources.
   */
  public async runCuelinksAdapter(
    organizationId: string = 'org_owner_primary',
    businessId: string = 'biz_platform_aro'
  ): Promise<DiscoveredDealInput[]> {
    const src = this.sourcesMap.get('src_cuelinks_network');
    const nowIso = new Date().toISOString();
    if (src) {
      src.lastAttemptAt = nowIso;
      if (src.nextRetryAt && Date.now() < new Date(src.nextRetryAt).getTime()) {
        return [];
      }
    }

    const client = this.getCuelinksClient();
    if (!client || !client.isConfigured()) {
      if (src) {
        src.lastHttpStatus = 401;
        src.lastError = 'CUELINKS_UNCONFIGURED: CUELINKS_API_KEY is unset';
        src.permissionStatus = 'CONDITIONAL';
      }
      return [];
    }

    const discoveredDeals: DiscoveredDealInput[] = [];

    try {
      // 1. Connection check
      const ping = await client.ping();
      if (!ping.connected) {
        if (src) {
          src.lastHttpStatus = 401;
          src.lastError = ping.message || 'Cuelinks authentication failed';
          src.failureCount++;
          src.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        }
        return [];
      }

      // 2. Channel inspection
      let channelId: number | string | undefined;
      try {
        const canonicalUrl = 'https://gen-lang-client-0916255372.web.app';
        const channels = await client.getChannels();
        let targetChannel = channels.find(c => c.url?.toLowerCase().includes('gen-lang-client') || c.url?.toLowerCase().includes('onrender.com'));
        if (!targetChannel) {
          targetChannel = await client.createChannel('AI Marketing Organization Deals & Buying Guides', canonicalUrl, 'website');
        }
        channelId = targetChannel?.id;
      } catch (chErr: any) {
        console.warn(`[DealEngine] Cuelinks channel notice: ${chErr.message}`);
      }

      // 3. Load Continuation Cursor
      const cursor = await this.getCuelinksPaginationCursor(organizationId);

      // 4. Discover Campaigns starting from cursor.campaignPage
      const campSearch = await client.searchCampaigns({
        country_id: 252,
        access_status: 'open',
        sort: 'epc_7d',
        order: 'desc',
        page: cursor.campaignPage,
        per_page: 30
      });

      const eligibleCampaigns = (campSearch.campaigns || []).filter(
        c => (!c.status || c.status === 'active') && (c.access_status === 'open' || c.access_status === 'approved')
      );

      // 5. Fetch 2 pages of offers across cursor.offerPage and cursor.offerPage + 1
      const pagesToFetch = [cursor.offerPage, cursor.offerPage + 1];
      const seenOfferUrls = new Set<string>();
      let reachedOfferEnd = false;

      for (const pageNum of pagesToFetch) {
        try {
          const offersRes = await client.getOffers({ page: pageNum, per_page: 30 });
          const rawOffers = offersRes.offers || [];

          if (rawOffers.length === 0 || rawOffers.length < 30 || (offersRes.total !== undefined && pageNum * 30 >= offersRes.total)) {
            reachedOfferEnd = true;
          }

          for (const offer of rawOffers) {
            const campaign = eligibleCampaigns.find(c => String(c.id) === String(offer.campaign_id));
            const merchantName = offer.campaign_name || campaign?.merchant_name || campaign?.name || 'Authorized Merchant';

            // Destination merchant URL: extract from tracking_url or use url (Finding 1)
            let merchantUrl = offer.url || '';
            if (!merchantUrl && offer.tracking_url) {
              try {
                const parsed = new URL(offer.tracking_url);
                const dec = parsed.searchParams.get('url') || parsed.searchParams.get('dest') || parsed.searchParams.get('redirect');
                if (dec && /^https?:\/\//i.test(dec)) {
                  merchantUrl = decodeURIComponent(dec);
                }
              } catch {}
            }
            if (!merchantUrl && campaign?.url && /^https?:\/\//i.test(campaign.url)) {
              merchantUrl = campaign.url;
            }

            if (!merchantUrl || !offer.title) continue;
            // Refuse to treat a Cuelinks tracking URL as a merchant destination or SKU evidence
            if (CuelinksV3Client.isAllowedTrackingUrl(merchantUrl)) continue;
            if (seenOfferUrls.has(merchantUrl)) continue;
            seenOfferUrls.add(merchantUrl);

            // SSRF validation on destination URL
            const ssrf = DealSsrfGuard.isSafePublicUrl(merchantUrl);
            if (!ssrf.safe) continue;

            // Honest price representation: provider discount_price or current_price_inr
            let currentPrice: number | undefined = undefined;
            if (typeof offer.discount_price === 'number' && offer.discount_price > 0) {
              currentPrice = offer.discount_price;
            } else if (typeof offer.discount_price === 'string' && !isNaN(Number(offer.discount_price)) && Number(offer.discount_price) > 0) {
              currentPrice = Number(offer.discount_price);
            } else if (typeof offer.current_price_inr === 'number' && offer.current_price_inr > 0) {
              currentPrice = offer.current_price_inr;
            }

            // Reference baseline price: provider original_price or reference_price_inr
            let refPrice: number | undefined = undefined;
            if (typeof offer.original_price === 'number' && offer.original_price > 0) {
              refPrice = offer.original_price;
            } else if (typeof offer.original_price === 'string' && !isNaN(Number(offer.original_price)) && Number(offer.original_price) > 0) {
              refPrice = Number(offer.original_price);
            } else if (typeof offer.reference_price_inr === 'number' && offer.reference_price_inr > 0) {
              refPrice = offer.reference_price_inr;
            }

            // Claimed discount
            let claimedDiscount: number | undefined = undefined;
            if (typeof offer.percent_off === 'number' && offer.percent_off > 0) {
              claimedDiscount = Math.round(offer.percent_off);
            } else if (typeof offer.percent_off === 'string' && !isNaN(Number(offer.percent_off)) && Number(offer.percent_off) > 0) {
              claimedDiscount = Math.round(Number(offer.percent_off));
            } else if (offer.discount) {
              const match = offer.discount.match(/(\d+)%/);
              if (match) claimedDiscount = Number(match[1]);
            }

            const cleanCouponCode = offer.coupon_code ? offer.coupon_code.trim() : undefined;
            const hasCouponOrTerms = Boolean(cleanCouponCode || offer.terms || offer.description || claimedDiscount || offer.offer_type === 'coupon');

            if (!currentPrice && !hasCouponOrTerms) {
              continue;
            }

            const isCouponDeal = !currentPrice || offer.offer_type === 'coupon' || Boolean(cleanCouponCode);

            // Category resolution
            let categoryName = 'eCommerce & Retail';
            if (Array.isArray(offer.categories) && offer.categories.length > 0) {
              const c0 = offer.categories[0];
              categoryName = typeof c0 === 'string' ? c0 : (c0?.name || 'eCommerce & Retail');
            } else if (offer.category) {
              categoryName = offer.category;
            }

            // Link conversion & monetization gate
            let trackingUrl: string | undefined = undefined;
            let isMonetizable = false;
            let affiliateCampaignId: string | undefined = undefined;

            if (offer.tracking_url && CuelinksV3Client.isAllowedTrackingUrl(offer.tracking_url)) {
              trackingUrl = offer.tracking_url;
              isMonetizable = true;
              affiliateCampaignId = String(offer.campaign_id);
            }

            try {
              const convRes = await client.convertLink({
                url: merchantUrl,
                channel_id: channelId,
                shorten: true,
                subid: `aro_cl_${offer.id}`,
                subid2: String(offer.campaign_id),
                subid3: 'cuelinks_feed'
              });

              if (convRes && convRes.affiliated === true && convRes.tracking_url && CuelinksV3Client.isAllowedTrackingUrl(convRes.tracking_url)) {
                trackingUrl = convRes.short_url || convRes.tracking_url;
                isMonetizable = true;
                if (convRes.campaign?.id) {
                  affiliateCampaignId = String(convRes.campaign.id);
                }
              }
            } catch {
              if (!isMonetizable) {
                trackingUrl = undefined;
              }
            }

            discoveredDeals.push({
              title: offer.title.trim(),
              brand: merchantName,
              merchant: merchantName,
              category: categoryName,
              productUrl: merchantUrl,
              dealKind: isCouponDeal ? 'COUPON' : 'PRODUCT',
              currentPriceINR: currentPrice,
              referencePriceINR: refPrice,
              claimedDiscountPercent: claimedDiscount,
              couponCode: cleanCouponCode,
              couponConditions: offer.terms?.trim() || offer.description?.trim() || undefined,
              availability: 'IN_STOCK',
              geographicRestrictions: ['India'],
              offerStart: offer.start_date || undefined,
              expiryDate: offer.end_date || undefined,
              observedAt: nowIso,
              sourceUrl: merchantUrl,
              sourceDomain: 'cuelinks.com',
              sourceType: 'AFFILIATE_NETWORK',
              trackingUrl,
              isMonetizable,
              affiliateNetwork: isMonetizable ? 'CUELINKS' : undefined,
              affiliateCampaignId,
              modelOrSku: `CL-${offer.id}`
            });
          }

          if (reachedOfferEnd) break;
        } catch (offerErr: any) {
          console.warn(`[DealEngine] Notice on Cuelinks offer page ${pageNum}: ${offerErr.message}`);
          break;
        }
      }

      // 6. Advance continuation cursor across cycles (wrap around when end reached)
      const isCampEnd = (campSearch.campaigns?.length || 0) < 30 || ((campSearch.total !== undefined) && cursor.campaignPage * 30 >= campSearch.total);
      const nextCampPage = isCampEnd ? 1 : cursor.campaignPage + 1;
      const nextOfferPage = reachedOfferEnd ? 1 : cursor.offerPage + pagesToFetch.length;

      await this.saveCuelinksPaginationCursor({
        campaignPage: nextCampPage,
        offerPage: nextOfferPage,
        lastUpdated: new Date().toISOString()
      }, organizationId, businessId);

      // 7. Update Source Registry operational metrics
      if (src) {
        src.lastScanAt = nowIso;
        src.lastSuccessAt = nowIso;
        src.lastHttpStatus = 200;
        src.lastError = undefined;
        src.failureCount = 0;
        src.offersCollected = (src.offersCollected || 0) + discoveredDeals.length;
        src.totalOffersFound += discoveredDeals.length;
        src.permissionStatus = 'ALLOWED';
      }

      // 8. Synchronize Cuelinks reconciliation telemetry if available
      try {
        const syncMgr = CuelinksSyncManager.getInstance(client);
        const reportsRes = await client.getReports({ start_date: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] });
        const providerClicks = (reportsRes.reports || []).reduce((acc: number, r: any) => acc + (r.clicks || 0), 0);
        const txRes = await client.getTransactions({ page: 1, per_page: 50 });
        const txList = txRes.transactions || [];
        let pendingINR = 0;
        let validatedINR = 0;
        let paidINR = 0;
        let reversedINR = 0;
        for (const tx of txList) {
          const amt = Number(tx.user_commission ?? tx.commission_amount) || 0;
          if (tx.status === 'approved' || tx.status === 'validated' || tx.status === 'payable') validatedINR += amt;
          else if (tx.status === 'pending') pendingINR += amt;
          else if (tx.status === 'paid' || tx.status === 'invoice_raised') paidINR += amt;
          else if (tx.status === 'rejected') reversedINR += amt;
        }
        syncMgr.setReconciliationMetrics({
          providerAttributedClicks: providerClicks,
          reportedConversions: txList.length,
          pendingCommissionINR: pendingINR,
          validatedCommissionINR: validatedINR,
          paidCommissionINR: paidINR,
          reversedCommissionINR: reversedINR
        });
      } catch {}

      return discoveredDeals;
    } catch (err: any) {
      // Isolate failure!
      if (src) {
        src.lastHttpStatus = err.status || 500;
        src.lastError = err.message || 'Cuelinks adapter execution failed';
        src.failureCount++;
        src.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      return [];
    }
  }

  /**
   * Adapter 2: Public Deal Feed RSS/Atom adapter (e.g. DesiDime RSS feed).
   * Rate limited, SSRF protected, parses RSS items with safe regex/string methods.
   * Isolates source failures (404, network error, timeout) without throwing.
   */
  public async runRssDealFeedAdapter(sourceId = 'src_desidime_public'): Promise<DiscoveredDealInput[]> {
    const src = this.sourcesMap.get(sourceId);
    const nowIso = new Date().toISOString();
    if (src) {
      src.lastAttemptAt = nowIso;
      if (src.nextRetryAt && Date.now() < new Date(src.nextRetryAt).getTime()) {
        return [];
      }
    }

    const feedUrl = src?.documentationUrl || 'https://www.desidime.com/deals.rss';
    const ssrf = DealSsrfGuard.isSafePublicUrl(feedUrl);
    if (!ssrf.safe) {
      if (src) {
        src.lastHttpStatus = 403;
        src.lastError = `SSRF_BLOCKED: ${ssrf.reason}`;
        src.failureCount++;
        src.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      return [];
    }

    try {
      const res = await this.fetchFn(feedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
        },
        signal: AbortSignal.timeout(3000)
      });

      if (!res.ok) {
        if (src) {
          src.lastHttpStatus = res.status;
          src.lastError = `HTTP_${res.status}: Failed to fetch feed`;
          src.failureCount++;
          src.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        }
        return [];
      }

      const xmlText = await res.text();
      const deals = this.parseRssFeedXml(xmlText, feedUrl, src?.domain || 'desidime.com');

      if (src) {
        src.lastScanAt = nowIso;
        src.lastSuccessAt = nowIso;
        src.lastHttpStatus = 200;
        src.lastError = undefined;
        src.failureCount = 0;
        src.offersCollected = (src.offersCollected || 0) + deals.length;
        src.totalOffersFound += deals.length;
      }

      return deals;
    } catch (err: any) {
      // Isolate failure!
      if (src) {
        src.lastHttpStatus = err.status || 0;
        src.lastError = err.message || 'RSS feed network failure';
        src.failureCount++;
        src.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      return [];
    }
  }

  /**
   * Helper to parse RSS/Atom XML text into DiscoveredDealInput array.
   */
  public parseRssFeedXml(xmlText: string, sourceUrl: string, sourceDomain: string): DiscoveredDealInput[] {
    const deals: DiscoveredDealInput[] = [];
    if (!xmlText || typeof xmlText !== 'string') return deals;

    const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const itemBlock = match[1];

      // Extract title
      const titleMatch = itemBlock.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (!rawTitle) continue;

      // Extract link
      let link = '';
      const linkMatch = itemBlock.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      if (linkMatch && linkMatch[1].trim().startsWith('http')) {
        link = linkMatch[1].trim();
      } else {
        const hrefMatch = itemBlock.match(/<link[^>]+href=["']([^"']+)["']/i);
        if (hrefMatch) link = hrefMatch[1].trim();
      }
      if (!link) continue;

      // SSRF validation
      const ssrf = DealSsrfGuard.isSafePublicUrl(link);
      if (!ssrf.safe) continue;

      // Extract description
      const descMatch = itemBlock.match(/<(?:description|summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary|content)>/i);
      const rawDesc = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

      // Un-escape XML entities
      const title = this.unescapeXml(rawTitle);
      const desc = this.unescapeXml(rawDesc);
      const combined = `${title} ${desc}`;

      // Extract coupon code
      let couponCode: string | undefined = undefined;
      const codeRegex = /(?:use\s+(?:coupon\s+|promo\s+)?code|use\s+(?:coupon|promo)|coupon\s+code|promo\s+code|discount\s+code|code|coupon|promo)\s*[:\-]?\s*([A-Z0-9_-]{3,20})\b/gi;
      let m: RegExpExecArray | null;
      while ((m = codeRegex.exec(combined)) !== null) {
        const candidate = m[1].trim().toUpperCase();
        if (!['THE', 'FOR', 'AND', 'WITH', 'OFF', 'GET', 'BUY', 'NEW', 'CODE', 'COUPON', 'DEAL', 'FREE'].includes(candidate)) {
          couponCode = candidate;
          break;
        }
      }

      // Extract MRP / reference price
      let referencePrice: number | undefined = undefined;
      const mrpMatch = combined.match(/(?:MRP|List Price|Original|Regular Price)\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*([\d,]+)/i);
      if (mrpMatch) {
        const parsedMrp = parseInt(mrpMatch[1].replace(/,/g, ''), 10);
        if (!isNaN(parsedMrp) && parsedMrp > 0) referencePrice = parsedMrp;
      }

      // Extract price (INR / Rs / ₹), ignoring discount caps like "up to Rs 100" or "save Rs 50"
      let price: number | undefined = undefined;
      const textWithoutDiscountCaps = combined
        .replace(/(?:up\s*to|upto|save|flat|max(?:imum)?|cashback|discount\s+(?:of\s+)?)\s*(?:₹|Rs\.?|INR)?\s*[\d,]+/gi, '')
        .replace(/(?:MRP|List Price|Original|Regular Price)\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*[\d,]+/gi, '');

      const priceMatch = textWithoutDiscountCaps.match(/(?:at|for|price|buy(?:\s+now)?\s+at)\s*(?:₹|Rs\.?|INR)?\s*([\d,]+)/i) ||
                         textWithoutDiscountCaps.match(/(?:₹|Rs\.?|INR)\s*([\d,]+)/i);
      if (priceMatch) {
        const parsed = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        if (!isNaN(parsed) && parsed > 0) price = parsed;
      }

      // Extract coupon conditions
      let couponConditions: string | undefined = undefined;
      if (desc.toLowerCase().includes('off') || desc.toLowerCase().includes('discount') || desc.toLowerCase().includes('coupon')) {
        couponConditions = desc.length > 200 ? desc.substring(0, 197) + '...' : desc;
      }

      const hasPrice = typeof price === 'number' && price > 0;
      const hasCoupon = Boolean(couponCode || couponConditions);

      if (!hasPrice && !hasCoupon) continue;

      const isCouponDeal = !hasPrice && hasCoupon;

      // Extract Merchant / Brand
      let merchant = 'Community Merchant';
      let brand = 'Generic';
      try {
        const u = new URL(link);
        const hostParts = u.hostname.replace(/^www\./, '').split('.');
        if (hostParts.length >= 2) {
          const mainPart = hostParts[0];
          merchant = mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
          brand = merchant;
        }
      } catch {}

      deals.push({
        title,
        brand,
        merchant,
        category: 'eCommerce & Deals',
        productUrl: link,
        dealKind: isCouponDeal ? 'COUPON' : 'PRODUCT',
        currentPriceINR: hasPrice ? price : undefined,
        referencePriceINR: referencePrice,
        couponCode,
        couponConditions,
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        observedAt: new Date().toISOString(),
        sourceUrl: link,
        sourceDomain,
        sourceType: 'PUBLIC_DEAL_FEED'
      });
    }

    return deals;
  }

  /**
   * Adapter 3: Public Schema.org JSON-LD structured data parser.
   * Extracts Schema.org Product, Offer, and AggregateOffer markup.
   */
  public async runSchemaOrgAdapter(
    sourceId = 'src_schema_org_offers',
    targetUrl?: string
  ): Promise<DiscoveredDealInput[]> {
    const src = this.sourcesMap.get(sourceId);
    const nowIso = new Date().toISOString();
    if (src) {
      src.lastAttemptAt = nowIso;
      if (src.nextRetryAt && Date.now() < new Date(src.nextRetryAt).getTime()) {
        return [];
      }
    }

    const url = targetUrl || src?.documentationUrl || 'https://schema.org/Offer';
    const ssrf = DealSsrfGuard.isSafePublicUrl(url);
    if (!ssrf.safe) {
      if (src) {
        src.lastHttpStatus = 403;
        src.lastError = `SSRF_BLOCKED: ${ssrf.reason}`;
        src.failureCount++;
        src.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      return [];
    }

    try {
      const res = await this.fetchFn(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html, application/ld+json, */*'
        },
        signal: AbortSignal.timeout(3000)
      });

      if (!res.ok) {
        if (src) {
          src.lastHttpStatus = res.status;
          src.lastError = `HTTP_${res.status}: Failed to fetch Schema.org page`;
          src.failureCount++;
          src.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        }
        return [];
      }

      const html = await res.text();
      const deals = this.parseSchemaOrgJsonLd(html, url, src?.domain || 'schema.org');

      if (src) {
        src.lastScanAt = nowIso;
        src.lastSuccessAt = nowIso;
        src.lastHttpStatus = 200;
        src.lastError = undefined;
        src.failureCount = 0;
        src.offersCollected = (src.offersCollected || 0) + deals.length;
        src.totalOffersFound += deals.length;
      }

      return deals;
    } catch (err: any) {
      if (src) {
        src.lastHttpStatus = err.status || 0;
        src.lastError = err.message || 'Schema.org fetch failed';
        src.failureCount++;
        src.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      return [];
    }
  }

  /**
   * Safe Schema.org JSON-LD parser.
   * Walks HTML script tags or raw JSON to extract structured Product and Offer representations.
   */
  public parseSchemaOrgJsonLd(jsonOrHtml: string, sourceUrl: string, sourceDomain: string): DiscoveredDealInput[] {
    const deals: DiscoveredDealInput[] = [];
    if (!jsonOrHtml || typeof jsonOrHtml !== 'string') return deals;

    const jsonBlocks: string[] = [];

    const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    let foundScript = false;

    while ((match = scriptRegex.exec(jsonOrHtml)) !== null) {
      foundScript = true;
      if (match[1].trim()) jsonBlocks.push(match[1].trim());
    }

    if (!foundScript && (jsonOrHtml.trim().startsWith('{') || jsonOrHtml.trim().startsWith('['))) {
      jsonBlocks.push(jsonOrHtml.trim());
    }

    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block);
        const entities = this.collectSchemaEntities(parsed);

        for (const ent of entities) {
          const deal = this.convertSchemaEntityToDeal(ent, sourceUrl, sourceDomain);
          if (deal) deals.push(deal);
        }
      } catch {
        // Silently tolerate invalid JSON blocks
      }
    }

    return deals;
  }

  private collectSchemaEntities(node: any): any[] {
    if (!node) return [];
    if (Array.isArray(node)) {
      return node.flatMap(item => this.collectSchemaEntities(item));
    }
    if (typeof node === 'object') {
      const results: any[] = [];
      const type = node['@type'];
      const isProductOrOffer =
        type === 'Product' ||
        type === 'Offer' ||
        type === 'AggregateOffer' ||
        (Array.isArray(type) && (type.includes('Product') || type.includes('Offer') || type.includes('AggregateOffer')));

      if (isProductOrOffer) {
        results.push(node);
      }

      if (node['@graph'] && Array.isArray(node['@graph'])) {
        results.push(...this.collectSchemaEntities(node['@graph']));
      }

      return results;
    }
    return [];
  }

  private convertSchemaEntityToDeal(entity: any, sourceUrl: string, sourceDomain: string): DiscoveredDealInput | null {
    try {
      const isProduct = entity['@type'] === 'Product' || (Array.isArray(entity['@type']) && entity['@type'].includes('Product'));
      const title = (entity.name || entity.title || '').trim();
      if (!title) return null;

      let brand = 'Generic';
      if (typeof entity.brand === 'string') brand = entity.brand.trim();
      else if (entity.brand && typeof entity.brand.name === 'string') brand = entity.brand.name.trim();

      let offers = entity.offers;
      if (offers && !Array.isArray(offers)) offers = [offers];
      const primaryOffer = (Array.isArray(offers) && offers.length > 0) ? offers[0] : (isProduct ? undefined : entity);

      let price: number | undefined = undefined;
      let refPrice: number | undefined = undefined;
      let productUrl = sourceUrl;
      let availability: DealAvailability = 'IN_STOCK';
      let expiryDate: string | undefined = undefined;

      if (primaryOffer) {
        if (primaryOffer.price !== undefined && primaryOffer.price !== null) {
          const p = typeof primaryOffer.price === 'number' ? primaryOffer.price : parseFloat(String(primaryOffer.price).replace(/[^0-9.]/g, ''));
          if (!isNaN(p) && p > 0) price = p;
        } else if (primaryOffer.lowPrice !== undefined) {
          const p = typeof primaryOffer.lowPrice === 'number' ? primaryOffer.lowPrice : parseFloat(String(primaryOffer.lowPrice).replace(/[^0-9.]/g, ''));
          if (!isNaN(p) && p > 0) price = p;
        }

        if (primaryOffer.highPrice !== undefined) {
          const hp = typeof primaryOffer.highPrice === 'number' ? primaryOffer.highPrice : parseFloat(String(primaryOffer.highPrice).replace(/[^0-9.]/g, ''));
          if (!isNaN(hp) && hp > (price || 0)) refPrice = hp;
        }

        if (primaryOffer.url && typeof primaryOffer.url === 'string' && primaryOffer.url.startsWith('http')) {
          productUrl = primaryOffer.url;
        } else if (entity.url && typeof entity.url === 'string' && entity.url.startsWith('http')) {
          productUrl = entity.url;
        }

        if (primaryOffer.availability && typeof primaryOffer.availability === 'string') {
          if (primaryOffer.availability.includes('OutOfStock')) availability = 'OUT_OF_STOCK';
          else if (primaryOffer.availability.includes('LimitedAvailability')) availability = 'LIMITED_STOCK';
        }

        if (primaryOffer.priceValidUntil && typeof primaryOffer.priceValidUntil === 'string') {
          expiryDate = primaryOffer.priceValidUntil;
        }
      }

      // SSRF check
      const ssrf = DealSsrfGuard.isSafePublicUrl(productUrl);
      if (!ssrf.safe) return null;

      const hasPrice = typeof price === 'number' && price > 0;
      let couponCode: string | undefined = undefined;
      let couponConditions: string | undefined = undefined;

      const desc = (entity.description || primaryOffer?.description || '').trim();
      if (desc) {
        const codeMatch = desc.match(/(?:coupon|code|promo)\s*[:\-]?\s*([A-Z0-9_-]{3,20})\b/i);
        if (codeMatch) couponCode = codeMatch[1].toUpperCase();
        if (desc.toLowerCase().includes('coupon') || desc.toLowerCase().includes('off')) {
          couponConditions = desc.length > 200 ? desc.substring(0, 197) + '...' : desc;
        }
      }

      const hasCoupon = Boolean(couponCode || couponConditions);
      if (!hasPrice && !hasCoupon) return null;

      const isCouponDeal = !hasPrice && hasCoupon;

      let merchant = brand;
      try {
        const u = new URL(productUrl);
        const hostParts = u.hostname.replace(/^www\./, '').split('.');
        if (hostParts.length >= 2) {
          const mainPart = hostParts[0];
          merchant = mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
        }
      } catch {}

      return {
        title,
        brand,
        merchant,
        category: entity.category || 'Electronics & Peripherals',
        productUrl,
        dealKind: isCouponDeal ? 'COUPON' : 'PRODUCT',
        currentPriceINR: hasPrice ? price : undefined,
        referencePriceINR: refPrice,
        couponCode,
        couponConditions,
        availability,
        expiryDate,
        observedAt: new Date().toISOString(),
        sourceUrl: productUrl,
        sourceDomain,
        sourceType: 'FREE_TECHNICAL_DISCOVERY',
        modelOrSku: entity.sku || entity.mpn || undefined
      };
    } catch {
      return null;
    }
  }

  private unescapeXml(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  }

  /**
   * Enriches candidate deals with Cuelinks affiliate tracking when authenticated (Spec § 5 & § 8).
   * Seamlessly converts eligible candidate deals through Cuelinks V3 API.
   * - If affiliated === true: attaches verified trackingUrl, affiliateNetwork='CUELINKS', affiliateCampaignId, and isMonetizable=true.
   * - If affiliated === false (e.g. Reliance Digital, Zoho): preserves direct merchant link, isMonetizable=false, trackingUrl=undefined.
   * - If Cuelinks is unconfigured or fails: preserves direct merchant links safely without downtime.
   */
  public async enrichCandidateDealsWithCuelinks(deals: DiscoveredDealInput[]): Promise<DiscoveredDealInput[]> {
    const client = this.getCuelinksClient();
    if (!client || !client.isConfigured()) {
      for (const deal of deals) {
        if (deal.isMonetizable === undefined) {
          deal.isMonetizable = false;
        }
      }
      return deals;
    }

    const channelId = CuelinksSyncManager.getInstance(client).getStatus().channel.id;

    for (const deal of deals) {
      // Only convert if not already monetized/tracked and has a public product URL
      if (!deal.trackingUrl && deal.productUrl) {
        try {
          const subid = `aro_${deal.modelOrSku || 'deal'}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
          const subid2 = (deal.category || 'general').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

          const convRes = await client.convertLink({
            url: deal.productUrl,
            channel_id: channelId,
            subid,
            subid2,
            subid3: 'discovery_engine',
            shorten: true
          });

          if (convRes && convRes.affiliated === true && convRes.tracking_url) {
            deal.trackingUrl = convRes.tracking_url;
            deal.isMonetizable = true;
            deal.affiliateNetwork = 'CUELINKS';
            if (convRes.campaign?.id) {
              deal.affiliateCampaignId = String(convRes.campaign.id);
            }
          } else {
            // Non-affiliated merchant (Reliance Digital, Zoho, unapproved partners):
            // Strictly preserve clean direct merchant link, no affiliate tracking
            deal.isMonetizable = false;
            deal.trackingUrl = undefined;
            deal.affiliateNetwork = undefined;
            deal.affiliateCampaignId = undefined;
          }
        } catch (convErr: any) {
          // Graceful fallback to pure direct merchant link on error
          deal.isMonetizable = false;
          deal.trackingUrl = undefined;
          deal.affiliateNetwork = undefined;
          deal.affiliateCampaignId = undefined;
        }
      }
    }

    return deals;
  }

  /**
   * Ingests, cross-checks, verifies, and deduplicates a candidate deal (Spec § 5 & § 6).
   */
  public async ingestAndVerifyDeal(
    input: DiscoveredDealInput,
    organizationId: string = 'org_owner_primary',
    businessId: string = 'biz_platform_aro'
  ): Promise<{
    action: 'CREATED_VERIFIED' | 'UPDATED_VERIFIED' | 'REJECTED' | 'DEDUPLICATED';
    deal?: NormalizedDeal;
    rejectionReason?: string;
  }> {
    // Level 1: Source & URL SSRF Validation (Spec § 5 Level 1)
    const ssrfCheck = DealSsrfGuard.isSafePublicUrl(input.productUrl);
    if (!ssrfCheck.safe) {
      console.warn(`[DealEngine] Deal '${input.title}' rejected by SSRF gate: ${ssrfCheck.reason}`);
      this.recordRejection(input.sourceDomain, ssrfCheck.reason || 'SSRF violation');
      return { action: 'REJECTED', rejectionReason: ssrfCheck.reason };
    }

    // Level 2: Merchant & Pricing Sanity Validation (Spec § 5 Level 2)
    const isCouponDeal = input.dealKind === 'COUPON' || (!input.currentPriceINR && Boolean(input.couponCode));
    if (!isCouponDeal) {
      if (typeof input.currentPriceINR !== 'number' || isNaN(input.currentPriceINR) || input.currentPriceINR <= 0) {
        const reason = `INVALID_PRICE: Current price must be a positive number in INR (received: ${input.currentPriceINR})`;
        this.recordRejection(input.sourceDomain, reason);
        return { action: 'REJECTED', rejectionReason: reason };
      }
    } else {
      if (!input.couponCode && !input.couponConditions) {
        const reason = `INVALID_COUPON: Coupon deals must have a coupon code or conditions specified`;
        this.recordRejection(input.sourceDomain, reason);
        return { action: 'REJECTED', rejectionReason: reason };
      }
    }

    const canonicalUrl = DealSsrfGuard.normalizeProductUrl(input.productUrl);

    // Seamlessly convert eligible candidate deal through Cuelinks when authenticated if not yet processed
    if (input.trackingUrl === undefined && input.isMonetizable === undefined && this.getCuelinksClient().isConfigured()) {
      try {
        const client = this.getCuelinksClient();
        const channelId = CuelinksSyncManager.getInstance(client).getStatus().channel.id;
        const subid = `aro_${input.modelOrSku || 'deal'}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        const subid2 = (input.category || 'general').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

        const convRes = await client.convertLink({
          url: input.productUrl,
          channel_id: channelId,
          subid,
          subid2,
          subid3: 'ingest_verify',
          shorten: true
        });

        if (convRes && convRes.affiliated === true && convRes.tracking_url) {
          input.trackingUrl = convRes.tracking_url;
          input.isMonetizable = true;
          input.affiliateNetwork = 'CUELINKS';
          if (convRes.campaign?.id) {
            input.affiliateCampaignId = String(convRes.campaign.id);
          }
        } else {
          input.isMonetizable = false;
          input.trackingUrl = undefined;
          input.affiliateNetwork = undefined;
          input.affiliateCampaignId = undefined;
        }
      } catch {
        input.isMonetizable = false;
        input.trackingUrl = undefined;
        input.affiliateNetwork = undefined;
        input.affiliateCampaignId = undefined;
      }
    }

    // Level 3: Corroboration & Discount Checking (Spec § 5 Level 3)
    let discountType: DiscountVerificationType = 'UNCONFIRMED';
    let verifiedDiscount = 0;
    const refPrice = input.referencePriceINR;

    if (refPrice && refPrice > 0 && typeof input.currentPriceINR === 'number') {
      if (input.currentPriceINR >= refPrice) {
        // Current price >= Reference price: Fake or inverted discount claim
        verifiedDiscount = 0;
        discountType = 'UNCONFIRMED';
      } else {
        const calculatedDiscount = Math.round(((refPrice - input.currentPriceINR) / refPrice) * 100);
        verifiedDiscount = calculatedDiscount;
        // Invariant: Mark reference price as MERCHANT_CLAIMED unless multi-source independent evidence corroborates it
        discountType = 'MERCHANT_CLAIMED';
      }
    } else {
      discountType = input.discountVerificationType || (isCouponDeal ? 'MERCHANT_CLAIMED' : 'UNCONFIRMED');
      verifiedDiscount = 0;
    }

    // Level 4: Validity & Eligibility Checking (Spec § 5 Level 4)
    let verificationStatus: DealVerificationStatus = 'VERIFIED';
    const rejectionReasons: string[] = [];

    // Check Expiry (genuine provider expiry data)
    if (input.expiryDate) {
      const expiryMs = new Date(input.expiryDate).getTime();
      if (!isNaN(expiryMs) && Date.now() > expiryMs) {
        verificationStatus = 'EXPIRED';
        rejectionReasons.push('OFFER_EXPIRED: The promotional deal has expired.');
      }
    }

    // Freshness policy check (MAX_OFFER_FRESHNESS_HOURS = 48h since last observation)
    if (input.observedAt) {
      const observedMs = new Date(input.observedAt).getTime();
      if (!isNaN(observedMs) && (Date.now() - observedMs) > MAX_OFFER_FRESHNESS_HOURS * 3600 * 1000) {
        verificationStatus = 'EXPIRED';
        rejectionReasons.push(`OFFER_STALE: Observation exceeded freshness policy (${MAX_OFFER_FRESHNESS_HOURS} hours).`);
      }
    }

    // Check Stock
    if (input.availability === 'OUT_OF_STOCK') {
      verificationStatus = 'OUT_OF_STOCK';
      rejectionReasons.push('OUT_OF_STOCK: Merchant reports product is out of stock.');
    }

    // Check unverified key claims (e.g. asserted discount failed baseline reference price corroboration)
    if (!isCouponDeal && input.claimedDiscountPercent && input.claimedDiscountPercent > 0 && discountType === 'UNCONFIRMED') {
      verificationStatus = 'UNVERIFIED';
      rejectionReasons.push('UNVERIFIED_DISCOUNT: Claimed discount failed baseline reference price corroboration.');
    }

    // Check Coupon / Conditional status
    if (isCouponDeal || input.couponCode || input.couponConditions || input.paymentRestrictions) {
      if (verificationStatus === 'VERIFIED') {
        verificationStatus = 'VERIFIED_WITH_CONDITIONS';
      }
    }

    // Level 5: Deterministic Deduplication Pipeline (Spec § 6)
    const normalizedBrand = (input.brand || 'Generic').trim().toLowerCase();
    const normalizedMerchant = (input.merchant || 'Unknown').trim().toLowerCase();
    const coreTitleTokens = input.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join('-');

    const fingerprint = isCouponDeal
      ? `coupon:${normalizedMerchant}:${normalizedBrand}:${coreTitleTokens}:${input.couponCode || input.modelOrSku || 'default'}`
      : `${normalizedMerchant}:${normalizedBrand}:${coreTitleTokens}:${input.modelOrSku || 'default'}`;

    const existingDealId = this.dealFingerprintMap.get(fingerprint);
    const nowIso = new Date().toISOString();

    if (existingDealId && this.dealsMap.has(existingDealId)) {
      // Existing deal match: Merge evidence, update timestamps, avoid duplicate deal creation
      const existing = this.dealsMap.get(existingDealId)!;
      existing.dealKind = existing.dealKind || (isCouponDeal ? 'COUPON' : (input.dealKind || 'PRODUCT'));
      existing.couponCode = input.couponCode || existing.couponCode;
      existing.couponConditions = input.couponConditions || existing.couponConditions;
      existing.discountBadge = input.discountBadge || existing.discountBadge;
      existing.lastCheckedAt = nowIso;
      existing.currentPriceINR = input.currentPriceINR;
      existing.referencePriceINR = input.referencePriceINR || existing.referencePriceINR;
      existing.verifiedDiscountPercent = verifiedDiscount || existing.verifiedDiscountPercent;

      if (!existing.evidenceJson.sources.includes(input.sourceUrl)) {
        existing.evidenceJson.sources.push(input.sourceUrl);
      }

      if (typeof input.currentPriceINR === 'number' && input.currentPriceINR > 0) {
        if (!existing.evidenceJson.priceHistory) {
          existing.evidenceJson.priceHistory = [];
        }
        existing.evidenceJson.priceHistory.push({
          price: input.currentPriceINR,
          observedAt: input.observedAt || nowIso
        });
      }

      // Maintain higher verification confidence upon multi-source corroboration
      if (existing.evidenceJson.sources.length > 1) {
        existing.discountVerificationType = 'INDEPENDENT_CORROBORATED';
        existing.confidenceScore = Math.min(100, existing.confidenceScore + 10);
      }

      if (input.isMonetizable && input.trackingUrl && !existing.isMonetizable) {
        existing.trackingUrl = input.trackingUrl;
        existing.affiliateNetwork = input.affiliateNetwork;
        existing.affiliateCampaignId = input.affiliateCampaignId;
        existing.isMonetizable = true;
      }

      existing.updatedAt = nowIso;
      await this.persistDealToD1(existing, organizationId, businessId);

      return { action: 'DEDUPLICATED', deal: existing };
    }

    // New Deal Formulation
    const dealId = `deal_${randomUUID().substring(0, 10)}`;
    const confidenceScore = (discountType as DiscountVerificationType) === 'INDEPENDENT_CORROBORATED' ? 95 : (discountType === 'MERCHANT_CLAIMED' ? 85 : 70);
    const observedAt = input.observedAt || nowIso;

    const newDeal: NormalizedDeal = {
      id: dealId,
      dealKind: isCouponDeal ? 'COUPON' : (input.dealKind || 'PRODUCT'),
      discountBadge: input.discountBadge,
      title: input.title.trim(),
      brand: input.brand.trim(),
      merchant: input.merchant.trim(),
      category: input.category.trim(),
      productUrl: canonicalUrl,
      currentPriceINR: input.currentPriceINR,
      currency: 'INR',
      referencePriceINR: input.referencePriceINR,
      claimedDiscountPercent: input.claimedDiscountPercent,
      verifiedDiscountPercent: verifiedDiscount,
      discountVerificationType: discountType,
      couponCode: input.couponCode?.trim(),
      couponConditions: input.couponConditions?.trim(),
      availability: input.availability || 'IN_STOCK',
      geographicRestrictions: input.geographicRestrictions || ['India'],
      membershipRestrictions: input.membershipRestrictions,
      paymentRestrictions: input.paymentRestrictions,
      offerStart: input.offerStart,
      expiryDate: input.expiryDate, // Genuine provider expiry only; never inferred from execution timestamp
      observedAt,
      lastCheckedAt: nowIso,
      sourceUrl: input.sourceUrl, // Preserves original source URL
      sourceDomain: input.sourceDomain,
      sourceType: input.sourceType,
      verificationStatus,
      confidenceScore,
      buyerValueScore: 0, // Will be computed in ranking
      rejectionReasons,
      trackingUrl: (input.isMonetizable === true && Boolean(input.trackingUrl)) ? input.trackingUrl : undefined,
      affiliateNetwork: (input.isMonetizable === true && Boolean(input.trackingUrl)) ? input.affiliateNetwork : undefined,
      affiliateCampaignId: (input.isMonetizable === true && Boolean(input.trackingUrl)) ? input.affiliateCampaignId : undefined,
      isMonetizable: input.isMonetizable === true && Boolean(input.trackingUrl),
      modelOrSku: input.modelOrSku,
      evidenceJson: {
        sources: [input.sourceUrl],
        observedAt,
        priceHistory: (typeof input.currentPriceINR === 'number' && input.currentPriceINR > 0) ? [{ price: input.currentPriceINR, observedAt }] : [],
        verificationLogs: [
          `Discovered from ${input.sourceDomain} at ${observedAt}`,
          `SSRF & Host safety check: PASSED`,
          isCouponDeal
            ? `Coupon validation: promo code "${input.couponCode || 'ACTIVE'}" validated on ${input.merchant}`
            : `Pricing sanity check: INR ${input.currentPriceINR} PASSED`,
          `Discount validation: ${discountType} (${verifiedDiscount}%)`
        ],
        rawSpecs: input.rawSpecs
      },
      createdAt: nowIso,
      updatedAt: nowIso
    };

    // Calculate initial Buyer Value score
    newDeal.buyerValueScore = this.calculateBuyerValueScore(newDeal);

    // Register in-memory maps
    this.dealsMap.set(dealId, newDeal);
    this.dealFingerprintMap.set(fingerprint, dealId);

    // Persist durably in D1 workflows table
    await this.persistDealToD1(newDeal, organizationId, businessId);

    return { action: 'CREATED_VERIFIED', deal: newDeal };
  }

  /**
   * Buyer-Value Ranking Engine (Spec § 7).
   * Ranks deals based on buyer value without letting affiliate commission override evidence quality.
   */
  public calculateBuyerValueScore(deal: NormalizedDeal): number {
    // If deal is expired, rejected, or unverified, score is 0
    if (
      deal.verificationStatus === 'EXPIRED' ||
      deal.verificationStatus === 'REJECTED' ||
      deal.verificationStatus === 'UNVERIFIED'
    ) {
      return 0;
    }

    // Factor 1: Verification Confidence (30% weight)
    const confidencePart = (deal.confidenceScore / 100) * 30;

    // Factor 2: Savings Evidence & Verified Discount (30% weight)
    // Verified discount contributes up to 30 points (e.g. 50% verified discount = 25 points)
    let savingsPart = 0;
    if (deal.verifiedDiscountPercent && deal.verifiedDiscountPercent > 0) {
      savingsPart = Math.min(30, (deal.verifiedDiscountPercent / 70) * 30);
    } else if (deal.claimedDiscountPercent && deal.claimedDiscountPercent > 0) {
      // Claimed unverified discount receives maximum 10 points
      savingsPart = Math.min(10, (deal.claimedDiscountPercent / 70) * 10);
    } else if (deal.dealKind === 'COUPON' && (deal.couponCode || deal.couponConditions)) {
      savingsPart = 15;
    }

    // Factor 3: Freshness (20% weight)
    const observationTime = deal.observedAt || deal.lastCheckedAt;
    const hoursOld = (Date.now() - new Date(observationTime).getTime()) / (1000 * 60 * 60);
    const freshnessPart = Math.max(0, 20 - hoursOld * 0.5); // Degrades by 0.5 pts per hour

    // Factor 4: Stock & Usability (10% weight)
    let stockPart = 10;
    if (deal.availability === 'LIMITED_STOCK') stockPart = 7;
    if (deal.availability === 'OUT_OF_STOCK') stockPart = 0;

    // Factor 5: Merchant Trust (10% weight)
    const src = Array.from(this.sourcesMap.values()).find(s => s.domain === deal.sourceDomain);
    const merchantTrust = src?.trustScore || 80;
    const trustPart = (merchantTrust / 100) * 10;

    // Notice: Affiliate commission does NOT inflate rank (Spec § 7 Invariant)
    const totalScore = Math.round(confidencePart + savingsPart + freshnessPart + stockPart + trustPart);
    return Math.min(100, Math.max(0, totalScore));
  }

  /**
   * Re-ranks all active deals by buyer value score.
   */
  public reRankActiveDeals(): void {
    for (const deal of this.dealsMap.values()) {
      deal.buyerValueScore = this.calculateBuyerValueScore(deal);
    }
  }

  /**
   * Deactivates and flags expired deals (Spec § 5 Level 4).
   * Enforces genuine provider expiry data (expiryDate < now) or freshness policy
   * (MAX_OFFER_FRESHNESS_HOURS = 48 hours since last observation), never invented dates.
   */
  public async deactivateExpiredDeals(
    organizationId: string = 'org_owner_primary',
    businessId: string = 'biz_platform_aro'
  ): Promise<number> {
    let expiredCount = 0;
    const now = Date.now();
    const maxFreshnessMs = MAX_OFFER_FRESHNESS_HOURS * 60 * 60 * 1000;

    for (const deal of this.dealsMap.values()) {
      if (deal.verificationStatus === 'EXPIRED') continue;

      let isExpired = false;
      let reason = '';

      // Genuine provider expiry data check (never invented dates)
      if (deal.expiryDate) {
        const expiryMs = new Date(deal.expiryDate).getTime();
        if (!isNaN(expiryMs) && now > expiryMs) {
          isExpired = true;
          reason = 'OFFER_EXPIRED: Genuine provider expiry date has passed.';
        }
      }

      // Freshness policy check (MAX_OFFER_FRESHNESS_HOURS = 48h since last observation)
      if (!isExpired) {
        const observationTime = deal.observedAt || deal.lastCheckedAt;
        if (observationTime) {
          const observedMs = new Date(observationTime).getTime();
          if (!isNaN(observedMs) && (now - observedMs) > maxFreshnessMs) {
            isExpired = true;
            reason = `OFFER_STALE: Observation exceeded freshness policy (${MAX_OFFER_FRESHNESS_HOURS} hours since last observation).`;
          }
        }
      }

      if (isExpired) {
        deal.verificationStatus = 'EXPIRED';
        deal.buyerValueScore = 0;
        deal.updatedAt = new Date().toISOString();
        deal.rejectionReasons.push(reason);
        await this.persistDealToD1(deal, organizationId, businessId);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      console.log(`[DealEngine] Deactivated ${expiredCount} expired promotional deals.`);
    }

    return expiredCount;
  }

  /**
   * Queries active deals with filtering, pagination, and sorting (Spec § 9).
   */
  public queryPublicDeals(params: DealQueryParams = {}): {
    deals: NormalizedDeal[];
    total: number;
    categories: string[];
    merchants: string[];
    page: number;
    limit: number;
  } {
    const allDeals = Array.from(this.dealsMap.values());

    // Filter active deals
    let filtered = allDeals.filter(d => {
      // Hide expired, out-of-stock, rejected, unverified, unconfirmed, or recheck-required deals from public active results
      if (
        d.verificationStatus === 'EXPIRED' ||
        d.verificationStatus === 'REJECTED' ||
        d.verificationStatus === 'OUT_OF_STOCK' ||
        d.verificationStatus === 'UNVERIFIED' ||
        d.verificationStatus === 'UNCONFIRMED' ||
        d.verificationStatus === 'RECHECK_REQUIRED'
      ) {
        return false;
      }

      if (params.verifiedOnly && d.verificationStatus !== 'VERIFIED') {
        return false;
      }

      if (params.hasCoupon && !d.couponCode) {
        return false;
      }

      if (params.category && params.category !== 'all') {
        if (d.category.toLowerCase() !== params.category.toLowerCase()) {
          return false;
        }
      }

      if (params.merchant && params.merchant !== 'all') {
        if (d.merchant.toLowerCase() !== params.merchant.toLowerCase()) {
          return false;
        }
      }

      if (params.minPrice !== undefined && (d.currentPriceINR === undefined || d.currentPriceINR < params.minPrice)) {
        return false;
      }

      if (params.maxPrice !== undefined && (d.currentPriceINR === undefined || d.currentPriceINR > params.maxPrice)) {
        return false;
      }

      if (params.q) {
        const q = params.q.toLowerCase().trim();
        const matchesTitle = d.title.toLowerCase().includes(q);
        const matchesBrand = d.brand.toLowerCase().includes(q);
        const matchesMerchant = d.merchant.toLowerCase().includes(q);
        if (!matchesTitle && !matchesBrand && !matchesMerchant) {
          return false;
        }
      }

      return true;
    });

    // Sorting
    const sortBy = params.sortBy || 'buyer_value';
    filtered.sort((a, b) => {
      if (sortBy === 'buyer_value') {
        return b.buyerValueScore - a.buyerValueScore;
      }
      if (sortBy === 'freshness') {
        return new Date(b.lastCheckedAt).getTime() - new Date(a.lastCheckedAt).getTime();
      }
      if (sortBy === 'price_asc') {
        return (a.currentPriceINR ?? Infinity) - (b.currentPriceINR ?? Infinity);
      }
      if (sortBy === 'discount') {
        return (b.verifiedDiscountPercent || 0) - (a.verifiedDiscountPercent || 0);
      }
      return b.buyerValueScore - a.buyerValueScore;
    });

    // Extract facets
    const categories = Array.from(new Set(allDeals.map(d => d.category))).filter(Boolean);
    const merchants = Array.from(new Set(allDeals.map(d => d.merchant))).filter(Boolean);

    // Pagination
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(50, Math.max(1, params.limit || 12));
    const startIndex = (page - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    return {
      deals: paginated,
      total: filtered.length,
      categories,
      merchants,
      page,
      limit
    };
  }

  /**
   * Retrieves single deal detail by ID.
   */
  public getDealById(id: string): NormalizedDeal | null {
    return this.dealsMap.get(id) || null;
  }

  /**
   * Record a public page visit (Stage 2: PAGE VISIT).
   * Strictly increments observed page visits without assuming or multiplying any other counter.
   * Persists funnel telemetry across restarts via wf_commercial_funnel_telemetry in workflows table.
   */
  public recordPageVisit(meta?: { path?: string; ip?: string; referer?: string }): void {
    this.localPageVisitsCount++;
    this.persistFunnelTelemetryAsync().catch(() => {});
  }

  /**
   * Record a local deal card click (Stage 3: DEAL CLICK).
   * Increments local deal card clicks and synchronizes Cuelinks local click count.
   * Persists funnel telemetry across restarts via wf_commercial_funnel_telemetry in workflows table.
   */
  public recordDealClick(dealId: string, meta?: { ip?: string; placement?: string; source?: string }): { success: boolean; deal?: NormalizedDeal } {
    const deal = this.dealsMap.get(dealId);
    if (!deal) {
      return { success: false };
    }
    this.localDealClicksCount++;
    CuelinksSyncManager.getInstance().recordLocalClick();
    this.persistFunnelTelemetryAsync().catch(() => {});
    return { success: true, deal };
  }

  /**
   * Strict Bank Statement Confirmation Gate.
   * Enforces that cashReceivedINR is strictly ₹0.00 until explicit bank statement proof is provided.
   */
  public confirmBankProof(params: {
    amountINR: number;
    bankTransactionReference: string;
    statementDate: string;
    confirmedByOwner: boolean;
  }): { success: boolean; error?: string } {
    if (!params.confirmedByOwner) {
      return { success: false, error: 'OWNER_CONFIRMATION_REQUIRED: Bank statement credit must be explicitly confirmed by human owner.' };
    }
    if (!params.bankTransactionReference || params.bankTransactionReference.trim().length < 6) {
      return { success: false, error: 'INVALID_BANK_REFERENCE: A valid bank transaction reference/UTR is required.' };
    }
    if (params.amountINR <= 0) {
      return { success: false, error: 'INVALID_AMOUNT: Confirmed bank amount must be strictly greater than ₹0.00.' };
    }
    this.verifiedCashReceivedINR = params.amountINR;
    this.persistFunnelTelemetryAsync().catch(() => {});
    return { success: true };
  }

  /**
   * Complete 7-Stage Evidence-Based Commercial Funnel (Spec §§ 1–15)
   * DISCOVERY → PAGE VISIT → DEAL CLICK → PROVIDER CLICK → REPORTED CONVERSION → VALIDATED COMMISSION → PAID COMMISSION
   * Strictly separates all counters; NO metric is inferred or assumed from any other.
   * Cash received is strictly ₹0.00 until bank statement proof.
   */
  public getSevenStageFunnel(): SevenStageCommercialFunnel {
    const cuelinksSync = CuelinksSyncManager.getInstance().getStatus();
    const sources = Array.from(this.sourcesMap.values());
    const deals = Array.from(this.dealsMap.values());

    const discoveryImpressions = sources.reduce((acc, s) => acc + s.totalOffersFound, 0) || deals.length;
    const publicPageVisits = this.localPageVisitsCount;
    const dealCardClicks = this.localDealClicksCount;
    const providerAttributedClicks = cuelinksSync.reconciliation.providerAttributedClicks;
    const reportedConversions = cuelinksSync.reconciliation.reportedConversions;
    const validatedCommissionsINR = cuelinksSync.reconciliation.validatedCommissionINR;
    const paidCommissionsINR = cuelinksSync.reconciliation.paidCommissionINR;
    const pendingCommissionsINR = cuelinksSync.reconciliation.pendingCommissionINR;
    const reversedCommissionsINR = cuelinksSync.reconciliation.reversedCommissionINR;
    const cashReceivedINR = this.verifiedCashReceivedINR; // strictly ₹0.00 until bank statement proof

    return {
      discoveryImpressions,
      publicPageVisits,
      dealCardClicks,
      providerAttributedClicks,
      reportedConversions,
      validatedCommissionsINR,
      paidCommissionsINR,
      pendingCommissionsINR,
      reversedCommissionsINR,
      cashReceivedINR,
      lastUpdated: new Date().toISOString(),
      stageBreakdown: {
        DISCOVERY: {
          stage: 'DISCOVERY',
          name: 'Offer & Deal Discovery',
          countOrAmount: discoveryImpressions,
          unit: 'COUNT',
          evidenceSource: 'Deal Discovery Engine Offer Ingestion & Scanners',
          description: 'Autonomous discovery impressions and collected offers across retailer and brand catalogs',
          status: discoveryImpressions > 0 ? 'ACTIVE' : 'ZERO'
        },
        PAGE_VISIT: {
          stage: 'PAGE_VISIT',
          name: 'Public Page Visits',
          countOrAmount: publicPageVisits,
          unit: 'COUNT',
          evidenceSource: 'Public Deals & Buyer Guides Referral Beacon',
          description: 'Real visitor pageviews recorded by client-side referral beacon (excluding bots/test traffic)',
          status: publicPageVisits > 0 ? 'ACTIVE' : 'ZERO'
        },
        DEAL_CLICK: {
          stage: 'DEAL_CLICK',
          name: 'Local Deal Card Clicks',
          countOrAmount: dealCardClicks,
          unit: 'COUNT',
          evidenceSource: 'Local Deal Card Click Beacon',
          description: 'Verified outbound deal clicks recorded locally before provider redirect',
          status: dealCardClicks > 0 ? 'ACTIVE' : 'ZERO'
        },
        PROVIDER_CLICK: {
          stage: 'PROVIDER_CLICK',
          name: 'Provider Attributed Clicks',
          countOrAmount: providerAttributedClicks,
          unit: 'COUNT',
          evidenceSource: 'Cuelinks V3 API (/reports)',
          description: 'Outbound clicks acknowledged and recorded in provider reporting catalog',
          status: providerAttributedClicks > 0 ? 'ACTIVE' : 'ZERO'
        },
        REPORTED_CONVERSION: {
          stage: 'REPORTED_CONVERSION',
          name: 'Reported Conversions',
          countOrAmount: reportedConversions,
          unit: 'COUNT',
          evidenceSource: 'Cuelinks V3 API (/transactions)',
          description: 'Merchant-reported conversion orders attributable to our referral subids',
          status: reportedConversions > 0 ? 'ACTIVE' : 'ZERO'
        },
        VALIDATED_COMMISSION: {
          stage: 'VALIDATED_COMMISSION',
          name: 'Validated Commissions',
          countOrAmount: validatedCommissionsINR,
          unit: 'INR',
          evidenceSource: 'Cuelinks V3 API (/transactions status=approved)',
          description: 'Validated commission amount in INR after merchant return/cooling period expiration',
          status: validatedCommissionsINR > 0 ? 'ACTIVE' : 'ZERO'
        },
        PAID_COMMISSION: {
          stage: 'PAID_COMMISSION',
          name: 'Paid Commissions',
          countOrAmount: paidCommissionsINR,
          unit: 'INR',
          evidenceSource: 'Cuelinks V3 API (/transactions status=paid)',
          description: 'Affiliate network disbursed commission amount in INR awaiting bank settlement',
          status: paidCommissionsINR > 0 ? 'ACTIVE' : 'ZERO'
        }
      }
    };
  }

  /**
   * Persists commercial funnel telemetry counters (Stage 2: Page Visits, Stage 3: Deal Clicks, Verified Cash)
   * to Cloudflare D1 workflows table under record 'wf_commercial_funnel_telemetry'.
   * Complies with FEATURES_FROZEN = true with zero schema migrations.
   */
  public async persistFunnelTelemetryAsync(
    organizationId: string = 'org_owner_primary',
    businessId: string = 'biz_platform_aro'
  ): Promise<void> {
    try {
      const sql = `
        INSERT INTO workflows (
          id, organization_id, business_id, workflow_type, status, current_step,
          last_successful_checkpoint, retry_count, max_retries, inputs_json, outputs_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          current_step = excluded.current_step,
          inputs_json = excluded.inputs_json,
          outputs_json = excluded.outputs_json,
          updated_at = datetime('now')
      `;

      const inputsJson = JSON.stringify({
        telemetryType: 'COMMERCIAL_FUNNEL_TELEMETRY',
        description: 'Durable counters for Stage 2 (Page Visits) and Stage 3 (Deal Clicks)'
      });

      const outputsJson = JSON.stringify({
        localPageVisitsCount: this.localPageVisitsCount,
        localDealClicksCount: this.localDealClicksCount,
        verifiedCashReceivedINR: this.verifiedCashReceivedINR,
        persistedAt: new Date().toISOString()
      });

      await this.d1Repo.executeWrite('workflows', sql, [
        'wf_commercial_funnel_telemetry',
        organizationId,
        businessId,
        'COMMERCIAL_FUNNEL_TELEMETRY',
        'COMPLETED',
        'ACTIVE_TELEMETRY',
        'FUNNEL_CHECKPOINT',
        0,
        3,
        inputsJson,
        outputsJson
      ]);
    } catch (err: any) {
      if (!isProduction()) {
        // Silently tolerate in test SQLite environments
      }
    }
  }

  /**
   * Hydrates commercial funnel telemetry counters from Cloudflare D1 workflows table.
   */
  public async hydrateFunnelTelemetryFromDb(): Promise<{
    localPageVisitsCount: number;
    localDealClicksCount: number;
    verifiedCashReceivedINR: number;
  } | null> {
    try {
      const sql = `
        SELECT id, outputs_json, updated_at
        FROM workflows
        WHERE id = 'wf_commercial_funnel_telemetry'
      `;
      const row = await this.d1Repo.queryOne('workflows', sql, []);
      if (row && row.outputs_json) {
        const data = JSON.parse(row.outputs_json);
        if (typeof data.localPageVisitsCount === 'number') {
          this.localPageVisitsCount = Math.max(0, data.localPageVisitsCount);
        }
        if (typeof data.localDealClicksCount === 'number') {
          this.localDealClicksCount = Math.max(0, data.localDealClicksCount);
        }
        if (typeof data.verifiedCashReceivedINR === 'number') {
          this.verifiedCashReceivedINR = Math.max(0, data.verifiedCashReceivedINR);
        }
        return {
          localPageVisitsCount: this.localPageVisitsCount,
          localDealClicksCount: this.localDealClicksCount,
          verifiedCashReceivedINR: this.verifiedCashReceivedINR
        };
      }
    } catch (err: any) {
      if (!isProduction()) {
        // Silently tolerate in test SQLite environments
      }
    }
    return null;
  }

  /**
   * Alias for hydrateFunnelTelemetryFromDb
   */
  public async loadFunnelTelemetryFromDb(): Promise<{
    localPageVisitsCount: number;
    localDealClicksCount: number;
    verifiedCashReceivedINR: number;
  } | null> {
    return this.hydrateFunnelTelemetryFromDb();
  }

  /**
   * Reset local funnel counters for hermetic testing.
   */
  public resetFunnelMetricsForTesting(): void {
    this.localPageVisitsCount = 0;
    this.localDealClicksCount = 0;
    this.verifiedCashReceivedINR = 0;
    CuelinksSyncManager.getInstance().resetReconciliation();
    GrowthExperimentTracker.getInstance().resetForTesting();
    try {
      const db = getDb();
      db.prepare(`DELETE FROM workflows WHERE id = 'wf_commercial_funnel_telemetry'`).run();
    } catch {}
  }

  /**
   * Comprehensive operational observability metrics (Spec § 12).
   */
  public getDealEngineMetrics(): DealEngineObservabilityMetrics {
    const deals = Array.from(this.dealsMap.values());
    const sources = Array.from(this.sourcesMap.values());

    const verified = deals.filter(d => d.verificationStatus === 'VERIFIED').length;
    const verifiedWithConditions = deals.filter(d => d.verificationStatus === 'VERIFIED_WITH_CONDITIONS').length;
    const unconfirmed = deals.filter(d => d.verificationStatus === 'UNCONFIRMED').length;
    const rejected = deals.filter(d => d.verificationStatus === 'REJECTED').length;
    const expired = deals.filter(d => d.verificationStatus === 'EXPIRED').length;
    const outOfStock = deals.filter(d => d.availability === 'OUT_OF_STOCK').length;

    const uniqueProducts = this.dealFingerprintMap.size;
    const totalOffersFound = sources.reduce((acc, s) => acc + s.totalOffersFound, 0);

    const primaryMerchantSources = deals.filter(d => d.sourceType === 'RETAILER_BRAND').length;
    const independentCorroborated = deals.filter(d => d.discountVerificationType === 'INDEPENDENT_CORROBORATED').length;

    const failureReasons: Record<string, number> = {};
    for (const src of sources) {
      if (src.lastError) {
        failureReasons[src.lastError] = (failureReasons[src.lastError] || 0) + 1;
      } else if (src.exclusionReason) {
        failureReasons[src.exclusionReason] = (failureReasons[src.exclusionReason] || 0) + 1;
      }
    }

    const cuelinksSync = CuelinksSyncManager.getInstance().getStatus();
    const funnel = this.getSevenStageFunnel();
    const growthExperiments = GrowthExperimentTracker.getInstance().listAllExperiments();

    return {
      sources: {
        totalDiscovered: sources.length,
        allowed: sources.filter(s => s.permissionStatus === 'ALLOWED').length,
        conditional: sources.filter(s => s.permissionStatus === 'CONDITIONAL').length,
        blocked: sources.filter(s => s.permissionStatus === 'BLOCKED').length,
        unsupported: sources.filter(s => s.permissionStatus === 'UNSUPPORTED').length,
        scannedSuccessfully: sources.filter(s => s.lastHttpStatus === 200 && s.lastScanAt !== undefined).length,
        failing: sources.filter(s => s.failureCount > 0 || (s.lastHttpStatus !== undefined && s.lastHttpStatus !== 200)).length,
        failureReasons
      },
      offers: {
        rawCollected: totalOffersFound || deals.length,
        uniqueProducts,
        uniqueOffers: deals.length,
        verified,
        verifiedWithConditions,
        unconfirmed,
        rejected,
        expired,
        outOfStock,
        duplicateRatePercent: totalOffersFound > deals.length
          ? Math.round(((totalOffersFound - deals.length) / totalOffersFound) * 100)
          : 0,
        staleRatePercent: deals.length > 0
          ? Math.round((deals.filter(d => {
              const obs = d.observedAt || d.lastCheckedAt;
              return obs ? (Date.now() - new Date(obs).getTime()) > (MAX_OFFER_FRESHNESS_HOURS * 3600 * 1000) : false;
            }).length / deals.length) * 100)
          : 0,
        primaryMerchantSourcePercent: deals.length > 0 ? Math.round((primaryMerchantSources / deals.length) * 100) : 0,
        independentCorroborationPercent: deals.length > 0 ? Math.round((independentCorroborated / deals.length) * 100) : 0
      },
      monetization: {
        affiliateEligible: deals.filter(d => d.isMonetizable).length,
        withAuthorizedTracking: deals.filter(d => Boolean(d.trackingUrl)).length,
        directMerchantLinks: deals.filter(d => !d.isMonetizable).length,
        publishedDealPages: deals.filter(d => d.verificationStatus === 'VERIFIED' || d.verificationStatus === 'VERIFIED_WITH_CONDITIONS').length,
        clicksRecorded: funnel.dealCardClicks,
        providerAttributedClicks: funnel.providerAttributedClicks,
        providerAttributedConversions: funnel.reportedConversions,
        confirmedCommissionsINR: funnel.validatedCommissionsINR,
        reversedCommissionsINR: funnel.reversedCommissionsINR,
        paidCommissionsINR: funnel.paidCommissionsINR,
        cashReceivedINR: funnel.cashReceivedINR // Strictly ₹0.00 until bank statement proof
      },
      funnel,
      growthExperiments,
      execution: {
        lastCycleId: this.lastCycleId,
        lastScanAt: this.lastScanTimestamp,
        nextScheduledRun: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        durationMs: this.lastCycleDurationMs,
        activeBlockersCount: cuelinksSync.status === 'BLOCKED_AUTHORIZATION' ? 1 : 0,
        status: this.lastCycleStatus
      },
      cuelinksSync
    };
  }

  /**
   * Persists a normalized deal to durable Cloudflare D1 workflows table.
   * Strictly respects FEATURES_FROZEN = true with zero new migrations.
   */
  private async persistDealToD1(
    deal: NormalizedDeal,
    organizationId: string,
    businessId: string
  ): Promise<void> {
    try {
      const sql = `
        INSERT INTO workflows (
          id, organization_id, business_id, workflow_type, status, current_step,
          last_successful_checkpoint, retry_count, max_retries, inputs_json, outputs_json, error_info, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          current_step = excluded.current_step,
          last_successful_checkpoint = excluded.last_successful_checkpoint,
          inputs_json = excluded.inputs_json,
          outputs_json = excluded.outputs_json,
          error_info = excluded.error_info,
          updated_at = datetime('now')
      `;

      const inputsJson = JSON.stringify({
        dealKind: deal.dealKind || 'PRODUCT',
        discountBadge: deal.discountBadge,
        title: deal.title,
        brand: deal.brand,
        merchant: deal.merchant,
        category: deal.category,
        productUrl: deal.productUrl,
        currentPriceINR: deal.currentPriceINR,
        referencePriceINR: deal.referencePriceINR,
        claimedDiscountPercent: deal.claimedDiscountPercent,
        verifiedDiscountPercent: deal.verifiedDiscountPercent,
        couponCode: deal.couponCode,
        couponConditions: deal.couponConditions,
        availability: deal.availability,
        sourceUrl: deal.sourceUrl,
        sourceDomain: deal.sourceDomain,
        sourceType: deal.sourceType,
        modelOrSku: deal.modelOrSku,
        observedAt: deal.observedAt
      });

      const outputsJson = JSON.stringify({
        buyerValueScore: deal.buyerValueScore,
        confidenceScore: deal.confidenceScore,
        discountVerificationType: deal.discountVerificationType,
        isMonetizable: deal.isMonetizable,
        trackingUrl: deal.trackingUrl,
        affiliateNetwork: deal.affiliateNetwork,
        affiliateCampaignId: deal.affiliateCampaignId,
        evidence: deal.evidenceJson
      });

      const errorInfo = deal.rejectionReasons.length > 0 ? JSON.stringify(deal.rejectionReasons) : null;

      await this.d1Repo.executeWrite('workflows', sql, [
        deal.id,
        organizationId,
        businessId,
        'PUBLIC_DEAL',
        deal.verificationStatus,
        deal.category,
        'VERIFICATION',
        0,
        5,
        inputsJson,
        outputsJson,
        errorInfo
      ]);
    } catch (err: any) {
      console.warn(`[DealEngine] D1 deal persistence warning for ${deal.id}: ${err.message}`);
    }
  }

  /**
   * Syncs existing persistent deal records, funnel telemetry, and growth experiments from D1 workflows table.
   */
  public async syncFromD1Async(
    organizationId: string = 'org_owner_primary',
    businessId: string = 'biz_platform_aro'
  ): Promise<void> {
    // 1. Sync funnel telemetry counters
    await this.hydrateFunnelTelemetryFromDb();

    // 2. Sync growth experiments
    await GrowthExperimentTracker.getInstance().hydrateFromDb(organizationId);

    // 3. Sync existing persistent deal records from D1 workflows table
    try {
      const sql = `
        SELECT id, status, current_step, inputs_json, outputs_json, error_info, created_at, updated_at
        FROM workflows
        WHERE workflow_type = 'PUBLIC_DEAL' AND organization_id = ?
      `;

      const { results } = await this.d1Repo.executeRead('workflows', sql, [organizationId]);
      if (Array.isArray(results)) {
        for (const row of results) {
          try {
            const inputs = JSON.parse(row.inputs_json || '{}');
            const outputs = JSON.parse(row.outputs_json || '{}');
            const rejectionReasons = row.error_info ? JSON.parse(row.error_info) : [];
            const outputsEvidence = outputs.evidence;

            // Audit check: Verify durable evidence and observation provenance.
            // Legacy records lacking explicit primary observation timestamps or price history are quarantined as UNCONFIRMED.
            const hasVerifiableEvidence = Boolean(
              inputs.observedAt &&
              (outputsEvidence?.priceHistory?.length || (outputsEvidence?.verificationLogs && outputsEvidence.verificationLogs.length > 0))
            );

            let verificationStatus = row.status as DealVerificationStatus;
            if (!hasVerifiableEvidence && (verificationStatus === 'VERIFIED' || verificationStatus === 'VERIFIED_WITH_CONDITIONS')) {
              verificationStatus = 'UNCONFIRMED';
              if (!rejectionReasons.includes('LEGACY_UNVERIFIED_PROVENANCE: Record lacks primary observation evidence or fresh SKU audit.')) {
                rejectionReasons.push('LEGACY_UNVERIFIED_PROVENANCE: Record lacks primary observation evidence or fresh SKU audit.');
              }
            }

            const deal: NormalizedDeal = {
              id: row.id,
              dealKind: inputs.dealKind || 'PRODUCT',
              discountBadge: inputs.discountBadge,
              title: inputs.title || 'Untitled Deal',
              brand: inputs.brand || 'Generic',
              merchant: inputs.merchant || 'Unknown',
              category: inputs.category || 'General',
              productUrl: inputs.productUrl || '',
              currentPriceINR: inputs.currentPriceINR,
              currency: 'INR',
              referencePriceINR: inputs.referencePriceINR,
              claimedDiscountPercent: inputs.claimedDiscountPercent,
              verifiedDiscountPercent: inputs.verifiedDiscountPercent,
              discountVerificationType: outputs.discountVerificationType || 'UNCONFIRMED',
              couponCode: inputs.couponCode,
              couponConditions: inputs.couponConditions,
              availability: inputs.availability || 'IN_STOCK',
              geographicRestrictions: ['India'],
              lastCheckedAt: row.updated_at || row.created_at,
              observedAt: inputs.observedAt || row.created_at,
              sourceUrl: inputs.sourceUrl || '',
              sourceDomain: inputs.sourceDomain || '',
              sourceType: inputs.sourceType || 'RETAILER_BRAND',
              verificationStatus,
              confidenceScore: outputs.confidenceScore || 80,
              buyerValueScore: outputs.buyerValueScore || 0,
              rejectionReasons,
              isMonetizable: Boolean(outputs.isMonetizable),
              trackingUrl: outputs.trackingUrl,
              affiliateNetwork: outputs.affiliateNetwork,
              affiliateCampaignId: outputs.affiliateCampaignId,
              modelOrSku: inputs.modelOrSku,
              evidenceJson: outputs.evidence || { sources: [inputs.sourceUrl] },
              createdAt: row.created_at,
              updatedAt: row.updated_at
            };

            this.dealsMap.set(deal.id, deal);

            const coreTitleTokens = deal.title
              .toLowerCase()
              .replace(/[^a-z0-9\s]/g, '')
              .split(/\s+/)
              .slice(0, 5)
              .join('-');
            const fingerprint = `${deal.merchant.toLowerCase()}:${deal.brand.toLowerCase()}:${coreTitleTokens}:${deal.modelOrSku || 'default'}`;
            this.dealFingerprintMap.set(fingerprint, deal.id);
          } catch {}
        }
      }
    } catch (err: any) {
      console.warn(`[DealEngine] Notice syncing deals from D1: ${err.message}`);
    }
  }

  private recordRejection(domain: string, reason: string): void {
    const src = Array.from(this.sourcesMap.values()).find(s => s.domain === domain);
    if (src) {
      src.totalOffersRejected++;
      src.exclusionReason = reason;
    }
  }

  public getSources(): DealSourceRecord[] {
    return Array.from(this.sourcesMap.values());
  }

  public getSource(id: string): DealSourceRecord | undefined {
    return this.sourcesMap.get(id);
  }

  public resetSources(): void {
    this.sourcesMap.clear();
    this.seedDefaultIndianSources();
  }
}
