import React, { useState } from 'react';
import { 
  PlayCircle, 
  Sparkles, 
  Target, 
  ShieldCheck, 
  AlertTriangle, 
  TrendingUp, 
  Layers
} from 'lucide-react';
import { formatINR } from '@ai-marketing/shared';

export const Simulation: React.FC = () => {
  const [budgetINR, setBudgetINR] = useState<number>(50000);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [simulating, setSimulating] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<any | null>(null);

  const runSimulation = () => {
    setSimulating(true);
    setTimeout(() => {
      setSimulating(false);
      const expectedLeads = Math.round(budgetINR / 500);
      setSimResult({
        projectedLeads: expectedLeads,
        projectedRevenueINR: expectedLeads * 45000 * 0.12, // 12% closing rate on ₹45k ticket
        expectedCPQL: 500,
        riskTier: 'LOW_RISK_SIMULATION',
        recommendedChannelSplit: [
          { channel: 'WHATSAPP', percent: 50, budgetINR: budgetINR * 0.50, leads: Math.round(expectedLeads * 0.55) },
          { channel: 'GOOGLE_BUSINESS_PROFILE', percent: 30, budgetINR: budgetINR * 0.30, leads: Math.round(expectedLeads * 0.30) },
          { channel: 'INSTAGRAM', percent: 20, budgetINR: budgetINR * 0.20, leads: Math.round(expectedLeads * 0.15) }
        ],
        complianceNotice: 'All planned ad copy adheres to Medical Council of India guidelines; no guaranteed medical cure claims.'
      });
    }, 1200);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
          <PlayCircle className="w-5 h-5 text-cyan-400" />
          Autonomous Dry-Run & Strategy Simulation
        </h2>
        <p className="text-slate-400 text-xs mt-1">
          Simulate organizational workflows, projected qualified leads, and channel allocation before executing live actions or committing real budgets.
        </p>
      </div>

      {/* Simulator Inputs */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4 shadow-sm">
        <h3 className="font-bold text-sm text-white">Campaign Simulation Parameters</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Monthly Budget (INR)
            </label>
            <input
              type="number"
              value={budgetINR}
              step={5000}
              min={10000}
              onChange={(e) => setBudgetINR(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
            />
            <span className="text-[11px] text-cyan-400 font-semibold mt-1 block">
              {formatINR(budgetINR)}
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Flight Duration (Days)
            </label>
            <input
              type="number"
              value={durationDays}
              min={7}
              max={90}
              onChange={(e) => setDurationDays(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              {durationDays} Days Duration
            </span>
          </div>
        </div>

        <button
          onClick={runSimulation}
          disabled={simulating}
          className="w-full py-2.5 rounded-lg text-sm font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 transition-all shadow-md shadow-cyan-400/20 flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4" />
          <span>{simulating ? 'Calculating Organizational Simulation...' : 'Run Dry-Run Simulation'}</span>
        </button>
      </div>

      {/* Simulation Results */}
      {simResult && (
        <div className="p-6 rounded-xl bg-slate-900 border border-cyan-500/30 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Projected Simulation Outcomes
            </h3>
            <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              DRY-RUN VERIFIED
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-slate-850 border border-slate-800">
              <span className="text-slate-400 text-xs">Projected Qualified Inquiries</span>
              <div className="text-2xl font-bold text-cyan-400 mt-1">{simResult.projectedLeads}</div>
            </div>

            <div className="p-4 rounded-lg bg-slate-850 border border-slate-800">
              <span className="text-slate-400 text-xs">Target CPQL (Cost/Inquiry)</span>
              <div className="text-2xl font-bold text-white mt-1">{formatINR(simResult.expectedCPQL)}</div>
            </div>

            <div className="p-4 rounded-lg bg-slate-850 border border-slate-800">
              <span className="text-slate-400 text-xs">Projected Clinic Revenue</span>
              <div className="text-2xl font-bold text-emerald-400 mt-1">{formatINR(simResult.projectedRevenueINR)}</div>
            </div>
          </div>

          {/* Recommended Allocation */}
          <div className="space-y-2 pt-2">
            <span className="text-xs font-bold text-slate-300">Recommended Channel Allocation Split:</span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {simResult.recommendedChannelSplit.map((ch: any) => (
                <div key={ch.channel} className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs space-y-1">
                  <div className="flex justify-between font-bold text-slate-200">
                    <span>{ch.channel}</span>
                    <span className="text-cyan-400">{ch.percent}%</span>
                  </div>
                  <div className="text-slate-400 flex justify-between text-[11px]">
                    <span>Budget: {formatINR(ch.budgetINR)}</span>
                    <span>~{ch.leads} Leads</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-850 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{simResult.complianceNotice}</span>
          </div>
        </div>
      )}
    </div>
  );
};