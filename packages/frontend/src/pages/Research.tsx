import React, { useState, useEffect } from 'react';
import {
  Search,
  ExternalLink,
  MapPin,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  Clock,
  Shield,
  Lock,
  RefreshCw,
  Globe,
  Database
} from 'lucide-react';
import { api } from '../services/api.js';

interface ResearchProps {
  findings: any[];
  businessId?: string;
  onRefresh?: () => void;
}

export const Research: React.FC<ResearchProps> = ({ findings, businessId, onRefresh }) => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSuccess, setRunSuccess] = useState<string | null>(null);
  const [lockReport, setLockReport] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [autonomyStatus, setAutonomyStatus] = useState<any>(null);
  const [liveDeals, setLiveDeals] = useState<any[]>([]);
  const [readyAudits, setReadyAudits] = useState<any[]>([]);
  const [radarBenchmarks, setRadarBenchmarks] = useState<any[]>([]);

  const loadLocksAndLogs = async () => {
    try {
      const [lockRes, statusRes, dealsRes, readyRes, radarRes] = await Promise.all([
        api.getUniversalLocks().catch(() => ({ data: null })),
        api.getPublicAutonomyStatus().catch(() => null),
        api.getPublicDeals(8).catch(() => null),
        api.getFirstSaleReadyActions().catch(() => null),
        api.getFinancialRadar(false).catch(() => null)
      ]);
      if (lockRes?.data) setLockReport(lockRes.data);
      setAutonomyStatus(statusRes?.data || statusRes || null);
      const dealsList = dealsRes?.deals ?? dealsRes?.data?.deals ?? dealsRes?.data;
      setLiveDeals(Array.isArray(dealsList) ? dealsList : []);
      const auditsList = readyRes?.readyAudits || readyRes?.data?.readyAudits || [];
      setReadyAudits(Array.isArray(auditsList) ? auditsList : []);
      const series = radarRes?.benchmarks || radarRes?.data?.benchmarks || [];
      setRadarBenchmarks(Array.isArray(series) ? series : []);
    } catch {}

    if (businessId) {
      try {
        const logsRes = await api.getResearchLogs(businessId);
        if (logsRes?.data) setAuditLogs(logsRes.data);
      } catch {}
    }
  };

  useEffect(() => {
    loadLocksAndLogs();
  }, [businessId]);

  const handleRunPipeline = async () => {
    if (!businessId) {
      setRunError('No active business selected. Onboard or select a business profile first to store research logs.');
      return;
    }
    setIsRunning(true);
    setRunError(null);
    setRunSuccess(null);

    try {
      const res = await api.runResearchPipeline(businessId);
      if (res.data?.status === 'PAUSED_QUOTA_REACHED') {
        setRunError(res.data.error || 'Research paused: daily search quota reached.');
      } else if (res.data?.status === 'PAUSED_UNCONFIGURED') {
        setRunError(res.data.error || 'Search credentials not configured in environment.');
      } else {
        const providers = (res.data?.providersUsed || []).join(' & ');
        setRunSuccess(`Market research completed via ${providers || 'live search'}. ${res.data?.totalFindingsSaved || 0} real findings verified and logged.`);
        if (onRefresh) onRefresh();
      }
      await loadLocksAndLogs();
    } catch (err: any) {
      setRunError(err.message || 'Failed to execute research pipeline.');
    } finally {
      setIsRunning(false);
    }
  };

  const customSearchStatus = lockReport?.services?.GOOGLE_CUSTOM_SEARCH;
  const geminiStatus = lockReport?.services?.GEMINI_API;
  const ytStatus = autonomyStatus?.youtubeDiscovery;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Search className="w-5 h-5 text-cyan-400" />
            Research, Deal Intel &amp; YouTube Discovery Hub
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Live Tavily/Google discovery, Cuelinks + Dual-Rail catalog health, YouTube product review matching, SiteFix HTML defect audits, and AMFI MFAPI benchmarks.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={loadLocksAndLogs}
            className="p-2.5 rounded-xl text-xs font-medium text-slate-400 bg-slate-800 hover:text-white transition-colors"
            title="Refresh Intelligence Feed"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleRunPipeline}
            disabled={isRunning || !businessId}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isRunning ? 'Querying Live Search...' : 'Run Live Market Research'}
          </button>
        </div>
      </div>

      {/* Live YouTube Discovery, Quota Locks & MFAPI Feed */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              YouTube Review Engine
            </span>
            <span className={`font-mono text-[11px] ${ytStatus?.configured ? 'text-emerald-400' : 'text-amber-300'}`}>
              {ytStatus?.mode || 'TAVILY_FALLBACK'}
            </span>
          </div>
          <div className="text-slate-400 font-mono tabular-nums">
            Cached Reviews: <strong className="text-white">{ytStatus?.cachedReviewsCount ?? 0}</strong>
          </div>
          <p className="text-[11px] text-slate-500">
            Attaches verified Indian tech/product review videos to /deals, /vs/, /best/, and Customer Desk replies.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-blue-400" />
              Search Free-Tier Cap
            </span>
            <span className={`font-mono text-[11px] ${customSearchStatus?.isLocked ? 'text-rose-400' : 'text-emerald-400'}`}>
              {customSearchStatus?.isLocked ? 'LOCKED' : 'ACTIVE'}
            </span>
          </div>
          <div className="text-slate-400 font-mono tabular-nums">
            Today: <strong className="text-white">{customSearchStatus?.requestsCountToday ?? 0}</strong> / {customSearchStatus?.maxFreeDailyRequests ?? 100}
          </div>
          <p className="text-[11px] text-slate-500">Strict zero-overage circuit breaker.</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-purple-400" />
              Gemini Quota Guard
            </span>
            <span className={`font-mono text-[11px] ${geminiStatus?.isLocked ? 'text-rose-400' : 'text-emerald-400'}`}>
              {geminiStatus?.isLocked ? 'LOCKED' : 'ACTIVE'}
            </span>
          </div>
          <div className="text-slate-400 font-mono tabular-nums">
            Today: <strong className="text-white">{geminiStatus?.requestsCountToday ?? 0}</strong> / {geminiStatus?.maxFreeDailyRequests ?? 1500}
          </div>
          <p className="text-[11px] text-slate-500">Zero paid-tier upgrade fallback permitted.</p>
        </div>
      </div>

      {/* Notifications */}
      {runError && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{runError}</span>
        </div>
      )}

      {runSuccess && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{runSuccess}</span>
        </div>
      )}

      {/* Live Monetized Deal & YouTube Review Enrichment Feed */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">
            Live Verified Deals &amp; YouTube Review Attachments ({liveDeals.length})
          </h3>
          <a href="/deals" target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:underline inline-flex items-center gap-1">
            <span>Open Public /deals</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        {liveDeals.length === 0 ? (
          <p className="text-xs text-slate-400">No verified deals currently indexed. Trigger Live Harvest on Overview.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {liveDeals.map((deal: any) => (
              <div key={deal.id} className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-white line-clamp-1">{deal.title}</span>
                  <span className="font-mono tabular-nums text-emerald-400 shrink-0">
                    ₹{Number(deal.dealPriceINR || deal.currentPriceINR || 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  <span>{deal.merchant}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-mono">{deal.affiliateNetwork}</span>
                  {deal.youtubeReview?.videoUrl ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      <a href={deal.youtubeReview.videoUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                        YouTube Review Attached
                      </a>
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="text-slate-500">Pending Video Match</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live Ready SMB Audits (HTML Defects Verified) */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">
            Live SMB Website Defect Research ({readyAudits.length})
          </h3>
          <span className="text-[11px] font-mono text-slate-400">
            Standing Order #8: Healthcare Excluded · Email Required
          </span>
        </div>
        {readyAudits.length === 0 ? (
          <p className="text-xs text-slate-400">
            No reachable non-healthcare SMB audits queued yet. Run a scan in Onboard Business or Trigger 1 Live Harvest Cycle.
          </p>
        ) : (
          <div className="divide-y divide-slate-800 border-t border-slate-800 text-xs">
            {readyAudits.slice(0, 6).map((a: any) => (
              <div key={a.domain} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-white">{a.businessName}</span>
                  <span className="text-slate-400 font-mono ml-2">({a.domain})</span>
                  <div className="text-[11px] text-slate-400">
                    Defects: {a.defectCount} · Perf: {a.performanceScore ?? '—'} · SEO: {a.seoScore ?? '—'} · Contact: {a.matchedContactEmail || '—'}
                  </div>
                </div>
                <a href={a.previewUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline font-medium inline-flex items-center gap-1">
                  <span>Inspect Report</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AMFI Mutual Fund Benchmark Summary */}
      {radarBenchmarks.length > 0 && (
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
          <h3 className="text-sm font-bold text-white">Live AMFI Financial Radar Benchmarks</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            {radarBenchmarks.slice(0, 4).map((b: any, i: number) => (
              <div key={i} className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-slate-400 truncate">{b.name || b.schemeName}</div>
                <div className="font-mono tabular-nums font-bold text-white mt-1">
                  NAV ₹{Number(b.latestNav ?? b.nav ?? 0).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Business Research Findings */}
      {findings.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>Business Search Findings ({findings.length})</span>
            <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> External Search Evidence
            </span>
          </div>

          {findings.map((f: any) => (
            <div key={f.id} className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-white">{f.topic}</h3>
                  <span className="flex items-center gap-1 text-slate-400">
                    <MapPin className="w-3 h-3 text-cyan-400" />
                    {f.market || 'Pan-India'}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-cyan-300">
                  {f.source_type || 'SEARCH_API'} · {f.certainty || 'OBSERVED'}
                </span>
              </div>
              <p className="text-slate-200 leading-relaxed">{f.finding}</p>
              {f.source_url && (
                <a
                  href={f.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Verify Source</span>
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Outbound Search Audit Log */}
      {auditLogs.length > 0 && (
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Outbound Search Audit Trail ({auditLogs.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2 px-3">Timestamp</th>
                  <th className="py-2 px-3">Provider</th>
                  <th className="py-2 px-3">Query</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Results</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 px-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-cyan-400">{log.provider}</td>
                    <td className="py-2 px-3 text-white max-w-xs truncate">{log.query_text}</td>
                    <td className="py-2 px-3 font-mono text-[11px]">{log.status_code}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{log.results_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};