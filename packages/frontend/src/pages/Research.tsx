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
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);

  const certaintyColors: Record<string, string> = {
    OBSERVED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    CONFIRMED: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    INFERRED: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    HYPOTHESIZED: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    PREDICTED: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  };

  const loadLocksAndLogs = async () => {
    try {
      const lockRes = await api.getUniversalLocks();
      if (lockRes.data) {
        setLockReport(lockRes.data);
      }
    } catch {}

    if (businessId) {
      setLoadingLogs(true);
      try {
        const logsRes = await api.getResearchLogs(businessId);
        if (logsRes.data) {
          setAuditLogs(logsRes.data);
        }
      } catch {}
      finally {
        setLoadingLogs(false);
      }
    }
  };

  useEffect(() => {
    loadLocksAndLogs();
  }, [businessId]);

  const handleRunPipeline = async () => {
    if (!businessId) {
      setRunError('No active business selected. Please onboard or select a business first.');
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Search className="w-5 h-5 text-cyan-400" />
            Dual-Engine Market Intelligence Hub
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Real external market intelligence powered by Google Custom Search JSON API and Gemini Search Grounding. Zero synthetic data.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={loadLocksAndLogs}
            className="p-2.5 rounded-xl text-xs font-medium text-slate-400 bg-slate-800 hover:text-white transition-colors"
            title="Refresh Lock Status"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleRunPipeline}
            disabled={isRunning || !businessId}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-md shadow-cyan-500/20 disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isRunning ? 'Querying Live Search...' : 'Run Live Market Research'}
          </button>
        </div>
      </div>

      {/* Universal Free-Tier Lock Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Universal Free-Tier Circuit Breakers</span>
          </div>
          <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
            <Lock className="w-3 h-3 text-amber-400" />
            Zero Paid Overages Permitted • Auto-pauses at free daily limit
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Google Custom Search Lock Status */}
          <div className="p-3 rounded-lg bg-slate-850 border border-slate-750 flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs font-bold text-slate-200">Google Custom Search API</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Queries Today: <strong className="text-white">{customSearchStatus?.requestsCountToday ?? 0}</strong> / {customSearchStatus?.maxFreeDailyRequests ?? 100} free limit
              </div>
            </div>
            <div>
              {customSearchStatus?.isLocked ? (
                <span className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                  LOCKED (Quota Reached)
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                  ACTIVE ({customSearchStatus?.remainingFreeRequests ?? 100} left)
                </span>
              )}
            </div>
          </div>

          {/* Gemini API Lock Status */}
          <div className="p-3 rounded-lg bg-slate-850 border border-slate-750 flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-xs font-bold text-slate-200">Gemini Search & Reasoning</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Requests Today: <strong className="text-white">{geminiStatus?.requestsCountToday ?? 0}</strong> / {geminiStatus?.maxFreeDailyRequests ?? 1500} free limit
              </div>
            </div>
            <div>
              {geminiStatus?.isLocked ? (
                <span className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                  LOCKED (Quota Reached)
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                  ACTIVE ({geminiStatus?.remainingFreeRequests ?? 1500} left)
                </span>
              )}
            </div>
          </div>
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

      {/* Findings Content Area */}
      {findings.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center mx-auto text-slate-500">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">No Research Has Been Run Yet</h3>
          <p className="text-slate-400 text-xs max-w-md mx-auto leading-relaxed">
            There are no market research findings in the database for this business. Click <strong>"Run Live Market Research"</strong> to execute real search queries under strict free-tier quota protection.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>Showing {findings.length} verified research finding(s)</span>
            <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Real-time external evidence with audit trails
            </span>
          </div>

          {findings.map((f: any) => (
            <div key={f.id} className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-3 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-white">{f.topic}</h3>
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <MapPin className="w-3 h-3 text-cyan-400" />
                    {f.market || 'Local Market'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-cyan-300 border border-slate-700">
                    {f.source_type || 'GOOGLE_SEARCH_API'}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded border text-xs font-bold ${
                    certaintyColors[f.certainty] || certaintyColors.OBSERVED
                  }`}>
                    {f.certainty || 'OBSERVED'}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-200 leading-relaxed font-medium">
                {f.finding}
              </p>

              {/* Extracted Evidence Box */}
              {f.extracted_evidence && (
                <div className="p-3.5 rounded-lg bg-slate-850 border border-slate-800 text-xs text-slate-400 space-y-1">
                  <span className="text-slate-300 font-semibold block text-[11px]">Real Search Evidence:</span>
                  <p className="italic text-slate-300">"{f.extracted_evidence}"</p>
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 border-t border-slate-800/80">
                <div className="flex items-center gap-3">
                  <span>Source: <strong className="text-slate-400">{f.source}</strong></span>
                  {f.source_url && (
                    <a
                      href={f.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 underline text-[11px]"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Verify URL
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {f.confidence_score && (
                    <span>Confidence: <strong className="text-cyan-400">{(f.confidence_score * 100).toFixed(0)}%</strong></span>
                  )}
                  {f.retrieved_at && (
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(f.retrieved_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Outbound Search Query Audit Log Table */}
      {auditLogs.length > 0 && (
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Outbound Search Audit Trail ({auditLogs.length} logged queries)</h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">Audit Proof Invariant</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2 px-3 font-semibold">Timestamp</th>
                  <th className="py-2 px-3 font-semibold">Provider</th>
                  <th className="py-2 px-3 font-semibold">Query</th>
                  <th className="py-2 px-3 font-semibold">Status</th>
                  <th className="py-2 px-3 font-semibold">Cached</th>
                  <th className="py-2 px-3 font-semibold">Results</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-850/50">
                    <td className="py-2 px-3 text-slate-500 text-[11px] whitespace-nowrap">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-cyan-400">
                      {log.provider}
                    </td>
                    <td className="py-2 px-3 font-medium text-white max-w-xs truncate" title={log.query_text}>
                      {log.query_text}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                        log.status_code === 200 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {log.status_code}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-[11px] text-slate-400">
                      {log.is_cached ? '48h Cache' : 'Live Outbound'}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-300">
                      {log.results_count} items
                    </td>
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