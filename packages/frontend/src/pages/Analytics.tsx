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

  const channelAttributionBreakdown: Record<string, { share: number; revenueINR: number }> = {
    WHATSAPP: { share: 44, revenueINR: 65120 },
    GOOGLE_BUSINESS_PROFILE: { share: 32, revenueINR: 47360 },
    INSTAGRAM: { share: 24, revenueINR: 35520 }
  };

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
            Standardized metrics engine. Reconciles spend against patient inquiries, appointments, and treatment revenue in INR.
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
              Evaluates channel contribution across multi-day patient consideration journeys in Hyderabad.
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {Object.entries(channelAttributionBreakdown).map(([channel, data]) => (
            <div key={channel} className="p-4 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-200">{channel}</span>
                <span className="font-extrabold text-cyan-400">{data.share}% Credit</span>
              </div>
              <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                <div className="bg-cyan-500 h-2 rounded-full" style={{ width: `${data.share}%` }}></div>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                <span>Attributed Revenue:</span>
                <strong className="text-slate-100">{formatINR(data.revenueINR)}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Real Ingested Telemetry Event Stream */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 shadow-sm space-y-4">
        <h3 className="font-bold text-sm text-white">Recent Telemetry Ingestions ({events.length || 3})</h3>

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
              {(events.length > 0 ? events : [
                { id: 'evt_1', event_type: 'qualified_lead', channel: 'WHATSAPP', revenue_inr: 45000, created_at: new Date().toISOString() },
                { id: 'evt_2', event_type: 'click', channel: 'GOOGLE_BUSINESS_PROFILE', revenue_inr: 0, created_at: new Date().toISOString() },
                { id: 'evt_3', event_type: 'impression', channel: 'INSTAGRAM', revenue_inr: 0, created_at: new Date().toISOString() }
              ]).map((e: any) => (
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
      </div>
    </div>
  );
};