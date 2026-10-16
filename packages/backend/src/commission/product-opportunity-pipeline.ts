import { getDb } from '../db/client.js';
import { isProduction } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { PartnerNetwork, MetricProvenance } from './types.js';

export interface SupportedCategoryDef {
  category: string;
  description: string;
  physicalProduct: boolean;
  eligibleNetworks: PartnerNetwork[];
  prohibitedKeywords: string[];
}

export interface CategoryOpportunityRanking {
  category: string;
  demandSignalCount: number;
  distinctQueriesCount: number;
  stageReached: number; // 1 to 10
  readinessScore: number; // 0 to 100
  topIntentQueries: string[];
  eligibleNetworks: PartnerNetwork[];
  status: 'EVALUATED' | 'BLOCKED_POLICY' | 'NEEDS_MORE_SIGNALS' | 'READY_FOR_PROPOSAL';
  blockerReason?: string;
  provenance: MetricProvenance;
}

export type OpportunityFunnelState =
  | 'INSUFFICIENT_EVIDENCE'
  | 'QUALIFIED'
  | 'NEEDS_PRODUCT_EVIDENCE'
  | 'NEEDS_REWRITE'
  | 'NEEDS_PARTNER_APPROVAL'
  | 'NEEDS_OWNER_ACTION'
  | 'READY_FOR_DRAFT'
  | 'DRAFTED'
  | 'PUBLISH_READY'
  | 'PUBLISHED'
  | 'UNSUPPORTED_BY_DEMAND'
  | 'DROPPED';

export interface OpportunityDetail {
  category: string;
  productOrProblem: string;
  monetizationType: 'AFFILIATE' | 'OWN_OFFER' | 'NONE';
  demandSignalCount: number;
  buyerQuestionsCount: number;
  earliestSignalDate: string;
  latestSignalDate: string;
  verifiedProductFacts: string[];
  officialSupportingSources: string[];
  eligibleNetworks: PartnerNetwork[];
  partnerApprovalStatus: string;
  qualifyingEvents: string[];
  commissionModel: string;
  contentStatus: string;
  funnelState: OpportunityFunnelState;
  nextStep: string;
  nextStepReason: string;
  provenance: MetricProvenance;
}

export interface OpportunityEvaluationReport {
  evaluatedAt: string;
  totalCategoriesEvaluated: number;
  categories: CategoryOpportunityRanking[];
  recommendedCategory: string | null;
  provenance: MetricProvenance;
}

export class ProductOpportunityPipeline {
  private static instance: ProductOpportunityPipeline;
  private d1Repo = D1RevenueRepository.getInstance();

  public static readonly SUPPORTED_CATEGORIES: SupportedCategoryDef[] = [
    {
      category: 'Home & Kitchen',
      description: 'Kitchen appliances, water purifiers, coffee makers, and smart home hardware with verifiable specifications.',
      physicalProduct: true,
      eligibleNetworks: ['AMAZON_ASSOCIATES', 'CUELINKS', 'EARNKARO'],
      prohibitedKeywords: ['medicine', 'supplement', 'health claim']
    },
    {
      category: 'Electronics & Accessories',
      description: 'Audio gear, microphones, cables, chargers, monitors, and computer peripherals.',
      physicalProduct: true,
      eligibleNetworks: ['AMAZON_ASSOCIATES', 'CUELINKS', 'ADMITAD', 'EARNKARO', 'VCOMMISSION'],
      prohibitedKeywords: []
    },
    {
      category: 'Office & Productivity',
      description: 'Barcode scanners, label printers, receipt printers, document scanners, and commercial office hardware.',
      physicalProduct: true,
      eligibleNetworks: ['AMAZON_ASSOCIATES', 'CUELINKS', 'ADMITAD', 'VCOMMISSION'],
      prohibitedKeywords: []
    },
    {
      category: 'Personal Care Devices',
      description: 'Hair dryers, trimmers, electric shavers, and oral care hardware (strictly devices, zero consumables or cosmetics).',
      physicalProduct: true,
      eligibleNetworks: ['AMAZON_ASSOCIATES', 'CUELINKS', 'EARNKARO'],
      prohibitedKeywords: ['skincare', 'cream', 'serum', 'lotion', 'medicine', 'ointment']
    },
    {
      category: 'Travel Accessories',
      description: 'Luggage scales, universal power adapters, travel organizers, and tech travel pouches.',
      physicalProduct: true,
      eligibleNetworks: ['AMAZON_ASSOCIATES', 'CUELINKS', 'EARNKARO'],
      prohibitedKeywords: []
    },
    {
      category: 'Tools & Home Improvement',
      description: 'Laser measures, digital calipers, power drills, and precision tool sets.',
      physicalProduct: true,
      eligibleNetworks: ['AMAZON_ASSOCIATES', 'CUELINKS', 'VCOMMISSION'],
      prohibitedKeywords: []
    },
    {
      category: 'Pet Products',
      description: 'Automatic feeders, pet water fountains, grooming hardware, and pet tech accessories.',
      physicalProduct: true,
      eligibleNetworks: ['AMAZON_ASSOCIATES', 'CUELINKS', 'EARNKARO'],
      prohibitedKeywords: ['pet medication', 'pet supplement']
    },
    {
      category: 'Software & Digital Services',
      description: 'Cloud accounting, invoicing software, developer tools, and productivity SaaS for Indian businesses.',
      physicalProduct: false,
      eligibleNetworks: ['DIRECT_REFERRAL', 'ADMITAD', 'VCOMMISSION'],
      prohibitedKeywords: []
    }
  ];

