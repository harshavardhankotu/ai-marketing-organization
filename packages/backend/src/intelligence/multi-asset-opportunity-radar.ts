/**
 * MultiAssetOpportunityRadar — SEBI-Safe Financial Research & Buyer-Supply Arbitrage Engine (Stage I P5 & P6)
 *
 * Computes deterministic, zero-cost analytics across:
 * 1. Mutual Fund & Index ETF NAV histories (`https://api.mfapi.in/mf` + historical volatility/drawdown/Sharpe metrics)
 * 2. Sovereign Gold Bond (SGB) vs Spot Bullion parity & 2.5% coupon yield spread
 * 3. RBI G-Sec / Fixed Income YTM & Modified Duration ladder calculations
 * 4. REIT / Equity Dividend-vs-GSec Valuation Spreads
 * 5. Buyer-Request-to-Supply Arbitrage Clustering (`matchBuyerDemandToSupply`)
 *
 * STRICT REGULATORY GUARDRAIL:
 *   `SEBI_COMPLIANCE_MODE = 'EDUCATIONAL_RESEARCH_AND_PAPER_PORTFOLIO_ONLY'`
 * - NEVER outputs personalized buy/sell investment advice or executes automated brokerage trades.
 */

import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';

export const SEBI_COMPLIANCE_MODE = 'EDUCATIONAL_RESEARCH_AND_PAPER_PORTFOLIO_ONLY' as const;

export interface MutualFundResearchSnapshot {
  schemeCode: string;
  schemeName: string;
  category: 'INDEX_ETF' | 'DEBT_LIQUID' | 'EQUITY_DIVERSIFIED' | 'GOLD_ETF';
  observationsCount: number;
  latestNav: number;
  latestDate: string;
  periodReturnPercent: number;
  annualizedVolatilityPercent: number;
  maxDrawdownPercent: number;
  riskAdjustedRatio: number;
  sebiComplianceMode: typeof SEBI_COMPLIANCE_MODE;
  disclaimer: string;
}

export interface SgbBullionParitySnapshot {
  trancheLabel: string;
  sgbMarketPricePerGramINR: number;
  spotGoldPricePerGramINR: number;
  annualInterestPercent: number;
  yearsToMaturity: number;
  discountToSpotPercent: number;
  impliedEffectiveYieldAdvantagePercent: number;
  sebiComplianceMode: typeof SEBI_COMPLIANCE_MODE;
  disclaimer: string;
}

export interface BondDurationSnapshot {
  instrumentName: string;
  faceValueINR: number;
  marketPriceINR: number;
  couponRatePercent: number;
  yearsToMaturity: number;
  approxYtmPercent: number;
  macaulayDurationYears: number;
  modifiedDurationYears: number;
  sebiComplianceMode: typeof SEBI_COMPLIANCE_MODE;
}

export interface ArbitrageCluster {
  clusterId: string;
  clusterType: 'B2B_TECHNICAL_DEFECT_CLUSTER' | 'B2C_PRODUCT_ARBITRAGE_CLUSTER' | 'FINANCIAL_RESEARCH_CLUSTER';
  lane: 'LANE_A_AFFILIATE_COMMERCE' | 'LANE_B_B2B_SERVICES' | 'LANE_E_FINANCIAL_INTELLIGENCE';
  title: string;
  demandSignalsCount: number;
  matchedSupplyItemsCount: number;
  topMatchedSupplySlugOrDomain: string | null;
  topCommissionRatePercent: number | null;
  priceAdvantageSummary: string;
  actionableOfferPath: string;
}

export interface MultiAssetRadarSummary {
  generatedAt: string;
  sebiComplianceMode: typeof SEBI_COMPLIANCE_MODE;
  personalizedAdviceBlocked: true;
  automatedTradeExecutionBlocked: true;
  trackedBenchmarksCount: number;
  researchSnapshots: Array<{
    id: string;
    assetClass: 'MUTUAL_FUND_ETF' | 'SGB_BULLION_PARITY' | 'GSEC_DURATION' | 'REIT_SPREAD';
    title: string;
    summaryMetric: string;
    evidenceSource: string;
    sebiComplianceMode: typeof SEBI_COMPLIANCE_MODE;
  }>;
  arbitrageClusters: ArbitrageCluster[];
}

export interface MfNavPoint {
  date: string;
  nav: number | string;
}

