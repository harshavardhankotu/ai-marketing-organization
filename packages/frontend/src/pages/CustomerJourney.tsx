import React, { useState, useEffect } from 'react';
import { 
  Users, 
  ArrowRight, 
  Filter, 
  CheckCircle2, 
  PhoneCall, 
  MessageSquare, 
  MapPin, 
  Calendar,
  Sparkles,
  ChevronRight
} from 'lucide-react';
import { api } from '../services/api.js';
import { formatINR } from '@ai-marketing/shared';

const STAGES = [
  { id: 'VISITOR', label: '1. Visitor', color: 'from-blue-500/20 to-blue-600/10', border: 'border-blue-500/30' },
  { id: 'SESSION', label: '2. Session', color: 'from-cyan-500/20 to-cyan-600/10', border: 'border-cyan-500/30' },
  { id: 'LEAD', label: '3. Lead', color: 'from-teal-500/20 to-teal-600/10', border: 'border-teal-500/30' },
  { id: 'QUALIFIED_LEAD', label: '4. Qualified Lead', color: 'from-amber-500/20 to-amber-600/10', border: 'border-amber-500/30' },
  { id: 'OPPORTUNITY', label: '5. Opportunity', color: 'from-orange-500/20 to-orange-600/10', border: 'border-orange-500/30' },
  { id: 'CUSTOMER', label: '6. Customer', color: 'from-emerald-500/20 to-emerald-600/10', border: 'border-emerald-500/30' },
];

export const CustomerJourney: React.FC = () => {
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [journeys, setJourneys] = useState<any[]>([]);
  const [selectedJourney, setSelectedJourney] = useState<any>(null);
  const [selectedStage, setSelectedStage] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const res = await api.getCustomerJourneys();
      setFunnel(res.data?.funnel || {});
      const list = res.data?.journeys || [];
      setJourneys(list);
      if (list.length > 0 && !selectedJourney) {
        setSelectedJourney(list[0]);
      }
    } catch (e) {
      console.error('Failed to load journeys', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredJourneys = selectedStage === 'ALL'
    ? journeys
    : journeys.filter(j => j.stage === selectedStage);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <Users className="w-6 h-6 text-cyan-400" />
          Customer Journey & Attribution Funnel
        </h2>
        <p className="text-sm text-slate-400">
          Trace every patient from top-of-funnel impression to consultation, 3D scan, and verified INR revenue.
        </p>
      </div>

      {/* Visual Pipeline Funnel */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {STAGES.map((s, idx) => {
          const count = funnel[s.id] || 0;
          const isSelected = selectedStage === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSelectedStage(isSelected ? 'ALL' : s.id)}
              className={`p-4 rounded-xl text-left transition-all relative overflow-hidden bg-gradient-to-b ${s.color} border ${
                isSelected ? 'ring-2 ring-cyan-400 border-transparent' : s.border
              } hover:brightness-110`}
            >
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {s.label}
              </div>
              <div className="text-2xl font-black text-white mt-1">
                {count}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
                <span>Stage {idx + 1}</span>
                {idx < 5 && <ArrowRight className="w-3 h-3 text-slate-500" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Two-Column Layout: Journey List & Interactive Timeline Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Journey Cards */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium px-1">
            <span>Patient Profiles ({filteredJourneys.length})</span>
            {selectedStage !== 'ALL' && (
              <button
                onClick={() => setSelectedStage('ALL')}
                className="text-cyan-400 hover:underline"
              >
                Clear filter ({selectedStage})
              </button>
            )}
          </div>

          <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
            {filteredJourneys.length === 0 ? (
              <div className="p-8 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-slate-500 text-xs">
                No patient journeys in this stage yet.
              </div>
            ) : (
              filteredJourneys.map(j => {
                const isSelected = selectedJourney?.id === j.id;
                return (
                  <div
                    key={j.id}
                    onClick={() => setSelectedJourney(j)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-800/90 border-cyan-500/50 shadow-lg shadow-cyan-500/10'
                        : 'bg-slate-900/70 border-slate-800 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="font-semibold text-white text-sm">
                        {j.customerName || `Visitor #${j.visitorId.slice(-4)}`}
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                        {j.stage}
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 flex items-center justify-between">
                      <span>Channel: <strong className="text-slate-300">{j.firstTouchChannel || 'Direct'}</strong></span>
                      {j.totalLifetimeValueINR > 0 && (
                        <span className="text-emerald-400 font-semibold font-mono">
                          {formatINR(j.totalLifetimeValueINR)}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-2">
                      <span>{j.touchpoints?.length || 0} touchpoints</span>
                      <span>•</span>
                      <span>Mode: {j.classification}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Multi-Touch Chronological Timeline Inspector */}
        <div className="lg:col-span-7">
          {selectedJourney ? (
            <div className="p-6 rounded-xl bg-slate-900/70 border border-slate-800 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-2">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    {selectedJourney.customerName || 'Anonymous Visitor'}
                    <span className="text-xs font-mono font-normal text-slate-400">
                      ({selectedJourney.visitorId})
                    </span>
                  </h3>
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-4">
                    {selectedJourney.customerPhone && (
                      <span className="flex items-center gap-1">
                        <PhoneCall className="w-3 h-3 text-cyan-400" />
                        {selectedJourney.customerPhone}
                      </span>
                    )}
                    {selectedJourney.customerEmail && (
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3 h-3 text-teal-400" />
                        {selectedJourney.customerEmail}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-slate-400 font-medium">Attributed Value</div>
                  <div className="text-xl font-bold text-emerald-400 font-mono">
                    {formatINR(selectedJourney.totalLifetimeValueINR)}
                  </div>
                </div>
              </div>

              {/* Touchpoint Timeline */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  Multi-Touch Customer Timeline
                </h4>

                <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                  {selectedJourney.touchpoints?.map((tp: any, index: number) => (
                    <div key={index} className="relative">
                      <div className="absolute -left-[27px] top-1 w-3.5 h-3.5 rounded-full bg-cyan-500 border-2 border-slate-900 ring-2 ring-cyan-500/20" />
                      <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-white capitalize">
                            {tp.event.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(tp.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {tp.channel}
                          </span>
                          {tp.campaignId && (
                            <span className="text-cyan-400 text-[11px]">
                              Campaign: {tp.campaignId}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-slate-500 text-xs">
              Select a patient profile to inspect the end-to-end touchpoint journey.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
