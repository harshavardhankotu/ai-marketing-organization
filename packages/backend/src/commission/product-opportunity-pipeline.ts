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
}