export class MultiAssetOpportunityRadar {
  private static instance: MultiAssetOpportunityRadar | null = null;
  private d1Repo = D1RevenueRepository.getInstance();
  private navCache = new Map<string, { fetchedAt: number; payload: MutualFundResearchSnapshot }>();

  public static getInstance(): MultiAssetOpportunityRadar {
    if (!MultiAssetOpportunityRadar.instance) {
      MultiAssetOpportunityRadar.instance = new MultiAssetOpportunityRadar();
    }
    return MultiAssetOpportunityRadar.instance;
  }

  public static resetInstance(): void {
    MultiAssetOpportunityRadar.instance = null;
  }

  /**
   * Computes deterministic return, annualized volatility, max drawdown, and risk-adjusted
   * ratio on NAV history points (oldest->newest or newest->oldest supported).
   */
  public analyzeMutualFundSeries(
    schemeCode: string,
    schemeName: string,
    navPoints: MfNavPoint[],
    category: MutualFundResearchSnapshot['category'] = 'INDEX_ETF'
  ): MutualFundResearchSnapshot {
    if (!Array.isArray(navPoints) || navPoints.length < 2) {
      throw new Error('INSUFFICIENT_NAV_DATA: At least 2 NAV observations required for deterministic analytics.');
    }

    const parsed = navPoints
      .map(p => ({ date: String(p.date), nav: Number(p.nav) }))
      .filter(p => Number.isFinite(p.nav) && p.nav > 0);
    if (parsed.length < 2) {
      throw new Error('INSUFFICIENT_VALID_NAVS: Valid positive NAV values required.');
    }

    // mfapi.in returns newest-first (DD-MM-YYYY); normalize chronological order if reversed
    const parseD = (d: string): number => {
      const m = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (m) return Date.parse(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
      const ms = Date.parse(d);
      return Number.isFinite(ms) ? ms : 0;
    };
    const ordered = [...parsed].sort((a, b) => parseD(a.date) - parseD(b.date));

    const first = ordered[0].nav;
    const latest = ordered[ordered.length - 1];
    const periodReturnPercent = Number((((latest.nav - first) / first) * 100).toFixed(2));

    const dailyReturns: number[] = [];
    let peak = ordered[0].nav;
    let maxDrawdown = 0;

    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1].nav;
      const curr = ordered[i].nav;
      dailyReturns.push((curr - prev) / prev);
      if (curr > peak) peak = curr;
      const dd = (peak - curr) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const variance =
      dailyReturns.length > 1
        ? dailyReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1)
        : 0;
    const dailyVol = Math.sqrt(variance);
    const annualizedVolatilityPercent = Number((dailyVol * Math.sqrt(252) * 100).toFixed(2));
    const maxDrawdownPercent = Number((maxDrawdown * 100).toFixed(2));
    const riskAdjustedRatio =
      annualizedVolatilityPercent > 0
        ? Number(((mean * 252 * 100) / annualizedVolatilityPercent).toFixed(3))
        : 0;

