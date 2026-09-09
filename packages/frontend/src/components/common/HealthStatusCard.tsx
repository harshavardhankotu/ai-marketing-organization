import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle2, XCircle, RefreshCw, Server, Globe } from 'lucide-react';

interface HealthData {
  status: string;
  service: string;
}

export const HealthStatusCard: React.FC = () => {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [simulateError, setSimulateError] = useState<boolean>(false);

  const checkHealth = async (forceFail = false) => {
    setLoading(true);
    setError(null);
    const start = performance.now();

    try {
      // If simulating error, call invalid endpoint to demonstrate error recovery
      const endpoint = forceFail ? '/api/non-existent-endpoint' : '/api/health';
      const res = await fetch(endpoint);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to reach backend service`);
      }

      const json = await res.json();
      setData(json);
      setLatency(Math.round(performance.now() - start));
    } catch (err: any) {
      setError(err.message || 'Failed to connect to backend');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth(simulateError);
  }, [simulateError]);

  const env = (import.meta as any).env?.MODE || 'development';

  return (
    <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-md mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-lg ${error ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              System Stability & Backend Health
              <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide border ${
                error 
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' 
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              }`}>
                {error ? 'DISCONNECTED' : 'CONNECTED & VERIFIED'}
              </span>
            </h3>
            <p className="text-xs text-slate-400">Endpoint: <code className="text-cyan-400 font-mono">GET /api/health</code></p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSimulateError(!simulateError);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              simulateError 
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' 
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
          >
            {simulateError ? 'Restore Live Endpoint' : 'Simulate API Outage'}
          </button>

          <button
            onClick={() => checkHealth(simulateError)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Re-verify</span>
          </button>
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-lg bg-slate-850 border border-slate-800">
          <span className="text-slate-400 text-[11px] block">Service Identity</span>
          <div className="font-bold text-white mt-0.5 font-mono">
            {data?.service || (error ? 'Unknown' : 'Connecting...')}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-850 border border-slate-800">
          <span className="text-slate-400 text-[11px] block">Backend Status</span>
          <div className="flex items-center gap-1.5 font-bold mt-0.5">
            {error ? (
              <span className="text-rose-400 flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" /> Error
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> {data?.status || 'Loading...'}
              </span>
            )}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-850 border border-slate-800">
          <span className="text-slate-400 text-[11px] block">App Environment</span>
          <div className="font-bold text-slate-200 mt-0.5 capitalize flex items-center gap-1">
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            {env}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-850 border border-slate-800">
          <span className="text-slate-400 text-[11px] block">Roundtrip Latency</span>
          <div className="font-bold text-cyan-400 mt-0.5 font-mono">
            {latency !== null ? `${latency}ms` : '—'}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <XCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}. Click "Restore Live Endpoint" to recover normal operation.</span>
        </div>
      )}
    </div>
  );
};