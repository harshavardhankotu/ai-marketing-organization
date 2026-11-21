import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Cpu, 
  ShieldCheck, 
  Link, 
  AlertTriangle,
  CheckCircle2,
  Building,
  Key,
  RefreshCw
} from 'lucide-react';
import { formatINR } from '@ai-marketing/shared';
import { api } from '../services/api.js';

interface SettingsProps {
  business: any;
  quota: any;
  integrations: any[];
  onRefresh?: () => Promise<void> | void;
}

export const Settings: React.FC<SettingsProps> = ({ business, quota, integrations }) => {
  const [autonomyMode, setAutonomyMode] = useState<string>(business?.autonomy_mode || 'ASSISTED');
  const [razorpayHealth, setRazorpayHealth] = useState<any>(null);
  const [telegramHealth, setTelegramHealth] = useState<any>(null);
  const [autonomyStatus, setAutonomyStatus] = useState<any>(null);
  const [loadingIntegrations, setLoadingIntegrations] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    async function loadLiveSystemStates() {
      try {
        const [rzp, tg, auto] = await Promise.all([
          api.getRazorpayHealth().catch(() => null),
          api.getTelegramStatus().catch(() => null),
          api.getPublicAutonomyStatus().catch(() => null)
        ]);
        if (isMounted) {
          setRazorpayHealth(rzp);
          setTelegramHealth(tg);
          setAutonomyStatus(auto);
        }
      } catch (e) {
        // Fallback gracefully
      } finally {
        if (isMounted) {
          setLoadingIntegrations(false);
        }
      }
    }
    loadLiveSystemStates();
    return () => {
      isMounted = false;
    };
  }, []);

  const rzpData = razorpayHealth?.data ?? razorpayHealth;
  const tgData = telegramHealth?.data ?? telegramHealth;
  const autoData = autonomyStatus?.data ?? autonomyStatus;

  // Razorpay exact contract fields
  const rzpConfigured = Boolean(rzpData?.configured);
  const rzpKeyMode = rzpData?.keyMode || (rzpData?.live_mode ? 'LIVE' : (rzpConfigured ? 'TEST_SANDBOX' : 'NONE'));
  const rzpKeyIdPresent = rzpData?.key_id_present ? 'PRESENT' : 'MISSING';
  const rzpSecretPresent = rzpData?.secret_present ? 'PRESENT' : 'MISSING';
  const rzpAccepted = Boolean(rzpData?.providerAcceptedAuth);
  const rzpDiag = rzpData?.authDiagnosticCode || (rzpData ? 'UNKNOWN' : 'UNAVAILABLE');
  const rzpHttpStatus = rzpData?.httpStatus ?? (rzpData?.provider_status_code ?? null);

  const rzpStatus = rzpAccepted
    ? 'CONNECTED'
    : (rzpConfigured
        ? (rzpHttpStatus === 401 || rzpDiag === 'RAZORPAY_401_REJECTED_SECRET'
            ? 'AUTH_FAILED'
            : (rzpHttpStatus === null || rzpDiag === 'NETWORK_ERROR' ? 'UNAVAILABLE' : 'UNKNOWN'))
        : (rzpData ? 'NOT_CONFIGURED' : 'UNAVAILABLE'));

  // Telegram exact status
  const tgConnected = Boolean(tgData?.connected || tgData?.active);
  const tgStatus = tgData
    ? (tgConnected ? 'CONNECTED' : (tgData.status || 'DISCONNECTED'))
    : 'UNAVAILABLE';
  const tgDetails = tgData
    ? `@${tgData.botUsername || 'ai_marketing_bot'} (Mode: ${tgData.mode || 'POLLING'} | Chat: ${tgData.chatIdConfigured ? 'CONFIGURED' : 'UNSET'})`
    : 'Telegram Bot API (Status: UNAVAILABLE)';

  // Brevo status (never default to CONNECTED without verified status)
  const brevoState = autoData?.systemDoctor?.brevo?.status || autoData?.capabilities?.brevo?.status || autoData?.brevoStatus;
  const brevoStatus = brevoState
    ? (brevoState === 'LIVE_VERIFIED' || brevoState === 'OPERATIONAL' || brevoState === 'CONFIGURED' ? 'CONNECTED' : brevoState)
    : 'UNAVAILABLE';
  const brevoDetails = brevoState
    ? `Brevo API v3 (Deliverability: ${brevoState})`
    : 'Brevo Transactional Email (Status: UNAVAILABLE)';

  // Cuelinks status (never default to CONNECTED without verified status)
  const cuelinksState = autoData?.capabilities?.cuelinks?.status || autoData?.cuelinksStatus || autoData?.systemDoctor?.cuelinks?.status;
  const cuelinksStatus = cuelinksState
    ? (cuelinksState === 'LIVE_VERIFIED' || cuelinksState === 'CONNECTED' ? 'CONNECTED' : cuelinksState)
    : 'UNAVAILABLE';
  const cuelinksDetails = cuelinksState
    ? `Cuelinks V3 & Dual-Rail Pipeline (${cuelinksState} | ${autoData?.youtubeDiscovery?.cachedReviewsCount ?? 0} cached YouTube reviews)`
    : 'Cuelinks & Dual-Rail Engine (Status: UNAVAILABLE)';

  const liveIntegrations = [
    {
      provider: 'RAZORPAY STANDARD GATEWAY',
      status: rzpStatus,
      mode: rzpKeyMode,
      details: rzpData
        ? `Mode: ${rzpKeyMode} | KeyId: ${rzpKeyIdPresent} | Secret: ${rzpSecretPresent} | Auth: ${rzpAccepted ? 'ACCEPTED' : (rzpHttpStatus === 401 || rzpDiag === 'RAZORPAY_401_REJECTED_SECRET' ? 'REJECTED' : 'UNVERIFIED')} (HTTP ${rzpHttpStatus ?? 'N/A'}) | Diag: ${rzpDiag}`
        : 'Razorpay Orders API & Standard Checkout (Status: UNAVAILABLE)'
    },
    {
      provider: 'TELEGRAM NOTIFICATION BOT',
      status: tgStatus,
      mode: (tgData?.mode || 'POLLING').toUpperCase(),
      details: tgDetails
    },
    {
      provider: 'BREVO TRANSACTIONAL EMAIL',
      status: brevoStatus,
      mode: autoData ? 'LIVE' : 'UNKNOWN',
      details: brevoDetails
    },
    {
      provider: 'CUELINKS & AFFILIATE ENGINE',
      status: cuelinksStatus,
      mode: autoData ? 'LIVE' : 'UNKNOWN',
      details: cuelinksDetails
    },
    ...(integrations || [])
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
              {quota?.geminiRequestsToday ?? 0} / {quota?.geminiMaxDailyRequests ?? 1500}
            </div>
            <div className="w-full bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
              <div 
                className="bg-emerald-400 h-1.5 rounded-full" 
                style={{ width: `${Math.min(100, (((quota?.geminiRequestsToday ?? 0) / (quota?.geminiMaxDailyRequests || 1500)) * 100))}%` }}
              ></div>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-slate-850 border border-slate-800">
            <span className="text-slate-400 text-xs block mb-1">Tokens Consumed</span>
            <div className="text-xl font-bold text-white">
              {(quota?.geminiTokensToday ?? 0).toLocaleString()} / 1,000,000
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
          {liveIntegrations.map((int: any) => (
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
                int.status === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : (int.status === 'NEEDS_VERIFICATION' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-slate-800 text-slate-400')
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