    return {
      schemeCode,
      schemeName,
      category,
      observationsCount: ordered.length,
      latestNav: Number(latest.nav.toFixed(4)),
      latestDate: latest.date,
      periodReturnPercent,
      annualizedVolatilityPercent,
      maxDrawdownPercent,
      riskAdjustedRatio,
      sebiComplianceMode: SEBI_COMPLIANCE_MODE,
      disclaimer: 'Educational historical NAV analytics only. Not personalized investment advice or SEBI IA recommendation.'
    };
  }

  /**
   * Live free public fetch from https://api.mfapi.in/mf/{schemeCode} with 1-hour cache & bounded timeout.
   */
  public async fetchAndAnalyzeMutualFund(
    schemeCode: string,
    fetchFn: typeof fetch = fetch,
    lookbackObservations: number = 90
  ): Promise<MutualFundResearchSnapshot> {
    const cached = this.navCache.get(schemeCode);
    if (cached && Date.now() - cached.fetchedAt < 3600 * 1000) {
      return cached.payload;
    }

    const res = await fetchFn(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      throw new Error(`MFAPI_FETCH_FAILED: HTTP ${res.status}`);
    }
    const json = (await res.json()) as any;
    const metaName = json?.meta?.scheme_name || `Scheme ${schemeCode}`;
    const rawData: MfNavPoint[] = Array.isArray(json?.data) ? json.data.slice(0, lookbackObservations) : [];
    const snapshot = this.analyzeMutualFundSeries(schemeCode, metaName, rawData);
    this.navCache.set(schemeCode, { fetchedAt: Date.now(), payload: snapshot });
    return snapshot;
  }

  /**
   * Sovereign Gold Bond (SGB) vs Spot Gold Bullion parity & tax/coupon spread calculator.
   */
  public calculateSgbVsBullionParity(params: {
    trancheLabel: string;
    sgbMarketPricePerGramINR: number;
    spotGoldPricePerGramINR: number;
    yearsToMaturity: number;
    annualInterestPercent?: number;
  }): SgbBullionParitySnapshot {
    const {
      trancheLabel,
      sgbMarketPricePerGramINR,
      spotGoldPricePerGramINR,
      yearsToMaturity,
      annualInterestPercent = 2.5
    } = params;
    if (sgbMarketPricePerGramINR <= 0 || spotGoldPricePerGramINR <= 0 || yearsToMaturity <= 0) {
      throw new Error('INVALID_PARITY_INPUTS: Prices and yearsToMaturity must be positive numbers.');
    }
    const discountToSpotPercent = Number(
      (((spotGoldPricePerGramINR - sgbMarketPricePerGramINR) / spotGoldPricePerGramINR) * 100).toFixed(2)
    );
    const annualizedDiscountYield = discountToSpotPercent / yearsToMaturity;
    const impliedEffectiveYieldAdvantagePercent = Number((annualizedDiscountYield + annualInterestPercent).toFixed(2));

    return {
      trancheLabel,
      sgbMarketPricePerGramINR,
      spotGoldPricePerGramINR,
      annualInterestPercent,
      yearsToMaturity,
      discountToSpotPercent,
      impliedEffectiveYieldAdvantagePercent,
      sebiComplianceMode: SEBI_COMPLIANCE_MODE,
      disclaimer: 'Educational Sovereign Gold Bond parity calculation only; verify exchange liquidity before any decision.'
    };
  }

  /**
   * RBI G-Sec / Fixed-Income Bond approximate YTM, Macaulay Duration & Modified Duration calculator.
   */
  public calculateBondYtmAndDuration(params: {
    instrumentName: string;
    faceValueINR: number;
    marketPriceINR: number;
    couponRatePercent: number;
    yearsToMaturity: number;
    paymentsPerYear?: number;
  }): BondDurationSnapshot {
    const {
      instrumentName,
      faceValueINR,
      marketPriceINR,
      couponRatePercent,
      yearsToMaturity,
      paymentsPerYear = 2
    } = params;
    if (faceValueINR <= 0 || marketPriceINR <= 0 || yearsToMaturity <= 0) {
      throw new Error('INVALID_BOND_INPUTS: Face value, market price, and maturity must be positive.');
    }

    const annualCoupon = faceValueINR * (couponRatePercent / 100);
    const approxYtm =
      (annualCoupon + (faceValueINR - marketPriceINR) / yearsToMaturity) /
      ((faceValueINR + marketPriceINR) / 2);
    const y = Math.max(0.0001, approxYtm);

    const periods = Math.max(1, Math.round(yearsToMaturity * paymentsPerYear));
    const couponPerPeriod = annualCoupon / paymentsPerYear;
    const ratePerPeriod = y / paymentsPerYear;

    let weightedPv = 0;
    let totalPv = 0;
    for (let t = 1; t <= periods; t++) {
      const cf = t === periods ? couponPerPeriod + faceValueINR : couponPerPeriod;
      const pv = cf / Math.pow(1 + ratePerPeriod, t);
      totalPv += pv;
      weightedPv += (t / paymentsPerYear) * pv;
    }

    const macaulayDurationYears = Number((weightedPv / (totalPv || marketPriceINR)).toFixed(3));
    const modifiedDurationYears = Number((macaulayDurationYears / (1 + ratePerPeriod)).toFixed(3));

    return {
      instrumentName,
      faceValueINR,
      marketPriceINR,
      couponRatePercent,
      yearsToMaturity,
      approxYtmPercent: Number((y * 100).toFixed(2)),
      macaulayDurationYears,
      modifiedDurationYears,
      sebiComplianceMode: SEBI_COMPLIANCE_MODE
    };
  }

  /**
   * Buyer-Request-to-Supply Arbitrage Matcher (Stage I P6):
   * Groups observed defect clusters from `site_audits` and buyer purchase intent from
   * `public_deals` + `demand_signals` + `seo_keywords` into actionable arbitrage clusters.
   */
  public async matchBuyerDemandToSupply(): Promise<ArbitrageCluster[]> {
    const clusters: ArbitrageCluster[] = [];
    const useRemoteD1 = isProduction() && !process.env.VITEST;

    const safeAll = async (table: string, sql: string): Promise<any[]> => {
      try {
        if (useRemoteD1) {
          return await this.d1Repo.query<any>(table, sql, []);
        }
        return getDb().prepare(sql).all() as any[];
      } catch {
        return [];
      }
    };

    // 1. B2B Technical Defect Clusters from real SiteFix audits
    const auditRows = await safeAll(
      'site_audits',
      `SELECT domain, seo_score, checklist_json FROM site_audits WHERE status = 'COMPLETED' ORDER BY created_at DESC LIMIT 50`
    );
    let missingSchemaCount = 0;
    let lowestAuditDomain: string | null = null;
    let lowestAuditScore = 101;
    for (const row of auditRows) {
      const score = Number(row.seo_score ?? 100);
      if (score < lowestAuditScore && row.domain) {
        lowestAuditScore = score;
        lowestAuditDomain = String(row.domain);
      }
      const rawJson = String(row.checklist_json || '').toLowerCase();
      if (rawJson.includes('schema') || rawJson.includes('json-ld') || rawJson.includes('robots')) {
        missingSchemaCount++;
      }
    }
    if (auditRows.length > 0) {
      clusters.push({
        clusterId: 'cluster_b2b_sitefix_technical_defects',
        clusterType: 'B2B_TECHNICAL_DEFECT_CLUSTER',
        lane: 'LANE_B_B2B_SERVICES',
        title: 'SMB Websites with Technical SEO / Schema.org / Crawlability Gaps',
        demandSignalsCount: Math.max(auditRows.length, missingSchemaCount),
        matchedSupplyItemsCount: 1,
        topMatchedSupplySlugOrDomain: lowestAuditDomain,
        topCommissionRatePercent: null,
        priceAdvantageSummary: '₹499 SiteFix Core Technical Fix-Pack vs ₹0 deterministic scan delivery cost',
        actionableOfferPath: '/tools/site-audit'
      });
    }

    // 2. B2C Product Intent Clusters matching `public_deals` + `cuelinks_campaigns`
    const dealRows = await safeAll(
      'public_deals',
      `SELECT d.slug, d.title, d.category, d.current_price_inr, d.reference_price_inr, d.evidence_json, c.payout_rate
       FROM public_deals d
       LEFT JOIN cuelinks_campaigns c ON CAST(c.campaign_id AS TEXT) = CAST(d.affiliate_campaign_id AS TEXT)
       WHERE d.product_verified = 1 AND d.affiliate_verified = 1 AND d.availability = 'IN_STOCK' AND d.current_price_inr > 0
       LIMIT 100`
    );
    const byCategory = new Map<string, any[]>();
    for (const d of dealRows) {
      const cat = String(d.category || 'Consumer Deals');
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(d);
    }

    for (const [category, items] of Array.from(byCategory.entries()).slice(0, 4)) {
      let bestItem: any = items[0];
      let bestDiscount = 0;
      let topRate: number | null = null;
      for (const it of items) {
        const cur = Number(it.current_price_inr || 0);
        const ref = Number(it.reference_price_inr || 0);
        const disc = ref > cur && ref > 0 ? Math.round(((ref - cur) / ref) * 100) : 0;
        let rate: number | null = null;
        try {
          const ev = JSON.parse(it.evidence_json || '{}');
          if (typeof ev.verifiedCommissionRatePercent === 'number' && ev.verifiedCommissionRatePercent > 0) {
            rate = ev.verifiedCommissionRatePercent;
          }
        } catch {}
        if (rate === null && it.payout_rate) {
          const m = String(it.payout_rate).match(/(\d+(?:\.\d+)?)/);
          if (m && Number(m[1]) > 0) rate = Number(m[1]);
        }
        if (disc >= bestDiscount) {
          bestDiscount = disc;
          bestItem = it;
        }
        if (rate !== null && (topRate === null || rate > topRate)) {
          topRate = rate;
        }
      }
      clusters.push({
        clusterId: `cluster_b2c_${category.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        clusterType: 'B2C_PRODUCT_ARBITRAGE_CLUSTER',
        lane: 'LANE_A_AFFILIATE_COMMERCE',
        title: `${category} Verified Buyer Intent & Discount Cluster`,
        demandSignalsCount: items.length,
        matchedSupplyItemsCount: items.length,
        topMatchedSupplySlugOrDomain: bestItem?.slug ? String(bestItem.slug) : null,
        topCommissionRatePercent: topRate,
        priceAdvantageSummary: bestDiscount > 0 ? `Up to ${bestDiscount}% merchant price reduction across ${items.length} verified SKUs` : `${items.length} verified active merchant SKUs`,
        actionableOfferPath: bestItem?.slug ? `/deals/${bestItem.slug}` : '/deals'
      });
    }

    return clusters;
  }

  /**
   * Produces the consolidated SEBI-safe multi-asset financial & arbitrage radar summary
   * for Lane E hydration in `arosControlCenter` and `/owner/today`.
   */
  public async getRadarSummary(_options?: { skipLiveNetwork?: boolean }): Promise<MultiAssetRadarSummary> {
    const arbitrageClusters = await this.matchBuyerDemandToSupply();

    const gsecBench = this.calculateBondYtmAndDuration({
      instrumentName: 'India 10Y G-Sec Benchmark Model',
      faceValueINR: 100,
      marketPriceINR: 100.25,
      couponRatePercent: 7.1,
      yearsToMaturity: 10
    });

    const sgbBench = this.calculateSgbVsBullionParity({
      trancheLabel: 'SGB Secondary Parity Benchmark Model',
      sgbMarketPricePerGramINR: 7650,
      spotGoldPricePerGramINR: 7800,
      yearsToMaturity: 5,
      annualInterestPercent: 2.5
    });

    const researchSnapshots: MultiAssetRadarSummary['researchSnapshots'] = [
      {
        id: 'lane_e_gsec_10y_model',
        assetClass: 'GSEC_DURATION',
        title: gsecBench.instrumentName,
        summaryMetric: `Approx YTM ${gsecBench.approxYtmPercent}% | Mod Duration ${gsecBench.modifiedDurationYears}y`,
        evidenceSource: 'Deterministic RBI G-Sec Bond Formula (Educational Paper Model)',
        sebiComplianceMode: SEBI_COMPLIANCE_MODE
      },
      {
        id: 'lane_e_sgb_parity_model',
        assetClass: 'SGB_BULLION_PARITY',
        title: sgbBench.trancheLabel,
        summaryMetric: `Discount vs Spot ${sgbBench.discountToSpotPercent}% | Effective Advantage ${sgbBench.impliedEffectiveYieldAdvantagePercent}% p.a.`,
        evidenceSource: 'Deterministic Bullion Parity Formula (+2.5% statutory coupon)',
        sebiComplianceMode: SEBI_COMPLIANCE_MODE
      },
      {
        id: 'lane_e_mfapi_nav_scanner',
        assetClass: 'MUTUAL_FUND_ETF',
        title: 'AMFI / MFAPI.in Index ETF Volatility & Drawdown Analyzer',
        summaryMetric: 'Ready for scheme NAV drawdown, Sharpe ratio & rolling volatility research',
        evidenceSource: 'https://api.mfapi.in/mf (Free Public AMFI Feed)',
        sebiComplianceMode: SEBI_COMPLIANCE_MODE
      }
    ];

    arbitrageClusters.push({
      clusterId: 'cluster_lane_e_financial_benchmarks',
      clusterType: 'FINANCIAL_RESEARCH_CLUSTER',
      lane: 'LANE_E_FINANCIAL_INTELLIGENCE',
      title: 'Fixed Income, SGB Bullion Parity & Index ETF Paper Research Models',
      demandSignalsCount: researchSnapshots.length,
      matchedSupplyItemsCount: researchSnapshots.length,
      topMatchedSupplySlugOrDomain: 'api.mfapi.in',
      topCommissionRatePercent: null,
      priceAdvantageSummary: 'Zero-fee deterministic calculators & SEBI-safe educational paper models',
      actionableOfferPath: '/api/v1/public/autonomy-status'
    });

    return {
      generatedAt: new Date().toISOString(),
      sebiComplianceMode: SEBI_COMPLIANCE_MODE,
      personalizedAdviceBlocked: true,
      automatedTradeExecutionBlocked: true,
      trackedBenchmarksCount: researchSnapshots.length,
      researchSnapshots,
      arbitrageClusters
    };
  }
}
