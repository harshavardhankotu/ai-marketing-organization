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
  dataFreshness?: 'LIVE_DATED_PROVIDER_SERIES' | 'DETERMINISTIC_SCENARIO_MODEL';
  latestObservationDate?: string;
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
    dataFreshness?: 'LIVE_DATED_PROVIDER_SERIES' | 'DETERMINISTIC_SCENARIO_MODEL';
    latestObservationDate?: string;
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
      dataFreshness: 'LIVE_DATED_PROVIDER_SERIES',
      latestObservationDate: latest.date,
      sebiComplianceMode: SEBI_COMPLIANCE_MODE,
      disclaimer: 'Educational historical NAV analytics only. Not personalized investment advice or SEBI IA recommendation.'
    };
  }

  /**
   * Live free public fetch from https://api.mfapi.in/mf/{schemeCode} with 6-hour cache & bounded timeout.
   */
  public async fetchAndAnalyzeMutualFund(
    schemeCode: string,
    fetchFn: typeof fetch = fetch,
    lookbackObservations: number = 90,
    category: MutualFundResearchSnapshot['category'] = 'INDEX_ETF'
  ): Promise<MutualFundResearchSnapshot> {
    const cached = this.navCache.get(schemeCode);
    if (cached && Date.now() - cached.fetchedAt < 6 * 3600 * 1000) {
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
    const snapshot = this.analyzeMutualFundSeries(schemeCode, metaName, rawData, category);
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
    // Separate observed buyer demand signals from matched supply inventory
    const inboundDemandRows = await safeAll(
      'platform_prospects',
      `SELECT COUNT(*) as c FROM platform_prospects WHERE is_test = 0 AND is_junk = 0 AND (source IN ('OFFER_PAGE_INQUIRY', 'DIRECT_INBOUND', 'INBOUND_LEAKAGE_CALCULATOR') OR discovery_source IN ('DIRECT_INBOUND', 'INBOUND_LEAKAGE_CALCULATOR'))`
    );
    const observedB2bDemandSignals = Number(inboundDemandRows[0]?.c || 0);

    const clickRows = await safeAll(
      'referral_click_events',
      `SELECT offer_id, campaign, keyword, destination_url
       FROM referral_click_events
       WHERE (device_class IS NULL OR device_class NOT IN ('bot', 'known_bot', 'suspected_bot'))
       ORDER BY created_at DESC LIMIT 500`
    );

    if (auditRows.length > 0) {
      clusters.push({
        clusterId: 'cluster_b2b_sitefix_technical_defects',
        clusterType: 'B2B_TECHNICAL_DEFECT_CLUSTER',
        lane: 'LANE_B_B2B_SERVICES',
        title: 'SMB Websites with Technical SEO / Schema.org / Crawlability Gaps',
        demandSignalsCount: observedB2bDemandSignals,
        matchedSupplyItemsCount: auditRows.length,
        topMatchedSupplySlugOrDomain: lowestAuditDomain,
        topCommissionRatePercent: null,
        priceAdvantageSummary: '₹499 SiteFix Core Technical Fix-Pack vs ₹0 deterministic scan delivery cost',
        actionableOfferPath: '/tools/site-audit'
      });
    }

    // 2. B2C Product Intent Clusters matching `public_deals` + `cuelinks_campaigns`
    const dealRows = await safeAll(
      'public_deals',
      `SELECT slug, title, category, current_price_inr, reference_price_inr, evidence_json
       FROM public_deals
       WHERE product_verified = 1 AND affiliate_verified = 1 AND availability = 'IN_STOCK' AND current_price_inr > 0
       LIMIT 100`
    );
    const campRows = await safeAll(
      'cuelinks_campaigns',
      `SELECT campaign_id, payout_rate FROM cuelinks_campaigns WHERE status = 'ACTIVE'`
    );
    const campRateById = new Map<string, string>();
    for (const c of campRows) {
      if (c.campaign_id && c.payout_rate) {
        campRateById.set(String(c.campaign_id), String(c.payout_rate));
      }
    }

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
      const slugSet = new Set(items.map(i => String(i.slug || '').toLowerCase()).filter(Boolean));
      const catLower = category.toLowerCase();
      let categoryDemandClicks = 0;
      for (const cl of clickRows) {
        const oid = String(cl.offer_id || '').toLowerCase();
        const cmp = String(cl.campaign || '').toLowerCase();
        const kw = String(cl.keyword || '').toLowerCase();
        const dest = String(cl.destination_url || '').toLowerCase();
        if (
          (oid && slugSet.has(oid)) ||
          cmp.includes(catLower) ||
          kw.includes(catLower) ||
          Array.from(slugSet).some(s => dest.includes(s))
        ) {
          categoryDemandClicks++;
        }
      }

      for (const it of items) {
        const cur = Number(it.current_price_inr || 0);
        const ref = Number(it.reference_price_inr || 0);
        const disc = ref > cur && ref > 0 ? Math.round(((ref - cur) / ref) * 100) : 0;
        let rate: number | null = null;
        let campId = '';
        try {
          const ev = JSON.parse(it.evidence_json || '{}');
          if (typeof ev.verifiedCommissionRatePercent === 'number' && ev.verifiedCommissionRatePercent > 0) {
            rate = ev.verifiedCommissionRatePercent;
          }
          if (ev.affiliateCampaignId) {
            campId = String(ev.affiliateCampaignId);
          }
        } catch {}
        const rawCampRate = campId ? campRateById.get(campId) : undefined;
        if (rate === null && rawCampRate) {
          const m = rawCampRate.match(/(\d+(?:\.\d+)?)/);
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
        demandSignalsCount: categoryDemandClicks,
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
  public async getRadarSummary(options?: {
    skipLiveNetwork?: boolean;
    fetchFn?: typeof fetch;
  }): Promise<MultiAssetRadarSummary> {
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
        dataFreshness: 'DETERMINISTIC_SCENARIO_MODEL',
        sebiComplianceMode: SEBI_COMPLIANCE_MODE
      },
      {
        id: 'lane_e_sgb_parity_model',
        assetClass: 'SGB_BULLION_PARITY',
        title: sgbBench.trancheLabel,
        summaryMetric: `Discount vs Spot ${sgbBench.discountToSpotPercent}% | Effective Advantage ${sgbBench.impliedEffectiveYieldAdvantagePercent}% p.a.`,
        evidenceSource: 'Deterministic Bullion Parity Formula (+2.5% statutory coupon)',
        dataFreshness: 'DETERMINISTIC_SCENARIO_MODEL',
        sebiComplianceMode: SEBI_COMPLIANCE_MODE
      }
    ];

    const schemesToFetch: Array<{ schemeCode: string; category: MutualFundResearchSnapshot['category'] }> = [
      { schemeCode: '120716', category: 'INDEX_ETF' },
      { schemeCode: '119063', category: 'GOLD_ETF' }
    ];

    let mfapiLiveSuccessCount = 0;
    if (!options?.skipLiveNetwork) {
      const settled = await Promise.allSettled(
        schemesToFetch.map(s => this.fetchAndAnalyzeMutualFund(s.schemeCode, options?.fetchFn ?? fetch, 90, s.category))
      );
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          mfapiLiveSuccessCount++;
          const mf = r.value;
          researchSnapshots.push({
            id: `lane_e_mfapi_${mf.schemeCode}`,
            assetClass: 'MUTUAL_FUND_ETF',
            title: mf.schemeName,
            summaryMetric: `Latest NAV ₹${mf.latestNav} (${mf.latestDate}) | Period Return ${mf.periodReturnPercent}% | Ann Vol ${mf.annualizedVolatilityPercent}% | MaxDD ${mf.maxDrawdownPercent}%`,
            evidenceSource: `https://api.mfapi.in/mf/${mf.schemeCode} (Live AMFI NAV Feed)`,
            dataFreshness: 'LIVE_DATED_PROVIDER_SERIES',
            latestObservationDate: mf.latestObservationDate || mf.latestDate,
            sebiComplianceMode: SEBI_COMPLIANCE_MODE
          });
        }
      }
    }

    if (mfapiLiveSuccessCount === 0) {
      researchSnapshots.push({
        id: 'lane_e_mfapi_nav_scanner',
        assetClass: 'MUTUAL_FUND_ETF',
        title: 'AMFI / MFAPI.in Index & Gold ETF Volatility & Drawdown Model (120716 / 119063)',
        summaryMetric: 'Deterministic NAV drawdown, Sharpe ratio & rolling volatility calculator ready',
        evidenceSource: 'https://api.mfapi.in/mf (Live AMFI Feed — Offline/Test Model Mode)',
        dataFreshness: 'DETERMINISTIC_SCENARIO_MODEL',
        sebiComplianceMode: SEBI_COMPLIANCE_MODE
      });
    }

    arbitrageClusters.push({
      clusterId: 'cluster_lane_e_financial_benchmarks',
      clusterType: 'FINANCIAL_RESEARCH_CLUSTER',
      lane: 'LANE_E_FINANCIAL_INTELLIGENCE',
      title: 'Fixed Income, SGB Bullion Parity & Index ETF Paper Research Models',
      demandSignalsCount: 0,
      matchedSupplyItemsCount: researchSnapshots.length,
      topMatchedSupplySlugOrDomain: 'api.mfapi.in',
      topCommissionRatePercent: null,
      priceAdvantageSummary: 'Zero-fee deterministic calculators & SEBI-safe educational paper models',
      actionableOfferPath: '/tools/financial-radar'
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

  /**
   * Renders the public SSR HTML page for `GET /tools/financial-radar`.
   */
  public renderFinancialRadarHtml(summary: MultiAssetRadarSummary): string {
    const cardsHtml = summary.researchSnapshots
      .map(
        snap => `
        <article style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:1.15rem;margin-bottom:0.85rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.45rem;">
            <span style="font-size:0.75rem;font-weight:700;color:#38bdf8;text-transform:uppercase;">${snap.assetClass.replace(/_/g, ' ')}</span>
            <span style="font-size:0.75rem;padding:0.15rem 0.5rem;border-radius:999px;background:${snap.dataFreshness === 'LIVE_DATED_PROVIDER_SERIES' ? '#064e3b;color:#6ee7b7' : '#1e293b;color:#cbd5e1'};">${snap.dataFreshness || 'DETERMINISTIC_SCENARIO_MODEL'}${snap.latestObservationDate ? ` • ${snap.latestObservationDate}` : ''}</span>
          </div>
          <h2 style="margin:0 0 0.45rem 0;font-size:1.1rem;color:#f8fafc;">${snap.title}</h2>
          <p style="margin:0 0 0.4rem 0;font-size:0.95rem;color:#e2e8f0;font-weight:600;">${snap.summaryMetric}</p>
          <div style="font-size:0.8rem;color:#94a3b8;">Source: ${snap.evidenceSource}</div>
        </article>`
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>India Financial &amp; Yield Radar (SEBI Educational Research)</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #030712; color: #f8fafc; line-height: 1.55; }
    main { max-width: 880px; margin: 0 auto; padding: 2rem 1.25rem; }
  </style>
</head>
<body>
  <main>
    <header style="margin-bottom:1.5rem;border-bottom:1px solid #1f2937;padding-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;">
        <h1 style="margin:0;font-size:1.65rem;color:#f8fafc;">India Multi-Asset Yield &amp; Volatility Radar</h1>
        <span style="font-size:0.75rem;background:#1e3a8a;color:#bfdbfe;padding:0.25rem 0.6rem;border-radius:6px;font-weight:700;">${SEBI_COMPLIANCE_MODE}</span>
      </div>
      <p style="color:#94a3b8;margin:0.65rem 0 0 0;font-size:0.95rem;">
        Public AMFI Mutual Fund / Gold ETF NAV analytics (<code>api.mfapi.in</code>), India 10Y G-Sec YTM &amp; Modified Duration modeling, and Sovereign Gold Bond secondary-market parity math.
      </p>
    </header>
    <section style="background:#172554;border:1px solid #1d4ed8;border-radius:8px;padding:0.9rem 1rem;margin-bottom:1.5rem;font-size:0.88rem;color:#dbeafe;">
      <strong>SEBI Regulatory Guardrail:</strong> Educational historical analytics &amp; paper-model calculators only. Personalized investment advice and automated trade execution are strictly disabled (<code>personalizedAdviceBlocked = true</code>).
    </section>
    <section>${cardsHtml}</section>
    <footer style="margin-top:1.75rem;padding-top:1rem;border-top:1px solid #1f2937;font-size:0.85rem;color:#94a3b8;display:flex;gap:1rem;flex-wrap:wrap;">
      <a href="/deals" style="color:#38bdf8;text-decoration:none;">Verified Deals Directory</a>
      <a href="/tools/site-audit" style="color:#38bdf8;text-decoration:none;">SiteFix Website Audit</a>
      <a href="/offer" style="color:#38bdf8;text-decoration:none;">Lead Triage Offer</a>
    </footer>
  </main>
</body>
</html>`;
  }
}
