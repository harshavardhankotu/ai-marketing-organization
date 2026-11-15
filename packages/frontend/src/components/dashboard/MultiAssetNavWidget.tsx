import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ArrowUpRight, AlertCircle } from 'lucide-react';
import { api } from '../../services/api.js';

export interface RadarNavFund {
  schemeCode: string;
  benchmarkLabel?: string;
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
}

export interface MultiAssetRadarPayload {
  generatedAt?: string;
  sebiComplianceMode?: string;
  trackedBenchmarksCount?: number;
  navFunds?: RadarNavFund[];
  researchSnapshots?: Array<{
    id: string;
    assetClass: string;
    title: string;
    summaryMetric: string;
    evidenceSource: string;
    dataFreshness?: string;
    latestObservationDate?: string;
  }>;
}

type CategoryFilter = 'ALL' | 'INDEX_ETF' | 'GOLD_ETF' | 'DEBT_LIQUID';

const BENCHMARK_BY_SCHEME_CODE: Record<string, { label: string; category: RadarNavFund['category']; categoryLabel: string }> = {
  '120716': { label: 'Nifty 50', category: 'INDEX_ETF', categoryLabel: 'Equity Index' },
  '120684': { label: 'Nifty Next 50', category: 'INDEX_ETF', categoryLabel: 'Equity Index' },
  '120685': { label: 'Gold ETF', category: 'GOLD_ETF', categoryLabel: 'Gold' },
  '149780': { label: 'Silver ETF', category: 'GOLD_ETF', categoryLabel: 'Silver' },
  '119833': { label: 'SBI 10Y Gilt', category: 'DEBT_LIQUID', categoryLabel: 'G-Sec Debt' },
  '131061': { label: '10Y Gilt', category: 'DEBT_LIQUID', categoryLabel: 'G-Sec Debt' }
};

const TARGET_SCHEME_ORDER = ['120716', '120684', '120685', '149780', '119833', '131061'];

function parseNavFundsFromSummary(summary?: MultiAssetRadarPayload | null): RadarNavFund[] {
  if (!summary) return [];

  if (Array.isArray(summary.navFunds) && summary.navFunds.length > 0) {
    return [...summary.navFunds].sort(
      (a, b) =>
        (TARGET_SCHEME_ORDER.indexOf(a.schemeCode) === -1 ? 99 : TARGET_SCHEME_ORDER.indexOf(a.schemeCode)) -
        (TARGET_SCHEME_ORDER.indexOf(b.schemeCode) === -1 ? 99 : TARGET_SCHEME_ORDER.indexOf(b.schemeCode))
    );
  }

  // Backward-compatible extraction from `researchSnapshots` if older summary shape is returned
  const snapshots = Array.isArray(summary.researchSnapshots) ? summary.researchSnapshots : [];
  const extracted: RadarNavFund[] = [];

  for (const snap of snapshots) {
    if (!snap.id?.startsWith('lane_e_mfapi_') || snap.id === 'lane_e_mfapi_nav_scanner') {
      continue;
    }
    const schemeCode = snap.id.replace('lane_e_mfapi_', '').trim();
    const meta = BENCHMARK_BY_SCHEME_CODE[schemeCode];
    const metricText = snap.summaryMetric || '';

    const navMatch = metricText.match(/Latest NAV\s*₹?\s*([\d.,]+)\s*\(([^)]+)\)/i);
    const retMatch = metricText.match(/Period Return\s*([+-]?[\d.]+)%/i);
    const volMatch = metricText.match(/Ann Vol\s*([+-]?[\d.]+)%/i);
    const ddMatch = metricText.match(/MaxDD\s*([+-]?[\d.]+)%/i);

    if (!navMatch) continue;
    const latestNav = Number(navMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(latestNav) || latestNav <= 0) continue;

    extracted.push({
      schemeCode,
      benchmarkLabel: meta?.label || `Scheme ${schemeCode}`,
      schemeName: snap.title,
      category: meta?.category || 'INDEX_ETF',
      observationsCount: 90,
      latestNav,
      latestDate: snap.latestObservationDate || navMatch[2] || '',
      periodReturnPercent: retMatch ? Number(retMatch[1]) : 0,
      annualizedVolatilityPercent: volMatch ? Number(volMatch[1]) : 0,
      maxDrawdownPercent: ddMatch ? Number(ddMatch[1]) : 0,
      riskAdjustedRatio: 0,
      dataFreshness: (snap.dataFreshness as RadarNavFund['dataFreshness']) || 'LIVE_DATED_PROVIDER_SERIES',
      latestObservationDate: snap.latestObservationDate || navMatch[2]
    });
  }

  return extracted.sort(
    (a, b) =>
      (TARGET_SCHEME_ORDER.indexOf(a.schemeCode) === -1 ? 99 : TARGET_SCHEME_ORDER.indexOf(a.schemeCode)) -
      (TARGET_SCHEME_ORDER.indexOf(b.schemeCode) === -1 ? 99 : TARGET_SCHEME_ORDER.indexOf(b.schemeCode))
  );
}

