import React, { useState } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Target, 
  Layers, 
  ArrowRight, 
  ShieldCheck, 
  Zap, 
  Filter
} from 'lucide-react';
import { formatINR } from '@ai-marketing/shared';

interface AnalyticsProps {
  metrics: any;
  events: any[];
  attributions: any[];
}

export const Analytics: React.FC<AnalyticsProps> = ({ metrics, events, attributions }) => {
  const [activeModel, setActiveModel] = useState<'FIRST_TOUCH' | 'LAST_TOUCH' | 'LINEAR' | 'ASSISTED_CONVERSION'>('ASSISTED_CONVERSION');

  // Compute live channel attribution breakdown dynamically based on selected activeModel
  const filteredAttributions = attributions && attributions.length > 0
    ? attributions.filter(a => !a.attribution_model || a.attribution_model === activeModel || a.model === activeModel)
    : [];

  const effectiveAttributions = filteredAttributions.length > 0 ? filteredAttributions : (attributions || []);

  const totalAttributedRevenueINR = effectiveAttributions.reduce((acc, curr) => acc + (Number(curr.revenue_inr) || 0), 0);

  const channelMap: Record<string, { count: number; revenueINR: number }> = {};
  for (const a of effectiveAttributions) {
    const ch = (a.channel || 'DIRECT').toUpperCase();
    if (!channelMap[ch]) channelMap[ch] = { count: 0, revenueINR: 0 };
    channelMap[ch].count += 1;
    channelMap[ch].revenueINR += (Number(a.revenue_inr) || 0);
  }

  const channels = ['WHATSAPP', 'GOOGLE_BUSINESS_PROFILE', 'INSTAGRAM', 'YOUTUBE', 'DIRECT'];
  const channelAttributionBreakdown = channels.map(channel => {
    const data = channelMap[channel] || { count: 0, revenueINR: 0 };
    const share = totalAttributedRevenueINR > 0 ? Math.round((data.revenueINR / totalAttributedRevenueINR) * 100) : 0;
    return {
      channel,
      share,
      revenueINR: data.revenueINR
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
            Unified Analytics & Multi-Touch Attribution
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Standardized metrics engine. Reconciles spend against customer inquiries, consultations, and verified revenue in INR.
          </p>
        </div>
      </div>

      {/* Attribution Model Selector */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              Attribution Model Comparison
            </h3>
            <p className="text-xs text-slate-400">
              Evaluates channel contribution across multi-day customer consideration journeys. Zero synthetic numbers.
            </p>
          </div>

          <div className="flex flex-wrap gap-1 p-1 bg-slate-850 border border-slate-800 rounded-lg">
            {(['FIRST_TOUCH', 'LAST_TOUCH', 'LINEAR', 'ASSISTED_CONVERSION'] as const).map(model => (
              <button
                key={model}
                onClick={() => setActiveModel(model)}
                className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                  activeModel === model 
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {model.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Channel Contribution Visualizer */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 pt-2">
          {channelAttributionBreakdown.map((item) => (
            <div key={item.channel} className="p-4 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-200 text-[11px] truncate">{item.channel}</span>
                <span className="font-extrabold text-cyan-400 text-[11px]">{item.share}% Credit</span>
              </div>
              <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${item.share}%` }}></div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                <span>Attributed:</span>
                <strong className="text-slate-100">{formatINR(item.revenueINR)}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Real Ingested Telemetry Event Stream */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 shadow-sm space-y-4">
        <h3 className="font-bold text-sm text-white">Recent Telemetry Ingestions ({events?.length || 0})</h3>

        {(!events || events.length === 0) ? (
          <div className="p-6 text-center text-slate-500 text-xs bg-slate-950/40 rounded-lg border border-slate-800/60">
            No telemetry events ingested yet. Waiting for live user traffic and inquiries.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-850 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">Event Type</th>
                  <th className="py-2.5 px-4">Channel</th>
                  <th className="py-2.5 px-4">Value (INR)</th>
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {events.map((e: any) => (
                  <tr key={e.id} className="hover:bg-slate-850/50">
                    <td className="py-2.5 px-4 font-semibold text-slate-100 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                      {e.event_type}
                    </td>
                    <td className="py-2.5 px-4">{e.channel}</td>
                    <td className="py-2.5 px-4 font-bold text-emerald-400">{formatINR(e.revenue_inr || 0)}</td>
                    <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px]">{new Date(e.created_at).toLocaleTimeString()}</td>
                    <td className="py-2.5 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        INGESTED
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