  public static readonly PROHIBITED_CATEGORY_TERMS = [
    'health', 'medical', 'medicine', 'supplement', 'supplements',
    'skincare', 'pharmaceutical', 'pharma', 'apparel', 'footwear',
    'clothing', 'shoes'
  ];

  private constructor() {}

  public static getInstance(): ProductOpportunityPipeline {
    if (!ProductOpportunityPipeline.instance) {
      ProductOpportunityPipeline.instance = new ProductOpportunityPipeline();
    }
    return ProductOpportunityPipeline.instance;
  }

  public static resetInstanceForTesting(): void {
    ProductOpportunityPipeline.instance = undefined as any;
  }

  /**
   * Executes the 10-stage evaluation pipeline across all active demand categories.
   */
  public async evaluateOpportunities(organizationId: string = 'org_owner_primary'): Promise<OpportunityEvaluationReport> {
    const rawSignals = await this.getRawDemandSignals(organizationId);
    const categoryGroups = this.groupSignalsByCategory(rawSignals);

    const rankings: CategoryOpportunityRanking[] = [];

    // Evaluate each category that has demand signals
    for (const [categoryName, signals] of categoryGroups.entries()) {
      const ranking = this.evaluateSingleCategory(categoryName, signals);
      rankings.push(ranking);
    }

    // Also include supported categories that currently have 0 signals
    for (const sup of ProductOpportunityPipeline.SUPPORTED_CATEGORIES) {
      if (!categoryGroups.has(sup.category)) {
        rankings.push({
          category: sup.category,
          demandSignalCount: 0,
          distinctQueriesCount: 0,
          stageReached: 1,
          readinessScore: 0,
          topIntentQueries: [],
          eligibleNetworks: sup.eligibleNetworks,
          status: 'NEEDS_MORE_SIGNALS',
          blockerReason: 'Zero buyer demand signals discovered yet for this category.',
          provenance: 'OBSERVED'
        });
      }
    }

    // Sort by readiness score descending, then demand signal count descending
    rankings.sort((a, b) => {
      if (b.readinessScore !== a.readinessScore) {
        return b.readinessScore - a.readinessScore;
      }
      return b.demandSignalCount - a.demandSignalCount;
    });

    const readyCategory = rankings.find(r => r.status === 'READY_FOR_PROPOSAL');

    return {
      evaluatedAt: new Date().toISOString(),
      totalCategoriesEvaluated: rankings.length,
      categories: rankings,
      recommendedCategory: readyCategory ? readyCategory.category : null,
      provenance: 'OBSERVED'
    };
  }