function formatNavINR(val: number): string {
  return `₹${val.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  })}`;
}

function formatSignedPercent(val: number): string {
  const prefix = val > 0 ? '+' : '';
  return `${prefix}${val.toFixed(2)}%`;
}

interface MultiAssetNavWidgetProps {
  initialRadarSummary?: MultiAssetRadarPayload | null;
}

export const MultiAssetNavWidget: React.FC<MultiAssetNavWidgetProps> = ({ initialRadarSummary }) => {
  const [radarSummary, setRadarSummary] = useState<MultiAssetRadarPayload | null>(initialRadarSummary || null);
  const [loading, setLoading] = useState<boolean>(!initialRadarSummary);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');

  const fetchRadarData = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else if (!radarSummary) {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await api.getFinancialRadar(forceRefresh);
      const payload = res?.data || res?.financialAndArbitrageRadar || null;
      if (payload) {
        setRadarSummary(payload);
        return;
      }
      throw new Error('Multi-asset radar response was empty.');
    } catch (primaryErr: any) {
      try {
        const fallback = await api.getPublicAutonomyStatus();
        if (fallback?.financialAndArbitrageRadar) {
          setRadarSummary(fallback.financialAndArbitrageRadar);
          return;
        }
      } catch {}
      setError(primaryErr?.message || 'Unable to load multi-asset NAV data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (initialRadarSummary) {
      setRadarSummary(initialRadarSummary);
      setLoading(false);
      return;
    }
    fetchRadarData(false);
  }, [initialRadarSummary]);

  const allNavFunds = useMemo(() => parseNavFundsFromSummary(radarSummary), [radarSummary]);

  const filteredFunds = useMemo(() => {
    if (categoryFilter === 'ALL') return allNavFunds;
    return allNavFunds.filter((f) => f.category === categoryFilter);
  }, [allNavFunds, categoryFilter]);

  const updatedTimestamp = useMemo(() => {
    if (!radarSummary?.generatedAt) return null;
    try {
      return new Date(radarSummary.generatedAt).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return null;
    }
  }, [radarSummary?.generatedAt]);

  return (
    <section
      aria-labelledby="multi-asset-nav-heading"
      className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-5"
    >
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="space-y-1">
          <h3 id="multi-asset-nav-heading" className="text-base font-bold text-white tracking-tight">
            Multi-Asset Benchmark NAVs
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>AMFI Live NAV Feed (api.mfapi.in)</span>
            <span aria-hidden="true">·</span>
            <span>Nifty 50, Nifty Next 50, Gold ETF &amp; 10Y Gilt</span>
            {updatedTimestamp && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-300">Synced {updatedTimestamp}</span>
              </>
            )}
          </div>
        </div>

        {/* Interactive Filter Tabs + Refresh Control */}
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="tablist"
            aria-label="Filter asset benchmarks"
            className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg"
          >
            {(
              [
                { id: 'ALL', label: 'All Funds' },
                { id: 'INDEX_ETF', label: 'Equity Index' },
                { id: 'GOLD_ETF', label: 'Gold ETF' },
                { id: 'DEBT_LIQUID', label: '10Y Gilt' }
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={categoryFilter === tab.id}
                onClick={() => setCategoryFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                  categoryFilter === tab.id
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => fetchRadarData(true)}
            disabled={loading || refreshing}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh NAVs'}</span>
          </button>
        </div>
      </div>

      {/* Loading Skeleton State */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" aria-busy="true" aria-label="Loading benchmark NAV data">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="py-3 border-b border-slate-800 lg:border-b-0 space-y-2.5 animate-pulse">
              <div className="h-3.5 w-24 bg-slate-800 rounded" />
              <div className="h-7 w-28 bg-slate-800 rounded" />
              <div className="h-3 w-full bg-slate-800/80 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && allNavFunds.length === 0 && (
        <div className="py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800">
          <div className="flex items-start gap-2.5 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-200">Unable to load live AMFI NAV observations</p>
              <p className="text-slate-400 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchRadarData(true)}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 whitespace-nowrap shrink-0"
          >
            Retry Fetch
          </button>
        </div>
      )}

      {/* Empty / Offline State when mfapi returned 0 live series */}
      {!loading && !error && allNavFunds.length === 0 && (
        <div className="py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-200">
              Live AMFI NAV observations are currently unavailable
            </p>
            <p className="text-xs text-slate-400">
              No synthetic NAV values are shown. Retry live fetch to pull dated Nifty 50, Nifty Next 50, Gold ETF, and 10Y Gilt series from api.mfapi.in.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchRadarData(true)}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white whitespace-nowrap shrink-0"
          >
            Fetch Live NAVs
          </button>
        </div>
      )}

      {/* Populated NAV Strip + Aligned Risk Metrics Table */}
      {!loading && filteredFunds.length > 0 && (
        <div className="space-y-5">
          {/* 4-Column Flat Benchmark Strip (hairline dividers, no nested box shadows) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 border-b border-slate-800 pb-5">
            {filteredFunds.map((fund) => {
              const meta = BENCHMARK_BY_SCHEME_CODE[fund.schemeCode];
              const label = fund.benchmarkLabel || meta?.label || `Scheme ${fund.schemeCode}`;
              const catLabel = meta?.categoryLabel || fund.category.replace(/_/g, ' ');
              const isPositive = fund.periodReturnPercent >= 0;

              return (
                <div key={fund.schemeCode} className="py-3 sm:py-0 sm:px-4 first:sm:pl-0 last:sm:pr-0 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-300">{label}</span>
                    <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                      #{fund.schemeCode}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-2xl font-bold text-white font-mono tabular-nums tracking-tight">
                      {formatNavINR(fund.latestNav)}
                    </span>
                    <span
                      className={`text-xs font-semibold font-mono tabular-nums ${
                        isPositive ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {formatSignedPercent(fund.periodReturnPercent)}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <span>{catLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{fund.latestDate || fund.latestObservationDate}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* High-Density Risk & Observation Data Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-medium">
                  <th className="py-2.5 pr-4 font-medium">Benchmark &amp; Scheme</th>
                  <th className="py-2.5 px-3 text-right font-medium">Latest NAV</th>
                  <th className="py-2.5 px-3 text-right font-medium">90-Obs Return</th>
                  <th className="py-2.5 px-3 text-right font-medium">Ann. Volatility</th>
                  <th className="py-2.5 px-3 text-right font-medium">Max Drawdown</th>
                  <th className="py-2.5 px-3 text-right font-medium">Risk-Adj Ratio</th>
                  <th className="py-2.5 pl-3 text-right font-medium">NAV Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredFunds.map((fund) => {
                  const meta = BENCHMARK_BY_SCHEME_CODE[fund.schemeCode];
                  const label = fund.benchmarkLabel || meta?.label || `Scheme ${fund.schemeCode}`;
                  const isPositive = fund.periodReturnPercent >= 0;

                  return (
                    <tr key={fund.schemeCode} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="font-semibold text-slate-100">{label}</div>
                        <div className="text-[11px] text-slate-400 truncate max-w-xs" title={fund.schemeName}>
                          {fund.schemeName} · Scheme {fund.schemeCode}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-white whitespace-nowrap">
                        {formatNavINR(fund.latestNav)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                          isPositive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatSignedPercent(fund.periodReturnPercent)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                        {fund.annualizedVolatilityPercent.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-300 whitespace-nowrap">
                        -{Math.abs(fund.maxDrawdownPercent).toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                        {fund.riskAdjustedRatio.toFixed(3)}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        {fund.latestDate || fund.latestObservationDate || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Clean SEBI Compliance Footer */}
      <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>
          SEBI Mode: Educational historical NAV research only · Personalized advice and automated trading blocked
        </span>
        <a
          href="/tools/financial-radar"
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0"
        >
          <span>Full Multi-Asset Radar Report</span>
          <ArrowUpRight className="w-3 h-3" />
        </a>
      </div>
    </section>
  );
};
