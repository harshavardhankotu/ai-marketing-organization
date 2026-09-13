import React from 'react';
import { AlertOctagon, Play, ShieldAlert, Cpu, Sparkles } from 'lucide-react';

interface NavbarProps {
  businessName: string;
  autonomyMode: string;
  killSwitchActive: boolean;
  onOpenKillSwitchModal: () => void;
  onTriggerCycle: () => void;
  isCycleRunning: boolean;
  quotaInfo?: {
    requestsToday: number;
    maxRequests: number;
    isTripped: boolean;
  };
  operatingMilestone?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  businessName,
  autonomyMode,
  killSwitchActive,
  onOpenKillSwitchModal,
  onTriggerCycle,
  isCycleRunning,
  quotaInfo,
  operatingMilestone
}) => {
  return (
    <header className="h-16 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-6 flex items-center justify-between shrink-0">
      {/* Business & Mode Context */}
      <div className="flex items-center gap-3">
        <span className="font-semibold text-slate-200 text-sm">{businessName}</span>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
          {autonomyMode} Mode
        </span>
        {operatingMilestone && (
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border flex items-center gap-1.5 ${
            operatingMilestone === 'PROFITABLE' || operatingMilestone === 'AUTONOMOUS_SCALING'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : operatingMilestone === 'FIRST_REAL_CUSTOMER' || operatingMilestone === 'FIRST_VERIFIED_REVENUE' || operatingMilestone === 'FIRST_MARKETING_ATTRIBUTED_REVENUE'
              ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
              : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
          }`}>
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            Milestone: {operatingMilestone}
          </span>
        )}
        {killSwitchActive && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1.5 animate-pulse">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
            EMERGENCY STOP ACTIVE
          </span>
        )}
      </div>

      {/* Action Controls & Quota Pill */}
      <div className="flex items-center gap-4">
        {/* Free-tier Quota indicator */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-400">Gemini Free-Tier:</span>
          <span className="font-semibold text-slate-200">
            {quotaInfo?.requestsToday ?? 14} / {quotaInfo?.maxRequests ?? 1500} reqs
          </span>
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
        </div>

        {/* Closed-Loop Marketing Cycle Trigger */}
        <button
          onClick={onTriggerCycle}
          disabled={isCycleRunning || killSwitchActive}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-md shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isCycleRunning ? (
            <>
              <Sparkles className="w-4 h-4 animate-spin" />
              <span>Running Closed Loop...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Run Marketing Cycle</span>
            </>
          )}
        </button>

        {/* Global Kill Switch Button */}
        <button
          onClick={onOpenKillSwitchModal}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all border ${
            killSwitchActive
              ? 'bg-rose-600 text-white border-rose-500 hover:bg-rose-700 shadow-lg shadow-rose-600/30'
              : 'bg-slate-800 text-rose-400 border-rose-500/30 hover:bg-rose-500/10'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>{killSwitchActive ? 'Reset Kill Switch' : 'Kill Switch'}</span>
        </button>
      </div>
    </header>
  );
};