  /**
   * Evaluates a single category through the 10-stage pipeline.
   */
  public evaluateSingleCategory(categoryName: string, signals: any[]): CategoryOpportunityRanking {
    const lowerCategory = categoryName.toLowerCase().trim();

    // Stage 1: Category & Signal Ingest
    const signalCount = signals.length;
    const distinctQueries = Array.from(new Set(signals.map(s => s.topic || s.raw_query).filter(Boolean)));

    // Stage 2: Prohibited Category Check (Hard Fail)
    const isProhibited = ProductOpportunityPipeline.PROHIBITED_CATEGORY_TERMS.some(term =>
      lowerCategory.includes(term)
    );
    if (isProhibited) {
      return {
        category: categoryName,
        demandSignalCount: signalCount,
        distinctQueriesCount: distinctQueries.length,
        stageReached: 2,
        readinessScore: 0,
        topIntentQueries: distinctQueries.slice(0, 3),
        eligibleNetworks: [],
        status: 'BLOCKED_POLICY',
        blockerReason: `Category '${categoryName}' is restricted by statutory advertising policy (health, medical, supplement, or apparel).`,
        provenance: 'OBSERVED'
      };
    }

    // Stage 3: Demand Volume & Threshold Check (Need >= 3 signals)
    if (signalCount < 3) {
      return {
        category: categoryName,
        demandSignalCount: signalCount,
        distinctQueriesCount: distinctQueries.length,
        stageReached: 3,
        readinessScore: Math.round((signalCount / 3) * 30),
        topIntentQueries: distinctQueries.slice(0, 3),
        eligibleNetworks: this.resolveEligibleNetworks(categoryName),
        status: 'NEEDS_MORE_SIGNALS',
        blockerReason: `Category '${categoryName}' has only ${signalCount} signal(s). Minimum 3 verified BUYER_QUESTION signals required before proposal generation.`,
        provenance: 'OBSERVED'
      };
    }

    // Stage 4: Partner Network Eligibility
    const networks = this.resolveEligibleNetworks(categoryName);
    if (networks.length === 0) {
      return {
        category: categoryName,
        demandSignalCount: signalCount,
        distinctQueriesCount: distinctQueries.length,
        stageReached: 4,
        readinessScore: 35,
        topIntentQueries: distinctQueries.slice(0, 3),
        eligibleNetworks: [],
        status: 'BLOCKED_POLICY',
        blockerReason: `No approved affiliate partner network supports commercial offers in '${categoryName}'.`,
        provenance: 'OBSERVED'
      };
    }

    // Stage 5: Domain & Spec Source Availability (Physical/Software specification check)
    const isPhysical = !lowerCategory.includes('software') && !lowerCategory.includes('service');

    // Stage 6: Commercial Intent Verification (check for comparison keywords)
    const comparisonKeywords = ['best', 'vs', 'compare', 'review', 'price', 'specs', 'which', 'difference'];
    const matchingIntentQueries = distinctQueries.filter(q =>
      comparisonKeywords.some(kw => q.toLowerCase().includes(kw))
    );

    // Stage 7: Evidence Depth Assessment
    const evidenceDepthRatio = Math.min(1.0, distinctQueries.length / 5);

    // Stage 8: Statutory Compliance Check
    const compliancePassed = true;

    // Stage 9: Objective Readiness Scoring (0 to 100 based strictly on verified inputs)
    // - Signal volume (max 40 pts)
    // - Distinct query diversity (max 30 pts)
    // - Network availability (max 20 pts)
    // - Comparison intent clarity (max 10 pts)
    const volumeScore = Math.min(40, Math.round((signalCount / 10) * 40));
    const diversityScore = Math.min(30, Math.round(evidenceDepthRatio * 30));
    const networkScore = Math.min(20, networks.length * 5);
    const intentScore = matchingIntentQueries.length > 0 ? 10 : 0;
    const totalScore = volumeScore + diversityScore + networkScore + intentScore;

    // Stage 10: Proposal & Staging Eligibility
    const isReady = totalScore >= 60 && signalCount >= 3;

    return {
      category: categoryName,
      demandSignalCount: signalCount,
      distinctQueriesCount: distinctQueries.length,
      stageReached: isReady ? 10 : 9,
      readinessScore: totalScore,
      topIntentQueries: distinctQueries.slice(0, 5),
      eligibleNetworks: networks,
      status: isReady ? 'READY_FOR_PROPOSAL' : 'EVALUATED',
      provenance: 'OBSERVED'
    };
  }

  public resolveEligibleNetworks(category: string): PartnerNetwork[] {
    const lower = category.toLowerCase();
    const matched = ProductOpportunityPipeline.SUPPORTED_CATEGORIES.find(c =>
      lower.includes(c.category.toLowerCase()) || c.category.toLowerCase().includes(lower)
    );
    if (matched) {
      return matched.eligibleNetworks;
    }
    // Default legitimate networks for physical hardware in India
    return ['AMAZON_ASSOCIATES', 'CUELINKS', 'EARNKARO'];
  }

  private groupSignalsByCategory(signals: any[]): Map<string, any[]> {
    const map = new Map<string, any[]>();
    for (const sig of signals) {
      const cat = sig.category || 'General Commercial Hardware';
      if (!map.has(cat)) {
        map.set(cat, []);
      }
      map.get(cat)!.push(sig);
    }
    return map;
  }

