import React, { useState, useEffect, useRef } from 'react';
import { 
  FlaskConical, 
  CheckCircle2, 
  XCircle, 
  TrendingUp, 
  AlertCircle, 
  Sparkles,
  ArrowRight,
  RefreshCw
} from 'lucide-react';
import { api } from '../services/api.js';

interface ExperimentsProps {
  experiments: any[];
}

export const Experiments: React.FC<ExperimentsProps> = ({ experiments: propExperiments }) => {
  const [liveExperiments, setLiveExperiments] = useState<any[]>(propExperiments || []);
  const [banditData, setBanditData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(!propExperiments || propExperiments.length === 0);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  // Sector intelligence bandit allocation on mount
  useEffect(() => {
    let active = true;
    api.getPublicAutonomyStatus().then(res => {
      if (active && res.data?.sectorIntelligence) {
        setBanditData(res.data.sectorIntelligence);
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Sync prop or fetch experiments with shared request generation guard
  const fetchExperiments = () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    api.getExperiments()
      .then(res => {
        if (reqId === reqIdRef.current) {
          setLiveExperiments(Array.isArray(res.data) ? res.data : []);
        }
      })
      .catch(err => {
        if (reqId === reqIdRef.current) {
          setError(err?.message || 'Could not fetch experiments.');
        }
      })
      .finally(() => {
        if (reqId === reqIdRef.current) {
          setLoading(false);
        }
      });
  };

  useEffect(() => {
    if (propExperiments && propExperiments.length > 0) {
      ++reqIdRef.current;
      setLiveExperiments(propExperiments);
      setLoading(false);
      setError(null);
    } else {
      fetchExperiments();
    }
    return () => {
      ++reqIdRef.current;
    };
  }, [propExperiments]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-cyan-400" />
          Marketing Hypothesis & Split-Testing Lab
        </h2>
        <p className="text-slate-400 text-xs mt-1">
          Operated by Experiment Strategists & Multi-Armed Bandit Exploration. The system never declares success without mathematical significance.
        </p>
      </div>

      {/* Live Sector Bandit Allocation Lab */}
      {banditData && (
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Multi-Sector Exploration vs Exploitation Bandit
            </h3>
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
              Live Bayesian Bandit
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {Object.entries(banditData).map(([sector, info]: [string, any]) => (
              <div key={sector} className="p-3 bg-slate-950/70 rounded-lg border border-slate-800">
                <span className="text-[11px] font-bold text-slate-300 block truncate">{sector}</span>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-base font-bold text-emerald-400 font-mono">
                    {typeof info?.winRate === 'number' ? `${(info.winRate * 100).toFixed(1)}%` : 'Active'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {info?.trialsCount ?? info?.impressions ?? 'Evolving'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Experiments Feed */}
      <div className="space-y-4">
        {loading ? (
          <div className="p-12 text-center rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
            <h3 className="text-sm font-bold text-white">Loading Experiments...</h3>
          </div>
        ) : error ? (
          <div className="p-12 text-center rounded-2xl bg-slate-900/60 border border-rose-500/30 space-y-3">
            <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
            <h3 className="text-sm font-bold text-white">Error Loading Experiments</h3>
            <p className="text-slate-400 text-xs">{error}</p>
            <button
              onClick={fetchExperiments}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold"
            >
              Retry
            </button>
          </div>
        ) : liveExperiments.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <FlaskConical className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-sm font-bold text-white">No Static Experiments Required</h3>
            <p className="text-slate-400 text-xs max-w-sm mx-auto">
              Dynamic multi-armed bandit optimization runs autonomously across Cuelinks and dual-rail catalog routes.
            </p>
          </div>
        ) : (
          liveExperiments.map((exp: any) => (
            <div key={exp.id} className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-white">{exp.title}</h3>
                  <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-400">
                    {exp.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-400">Target Metric: <strong className="text-slate-200">{exp.target_metric}</strong></span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-400">Confidence: <strong className="text-cyan-400">{exp.statistical_confidence}%</strong></span>
                </div>
              </div>

              <p className="text-slate-300 text-xs">{exp.hypothesis}</p>

              {/* Split Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-3.5 rounded-lg bg-slate-800/40 border border-slate-800">
                  <span className="text-slate-500 text-[10px] uppercase font-bold block mb-1">Baseline Creative (Control)</span>
                  <p className="text-slate-300 font-medium">{exp.baseline}</p>
                  {exp.metrics && (
                    <div className="mt-3 flex items-center justify-between text-slate-400 text-[11px] pt-2 border-t border-slate-700/40">
                      <span>Samples: <strong className="text-slate-200">{exp.metrics.baselineSamples}</strong></span>
                      <span>Conversions: <strong className="text-slate-200">{exp.metrics.baselineConversions}</strong></span>
                      <span>CR: <strong className="text-slate-200">{((exp.metrics.baselineConversions / (exp.metrics.baselineSamples || 1)) * 100).toFixed(1)}%</strong></span>
                    </div>
                  )}
                </div>

                <div className="p-3.5 rounded-lg bg-cyan-950/20 border border-cyan-500/30">
                  <span className="text-cyan-400 text-[10px] uppercase font-bold block mb-1">Treatment Creative (Variation)</span>
                  <p className="text-cyan-200 font-medium">{exp.treatment}</p>
                  {exp.metrics && (
                    <div className="mt-3 flex items-center justify-between text-cyan-300 text-[11px] pt-2 border-t border-cyan-800/40">
                      <span>Samples: <strong>{exp.metrics.treatmentSamples}</strong></span>
                      <span>Conversions: <strong>{exp.metrics.treatmentConversions}</strong></span>
                      <span>CR: <strong className="text-emerald-400 font-bold">{((exp.metrics.treatmentConversions / (exp.metrics.treatmentSamples || 1)) * 100).toFixed(1)}%</strong></span>
                    </div>
                  )}
                </div>
              </div>

              {/* Decision Summary */}
              {exp.decision_summary && (
                <div className="p-3.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs text-emerald-300 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block text-emerald-200">Statistical Validation & Scale Decision:</span>
                    <p className="mt-0.5">{exp.decision_summary}</p>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
