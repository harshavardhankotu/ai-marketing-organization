import React, { useState } from 'react';
import { 
  Compass, 
  Calendar, 
  Target, 
  DollarSign, 
  MessageSquare, 
  Share2, 
  CheckCircle2, 
  Plus,
  ArrowRight
} from 'lucide-react';
import { formatINR } from '@ai-marketing/shared';

interface CampaignsProps {
  campaigns: any[];
  onTriggerCycle: () => void;
  isCycleRunning: boolean;
}

export const Campaigns: React.FC<CampaignsProps> = ({ campaigns, onTriggerCycle, isCycleRunning }) => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Compass className="w-5 h-5 text-cyan-400" />
            Marketing Campaigns & Channel Flights
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Every campaign maps to a measurable business goal, strict INR budget caps, and channel conversion paths.
          </p>
        </div>

        <button
          onClick={onTriggerCycle}
          disabled={isCycleRunning}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          <span>Launch Next Campaign Flight</span>
        </button>
      </div>

      {/* Campaigns List */}
      <div className="space-y-4">
        {campaigns.map((camp: any) => {
          const progress = Math.min(100, Math.round(((camp.achieved_qualified_leads || 32) / (camp.target_qualified_leads || 100)) * 100));
          return (
            <div 
              key={camp.id}
              className="p-6 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6"
            >
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-bold text-white">{camp.title}</h3>
                  <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    {camp.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{camp.objective}</p>

                {/* Target Audience & Geo */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-1">
                  <span>Audience: <strong className="text-slate-200">{camp.target_audience}</strong></span>
                  <span>Geography: <strong className="text-slate-200">{camp.geography?.city || 'Hyderabad'}</strong></span>
                </div>

                {/* Channels */}
                <div className="flex items-center gap-2 pt-1">
                  {(camp.channels || ['WHATSAPP', 'GOOGLE_BUSINESS_PROFILE', 'INSTAGRAM']).map((ch: string, i: number) => (
                    <span key={i} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                      {ch}
                    </span>
                  ))}
                </div>
              </div>

              {/* Progress & Metrics */}
              <div className="w-full md:w-72 p-4 rounded-lg bg-slate-850 border border-slate-800 space-y-3 shrink-0">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Qualified Consultations</span>
                  <span className="font-bold text-cyan-400">{camp.achieved_qualified_leads || 32} / {camp.target_qualified_leads || 100}</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-cyan-500 h-2 rounded-full" style={{ width: `${progress}%` }}></div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Budget Allocated</span>
                    <strong className="text-slate-200">{formatINR(camp.budget_inr)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Spent to Date</span>
                    <strong className="text-slate-200">{formatINR(camp.spent_inr || 18500)}</strong>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};