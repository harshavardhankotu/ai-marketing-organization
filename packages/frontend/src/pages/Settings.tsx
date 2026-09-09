import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  Cpu, 
  ShieldCheck, 
  Link, 
  AlertTriangle,
  CheckCircle2,
  Building,
  Key
} from 'lucide-react';
import { formatINR } from '@ai-marketing/shared';

interface SettingsProps {
  business: any;
  quota: any;
  integrations: any[];
}

export const Settings: React.FC<SettingsProps> = ({ business, quota, integrations }) => {
  const [autonomyMode, setAutonomyMode] = useState<string>(business?.autonomy_mode || 'ASSISTED');

  const sampleIntegrations = integrations.length > 0 ? integrations : [
    { provider: 'WHATSAPP', status: 'CONNECTED', mode: 'SANDBOX', details: 'WhatsApp Business Cloud API Sandbox Mode' },
    { provider: 'META_ADS', status: 'CONNECTED', mode: 'SANDBOX', details: 'Meta Ads Sandbox Ad Account' },
    { provider: 'GOOGLE_BUSINESS_PROFILE', status: 'CONNECTED', mode: 'SANDBOX', details: 'Google Business Profile Local Sandbox' },
    { provider: 'EMAIL', status: 'NOT_CONNECTED', mode: 'SANDBOX', details: 'SMTP Unconfigured' }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-cyan-400" />
          Settings & Infrastructure Governance
        </h2>
        <p className="text-slate-400 text-xs mt-1">
          Configure business boundaries, autonomy permissions, integrations, and monitor free-tier capacity.
        </p>
      </div>

      {/* Free-Tier Quota Health */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4 shadow-sm">
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          Google Gemini Free-Tier Quota Observability
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-lg bg-slate-850 border border-slate-800">
            <span className="text-slate-400 text-xs block mb-1">Daily Model Requests</span>
            <div className="text-xl font-bold text-white">
              {quota?.geminiRequestsToday ?? 14} / {quota?.geminiMaxDailyRequests ?? 1500}
            </div>
            <div className="w-full bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
              <div 
                className="bg-emerald-400 h-1.5 rounded-full" 
                style={{ width: `${((quota?.geminiRequestsToday || 14) / (quota?.geminiMaxDailyRequests || 1500)) * 100}%` }}
              ></div>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-slate-850 border border-slate-800">
            <span className="text-slate-400 text-xs block mb-1">Tokens Consumed</span>
            <div className="text-xl font-bold text-white">
              {(quota?.geminiTokensToday ?? 28400).toLocaleString()} / 1,000,000
            </div>
            <span className="text-[11px] text-emerald-400 mt-2 block font-medium">Safe operating band</span>
          </div>

          <div className="p-4 rounded-lg bg-slate-850 border border-slate-800">
            <span className="text-slate-400 text-xs block mb-1">Circuit Breaker & Concurrency</span>
            <div className="text-xl font-bold text-emerald-400">
              {quota?.circuitBreakerTripped ? 'TRIPPED' : 'HEALTHY'}
            </div>
            <span className="text-[11px] text-slate-400 mt-2 block">
              Max Concurrent: {quota?.maxConcurrentCalls ?? 3} calls
            </span>
          </div>
        </div>
      </div>

      {/* Autonomy Mode Settings */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4 shadow-sm">
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          Organizational Autonomy Governance
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              id: 'SAFE',
              title: 'Safe Mode',
              desc: 'AI recommends. Human signs off on every campaign launch, ad creative, and budget movement.'
            },
            {
              id: 'ASSISTED',
              title: 'Assisted Mode (Recommended)',
              desc: 'AI autonomously plans, drafts, and optimizes. High-risk healthcare claims and spend > ₹10,000 require review.'
            },
            {
              id: 'AUTONOMOUS',
              title: 'Autonomous Mode',
              desc: 'AI executes end-to-end within strict monthly INR limits. Escalates only on severe compliance anomalies.'
            }
          ].map(m => (
            <div
              key={m.id}
              onClick={() => setAutonomyMode(m.id)}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                autonomyMode === m.id
                  ? 'bg-cyan-950/30 border-cyan-500 text-slate-100 shadow-md shadow-cyan-950/20'
                  : 'bg-slate-850/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm text-white">{m.title}</span>
                {autonomyMode === m.id && (
                  <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                )}
              </div>
              <p className="text-xs leading-relaxed">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Integrations Health */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4 shadow-sm">
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <Link className="w-4 h-4 text-cyan-400" />
          Channel Integrations & Adapters
        </h3>

        <div className="space-y-3">
          {sampleIntegrations.map((int: any) => (
            <div key={int.provider} className="p-4 rounded-lg bg-slate-850 border border-slate-800 flex items-center justify-between text-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-200">{int.provider}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    int.mode === 'LIVE' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  }`}>
                    {int.mode} MODE
                  </span>
                </div>
                <p className="text-slate-400 text-[11px]">{int.details || 'Configured via Sandbox Adapter'}</p>
              </div>

              <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                int.status === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'
              }`}>
                {int.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};