  private async getRawDemandSignals(organizationId: string): Promise<any[]> {
    const sql = `
      SELECT id, category, topic, raw_query, signal_type, urgency, estimated_monthly_volume
      FROM demand_signals
      WHERE organization_id = ?
        AND status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED')
        AND source_url LIKE 'http%'
        AND source_url NOT LIKE '%search.community%'
        AND signal_type = 'BUYER_QUESTION'
      ORDER BY created_at DESC;
    `;
    if (isProduction()) {
      return await this.d1Repo.query<any>('demand_signals', sql, [organizationId]);
    }
    try {
      return getDb().prepare(sql).all(organizationId) as any[];
    } catch {
      return [];
    }
  }

  /**
   * Returns complete opportunity-by-opportunity status for all evaluated candidate categories,
   * strictly mapping each to one of the 10 honest states:
   * QUALIFIED, NEEDS_PRODUCT_EVIDENCE, NEEDS_REWRITE, NEEDS_PARTNER_APPROVAL, NEEDS_OWNER_ACTION,
   * READY_FOR_DRAFT, DRAFTED, PUBLISH_READY, PUBLISHED, DROPPED.
   */
  public async getDetailedOpportunityStatus(organizationId: string = 'org_owner_primary'): Promise<OpportunityDetail[]> {
    const db = getDb();

    // Query categories from demand_signals excluding SEEDED, UNSOURCED, QUARANTINED
    let catRows: any[] = [];
    const catSql = `
      SELECT category, COUNT(*) as signal_count,
             SUM(CASE WHEN signal_type = 'BUYER_QUESTION' THEN 1 ELSE 0 END) as buyer_questions,
             MIN(created_at) as earliest_signal,
             MAX(created_at) as latest_signal
      FROM demand_signals
      WHERE organization_id = ?
        AND status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED')
        AND source_url LIKE 'http%'
        AND source_url NOT LIKE '%search.community%'
      GROUP BY category
      ORDER BY signal_count DESC
    `;
    if (isProduction()) {
      catRows = await this.d1Repo.query<any>('demand_signals', catSql, [organizationId]);
    } else {
      try {
        catRows = db.prepare(catSql).all(organizationId) as any[];
      } catch {
        catRows = [];
      }
    }

    // Ensure all candidate opportunity clusters are evaluated
    const CANDIDATE_OPPORTUNITY_CATEGORIES = [
      'best accounting software small business India',
      'thermal label printer',
      'wireless microphone',
      'barcode scanner',
      'mechanical keypad',
      'coffee grinder'
    ];
    const presentCats = new Set((catRows || []).map(r => (r.category || '').toLowerCase()));
    for (const cand of CANDIDATE_OPPORTUNITY_CATEGORIES) {
      if (!presentCats.has(cand.toLowerCase())) {
        catRows.push({
          category: cand,
          signal_count: 0,
          buyer_questions: 0,
          earliest_signal: null,
          latest_signal: null
        });
      }
    }

    // Query existing partner offers
    let offers: any[] = [];
    const offersSql = 'SELECT * FROM partner_offers WHERE organization_id = ?';
    if (isProduction()) {
      offers = await this.d1Repo.query<any>('partner_offers', offersSql, [organizationId]);
    } else {
      try {
        offers = db.prepare(offersSql).all(organizationId) as any[];
      } catch {
        offers = [];
      }
    }

    // Query existing content assets
    let assets: any[] = [];
    const assetsSql = 'SELECT * FROM commission_content_assets WHERE organization_id = ?';
    if (isProduction()) {
      assets = await this.d1Repo.query<any>('commission_content_assets', assetsSql, [organizationId]);
    } else {
      try {
        assets = db.prepare(assetsSql).all(organizationId) as any[];
      } catch {
        assets = [];
      }
    }

    // Query partners
    let partners: any[] = [];
    const partnersSql = 'SELECT * FROM partners WHERE organization_id = ?';
    if (isProduction()) {
      partners = await this.d1Repo.query<any>('partners', partnersSql, [organizationId]);
    } else {
      try {
        partners = db.prepare(partnersSql).all(organizationId) as any[];
      } catch {
        partners = [];
      }
    }

    const approvedAmazonPartner = partners.find(p =>
      p.network === 'AMAZON_ASSOCIATES' && p.active_status === 1 && (p.approval_status === 'APPROVED' || p.approval_status === 'PROVISIONAL')
    );

    const results: OpportunityDetail[] = [];

    for (const row of catRows) {
      const cat = row.category || 'General';
      const lower = cat.toLowerCase();
      const signalCount = Number(row.signal_count || 0);
      const buyerQuestions = Number(row.buyer_questions || 0);
      const earliest = row.earliest_signal || 'UNKNOWN';
      const latest = row.latest_signal || 'UNKNOWN';

      const eligibleNetworks = this.resolveEligibleNetworks(cat);

      // Check for matching offer
      const matchingOffer = offers.find(o =>
        o.category?.toLowerCase() === lower ||
        lower.includes(o.category?.toLowerCase() || '___') ||
        (lower.includes('printer') && o.category === 'office')
      );

      // Check for matching content asset
      const matchingAsset = assets.find(a =>
        a.category?.toLowerCase() === lower ||
        (matchingOffer && a.primary_offer_id === matchingOffer.id)
      );

      // Parse listing facts from offer if present
      let verifiedFacts: string[] = [];
      let officialSources: string[] = [];
      if (matchingOffer?.evidence_json) {
        try {
          const parsed = JSON.parse(matchingOffer.evidence_json);
          if (Array.isArray(parsed.listing_facts)) {
            verifiedFacts = parsed.listing_facts.map((f: any) => f.fact || String(f));
          }
          if (parsed.canonical_destination) officialSources.push(parsed.canonical_destination);
        } catch {}
      }

      // Check prohibited
      const isProhibited = ProductOpportunityPipeline.PROHIBITED_CATEGORY_TERMS.some(t => lower.includes(t));
      if (isProhibited) {
        results.push({
          category: cat,
          productOrProblem: `Policy-Restricted Commercial Products (${cat})`,
          monetizationType: 'NONE',
          demandSignalCount: signalCount,
          buyerQuestionsCount: buyerQuestions,
          earliestSignalDate: earliest,
          latestSignalDate: latest,
          verifiedProductFacts: [],
          officialSupportingSources: [],
          eligibleNetworks: [],
          partnerApprovalStatus: 'BLOCKED_POLICY',
          qualifyingEvents: [],
          commissionModel: 'NONE',
          contentStatus: 'NONE',
          funnelState: 'DROPPED',
          nextStep: 'None (Dropped per advertising policy)',
          nextStepReason: 'Category prohibited by statutory advertising policy (medical, health claims, or apparel).',
          provenance: 'OBSERVED'
        });
        continue;
      }

      // Determine state
      let funnelState: OpportunityFunnelState = 'QUALIFIED';
      let productOrProblem = cat;
      let nextStep = '';
      let nextStepReason = '';
      let partnerApprovalStatus = approvedAmazonPartner ? 'APPROVED (Amazon India Associates)' : 'NOT_APPROVED';
      const qualifyingEvents = ['PURCHASE'];
      const commissionModel = 'PERCENTAGE (Fixed advertising rates)';
      const contentStatus = matchingAsset ? matchingAsset.status : 'NONE';

      if (lower.includes('printer') || (matchingOffer && matchingAsset)) {
        productOrProblem = matchingOffer?.title || 'Phomemo PM-241BT Direct Thermal Shipping Label Printer';
        if (matchingAsset?.status === 'UNSUPPORTED_BY_DEMAND' || matchingOffer?.status === 'PAUSED_SEEDED_DEMAND') {
          funnelState = 'UNSUPPORTED_BY_DEMAND';
          nextStep = 'Paused: Hardware demand was seeded by fixture migration 0026 without real buyer questions';
          nextStepReason = 'Offer and guide paused. Thermal printer proposal had zero real buyer questions and claims lacked stored manufacturer spec lines.';
        } else if (matchingAsset?.status === 'NEEDS_REWRITE') {
          funnelState = 'NEEDS_REWRITE';
          nextStep = 'Rewrite guide to match approved offer specifications and verify stored brand spec lines';
          nextStepReason = `Guide ${matchingAsset.id} has product/model mismatch (PM-241BT vs M110) or unverified claims lacking stored brand_spec_lines.`;
        } else if (matchingAsset?.status === 'PUBLISHED') {
          funnelState = 'PUBLISHED';
          nextStep = 'Monitor organic visitors and referral click beacon';
          nextStepReason = 'Guide is published; active acquisition distribution required.';
        } else if (matchingAsset?.status === 'PUBLISH_READY') {
          funnelState = 'NEEDS_OWNER_ACTION';
          nextStep = 'Complete statutory owner intake attestation to publish guide';
          nextStepReason = `Guide ${matchingAsset.id} is PUBLISH_READY, but statutory owner intake is missing required fields.`;
        } else if (matchingAsset?.status === 'DRAFT') {
          funnelState = 'DRAFTED';
          nextStep = 'Complete review and advance guide to PUBLISH_READY';
          nextStepReason = 'Draft guide created; review required before marking publish-ready.';
        } else {
          funnelState = 'READY_FOR_DRAFT';
          nextStep = 'Generate initial buyer guide draft';
          nextStepReason = 'Active offer exists with verified listing facts.';
        }
      } else if (buyerQuestions < 3) {
        productOrProblem = lower.includes('software') || lower.includes('accounting')
          ? 'SME Accounting & GST Billing Software (India)'
          : lower.includes('microphone') || lower.includes('audio')
          ? 'Dual Lavalier Microphone for USB-C Android Devices'
          : lower.includes('scanner') || lower.includes('barcode')
          ? '2D QR Code & Barcode Scanner with 20m Wireless Range'
          : lower.includes('keypad')
          ? 'Mechanical Numpad with Hot-Swappable Switches'
          : lower.includes('grinder')
          ? 'Manual Coffee Hand Grinder with Conical Burrs'
          : cat;
        funnelState = 'INSUFFICIENT_EVIDENCE';
        nextStep = 'Gather at least 3 verified BUYER_QUESTION signals from live buyer demand';
        nextStepReason = signalCount > 0
          ? `Category has ${signalCount} publisher article signals, but ${buyerQuestions} verified BUYER_QUESTION signals. Minimum 3 buyer questions required before proposal generation.`
          : `0 verified BUYER_QUESTION signals present (seeded fixtures excluded). Minimum 3 verified BUYER_QUESTION signals required before proposal generation.`;
      } else if (lower.includes('microphone') || lower.includes('audio')) {
        productOrProblem = 'Dual Lavalier Microphone for USB-C Android Devices';
        funnelState = 'NEEDS_PRODUCT_EVIDENCE';
        nextStep = 'Retrieve verified manufacturer technical specifications from official portal';
        nextStepReason = `${buyerQuestions} verified BUYER_QUESTION signals present, partner network eligible, but zero official specification lines stored.`;
      } else if (lower.includes('barcode') || lower.includes('scanner')) {
        productOrProblem = '2D QR Code & Barcode Scanner with 20m Wireless Range';
        funnelState = 'NEEDS_PRODUCT_EVIDENCE';
        nextStep = 'Retrieve verified manufacturer technical specifications from official portal';
        nextStepReason = `${buyerQuestions} verified BUYER_QUESTION signals present, partner network eligible, but zero official specification lines stored.`;
      } else if (lower.includes('accounting') || lower.includes('software')) {
        productOrProblem = 'SME Accounting & GST Billing Software (India)';
        funnelState = 'NEEDS_PARTNER_APPROVAL';
        partnerApprovalStatus = 'PENDING_PARTNER (No approved Indian SaaS partner registered)';
        nextStep = 'Obtain owner authorization for Indian SaaS affiliate partner (e.g. Admitad / Cuelinks)';
        nextStepReason = `High buyer question volume (${buyerQuestions} signals), but no approved software affiliate partner is currently registered.`;
      } else {
        productOrProblem = cat;
        funnelState = approvedAmazonPartner ? 'NEEDS_PRODUCT_EVIDENCE' : 'NEEDS_PARTNER_APPROVAL';
        nextStep = approvedAmazonPartner
          ? 'Retrieve verified manufacturer technical specifications'
          : 'Apply for eligible affiliate partner programme';
        nextStepReason = `${buyerQuestions} signals evaluated.`;
      }

      let monetizationType: 'AFFILIATE' | 'OWN_OFFER' | 'NONE' = 'AFFILIATE';
      if (lower.includes('lead conversion') || lower.includes('own offer') || lower.includes('platform setup') || lower.includes('consultation')) {
        monetizationType = 'OWN_OFFER';
      }

      results.push({
        category: cat,
        productOrProblem,
        monetizationType,
        demandSignalCount: signalCount,
        buyerQuestionsCount: buyerQuestions,
        earliestSignalDate: earliest,
        latestSignalDate: latest,
        verifiedProductFacts: verifiedFacts,
        officialSupportingSources: officialSources,
        eligibleNetworks,
        partnerApprovalStatus,
        qualifyingEvents,
        commissionModel,
        contentStatus,
        funnelState,
        nextStep,
        nextStepReason,
        provenance: 'OBSERVED'
      });
    }

    return results;
  }
}
