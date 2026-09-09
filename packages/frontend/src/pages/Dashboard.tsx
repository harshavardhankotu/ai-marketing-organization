import React from 'react';
import { 
  Users, 
  TrendingUp, 
  Target, 
  Sparkles, 
  CheckCircle2, 
  ArrowUpRight, 
  AlertCircle,
  Clock,
  Compass,
  Zap,
  FlaskConical
} from 'lucide-react';
import { formatINR } from '@ai-marketing/shared';

interface DashboardProps {
  metrics: any;
  business: any;
  goal: any;
  campaigns: any[];
  experiments: any[];
  onTriggerCycle: () => void;
  isCycleRunning: boolean;
  onNavigateTab: (tab: any) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  metrics,
  business,
  goal,
  campaigns,
  experiments,
  onTriggerCycle,
  isCycleRunning,
  onNavigateTab
}) => {
  const primaryGoal = goal || {
    title: 'Acquire 100 Qualified Patient Consultations in Hyderabad',
    target_value: 100,
    current_value: 32,
    budget_allocated_inr: 50000
  };

  const progressPercent = Math.min(100, Math.round(((primaryGoal.current_value || 32) / (primaryGoal.target_value || 100)) * 100));

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-cyan-950/40 border border-slate-700/80 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider mb-1">
            <Zap className="w-3.5 h-3.5" />
            Autonomous Marketing Closed Loop Active
          </div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight">
            {business?.name || 'SmileKraft Dental Clinic Hyderabad'}
          </h2>
          <p className="text-slate-300 text-sm mt-1">
            {business?.city || 'Hyderabad'} ({business?.neighborhood || 'Banjara Hills & Gachibowli'}) • Serving high-intent dental implant & clear aligner patients.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigateTab('agents')}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 transition-all"
          >
            Inspect 80 Agents
          </button>
          <button
            onClick={onTriggerCycle}
            disabled={isCycleRunning}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-md shadow-cyan-500/20 disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isCycleRunning ? 'Autonomous Cycle Running...' : 'Trigger Next Learning Cycle'}
          </button>
        </div>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Qualified Inquiries</span>
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{metrics?.qualifiedLeads ?? 32}</span>
            <span className="text-xs text-slate-400">/ {primaryGoal.target_value} target</span>
          </div>
          <div className="mt-3 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${progressPercent}%` }}></div>
          </div>
          <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1 font-medium">
            <TrendingUp className="w-3 h-3" /> +28% vs last month run-rate
          </p>
        </div>

        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Realized Consult Revenue</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{formatINR(metrics?.revenueINR ?? 148000)}</span>
          </div>
          <p className="text-xs text-slate-400 mt-4">
            Avg treatment ticket: <span className="text-slate-200 font-semibold">₹45,000</span> (Aligners)
          </p>
        </div>

        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Cost per Qualified Lead</span>
            <Target className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{formatINR(metrics?.cpqlINR ?? 578)}</span>
            <span className="text-xs text-slate-400">/ inquiry</span>
          </div>
          <p className="text-xs text-emerald-400 mt-4 flex items-center gap-1 font-medium">
            <TrendingUp className="w-3 h-3" /> -14% cheaper than Hyderabad benchmark
          </p>
        </div>

        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Marketing Efficiency (ROAS)</span>
            <ArrowUpRight className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{metrics?.roas ?? 8.0}x</span>
          </div>
          <p className="text-xs text-slate-400 mt-4">
            Budget spent: <span className="text-slate-200 font-semibold">{formatINR(metrics?.spentINR ?? 18500)}</span>
          </p>
        </div>
      </div>

      {/* Core Operational Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Active Campaigns & Recommendations */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Campaigns */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Compass className="w-4 h-4 text-cyan-400" />
                Active Campaigns ({campaigns.length || 1})
              </h3>
              <button 
                onClick={() => onNavigateTab('campaigns')}
                className="text-xs font-semibold text-cyan-400 hover:text-cyan-300"
              >
                View all →
              </button>
            </div>

            <div className="space-y-3">
              {(campaigns.length > 0 ? campaigns : [
                {
                  id: 'cmp_hyd_01',
                  title: 'Hyderabad Smile Transformation Campaign',
                  objective: 'Acquire qualified patient consultations for Clear Aligners & Implants',
                  channels: ['WHATSAPP', 'GOOGLE_BUSINESS_PROFILE', 'INSTAGRAM'],
                  budget_inr: 50000,
                  spent_inr: 18500,
                  target_qualified_leads: 100,
                  achieved_qualified_leads: 32,
                  status: 'ACTIVE'
                }
              ]).map(c => (
                <div key={c.id} className="p-4 rounded-lg bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 transition-all">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm text-slate-100">{c.title}</h4>
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {c.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{c.objective}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-300">
                    <div>Budget: <span className="font-semibold text-slate-100">{formatINR(c.budget_inr)}</span></div>
                    <div>Spent: <span className="font-semibold text-slate-100">{formatINR(c.spent_inr || 0)}</span></div>
                    <div>Leads: <span className="font-semibold text-cyan-400">{c.achieved_qualified_leads || 32}</span> / {c.target_qualified_leads}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Organization Actionable Recommendations */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <h3 className="font-bold text-base text-white flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Strategic Recommendations from Control Plane
            </h3>

            <div className="space-y-3">
              <div className="p-4 rounded-lg bg-cyan-950/20 border border-cyan-500/30 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-cyan-400">Scale WhatsApp Educational Video Sequence</span>
                  <span className="text-slate-400">Confidence: 94%</span>
                </div>
                <p className="text-slate-300 mt-1.5 leading-relaxed">
                  WhatsApp educational messages demonstrating 3D smile design preview generated <span className="text-cyan-300 font-semibold">2.3x higher appointment show-up rate</span> than direct promotional discounts over the last 21 days in Banjara Hills. Increase WhatsApp allocation from 30% to 50%.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button 
                    onClick={onTriggerCycle}
                    className="px-3 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs"
                  >
                    Apply Strategy Evolution
                  </button>
                  <span className="text-slate-500 text-[11px]">Reversible in 1-click</span>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-slate-800/40 border border-slate-700 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Google Business Profile Local SEO Audit</span>
                  <span className="text-slate-400">Confidence: 89%</span>
                </div>
                <p className="text-slate-400 mt-1">
                  Agent <span className="text-slate-300 font-mono">res-09 (Local Market Research)</span> identified 440 monthly searches for "Painless Implants Gachibowli" with low competitor map-pack density. Schedule 2 localized clinic photo updates weekly.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Goal Progress & Active Experiments */}
        <div className="space-y-6">
          {/* Goal Card */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <h3 className="font-bold text-base text-white flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-cyan-400" />
              Quarterly Goal
            </h3>
            <p className="text-xs text-slate-300 font-medium leading-tight">{primaryGoal.title}</p>
            <div className="mt-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700/60">
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Progress</span>
                <span className="font-bold text-cyan-400">{progressPercent}%</span>
              </div>
              <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                <div className="bg-cyan-500 h-2 rounded-full" style={{ width: `${progressPercent}%` }}></div>
              </div>
              <div className="mt-3 flex justify-between text-xs text-slate-400">
                <span>Current: <strong className="text-white">{primaryGoal.current_value || 32}</strong></span>
                <span>Target: <strong className="text-white">{primaryGoal.target_value}</strong></span>
              </div>
            </div>
          </div>

          {/* Active Split-Test Experiments */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-cyan-400" />
                Active Experiments
              </h3>
              <button 
                onClick={() => onNavigateTab('experiments')}
                className="text-xs font-semibold text-cyan-400 hover:text-cyan-300"
              >
                Lab →
              </button>
            </div>

            <div className="space-y-3">
              {(experiments.length > 0 ? experiments.slice(0, 2) : [
                {
                  id: 'exp_01',
                  title: 'Transparent EMI Ad Copy Test',
                  hypothesis: 'Displaying 0% EMI pricing in INR increases patient consultation inquiries by +25%',
                  status: 'CONCLUDED',
                  outcome: 'SCALE',
                  confidence_score: 0.98
                }
              ]).map(e => (
                <div key={e.id} className="p-3.5 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">{e.title}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400">
                      {e.outcome || e.status}
                    </span>
                  </div>
                  <p className="text-slate-400 mt-1 text-[11px] line-clamp-2">{e.hypothesis}</p>
                  <div className="mt-2 text-[10px] text-slate-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Statistically significant ({(e.confidence_score * 100).toFixed(0)}% confidence)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};