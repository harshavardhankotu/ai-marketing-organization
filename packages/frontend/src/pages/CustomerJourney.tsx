import React, { useState, useEffect } from 'react';
import {
  Users,
  ArrowRight,
  PhoneCall,
  MessageSquare,
  Sparkles
} from 'lucide-react';
import { api } from '../services/api.js';
import { formatINR } from '@ai-marketing/shared';

const STAGES = [
  { id: 'VISITOR', label: '1. Visitor', border: 'border-blue-500/30' },
  { id: 'SESSION', label: '2. Session', border: 'border-cyan-500/30' },
  { id: 'LEAD', label: '3. Inquiry / Lead', border: 'border-teal-500/30' },
  { id: 'QUALIFIED_LEAD', label: '4. Checkout Intent', border: 'border-amber-500/30' },
  { id: 'OPPORTUNITY', label: '5. UPI Claim / Order', border: 'border-orange-500/30' },
  { id: 'CUSTOMER', label: '6. Settled Customer', border: 'border-emerald-500/30' }
];

export const CustomerJourney: React.FC = () => {
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [journeys, setJourneys] = useState<any[]>([]);
  const [selectedJourney, setSelectedJourney] = useState<any>(null);
  const [selectedStage, setSelectedStage] = useState<string>('ALL');
  const [autonomy, setAutonomy] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [res, autoRes] = await Promise.all([
        api.getCustomerJourneys().catch(() => ({ data: { funnel: {}, journeys: [] } })),
        api.getPublicAutonomyStatus().catch(() => null)
      ]);
      setFunnel(res?.data?.funnel || {});
      const list = res?.data?.journeys || [];
      setJourneys(list);
      if (list.length > 0 && !selectedJourney) {
        setSelectedJourney(list[0]);
      }
      setAutonomy(autoRes?.data || autoRes || null);
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

  const fm = autonomy?.systemDoctor?.funnelDiagnosis?.funnelMatrix;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <Users className="w-6 h-6 text-cyan-400" />
          Dual-Engine Customer Acquisition Funnel
        </h2>
        <p className="text-sm text-slate-400">
          Separates the SiteFix Fix-Pack checkout funnel from the Affiliate + YouTube Review click-out funnel using live D1 records.
        </p>
      </div>

      {/* Live SiteFix vs Affiliate Dual Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">01. SiteFix Fix-Pack Funnel (₹499 Direct)</h3>
            <span className="font-mono text-slate-400">D1 Audited</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-400">Audits</div>
              <div className="text-base font-bold font-mono tabular-nums text-white mt-0.5">
                {autonomy?.siteAuditCount ?? autonomy?.totalAudits ?? 0}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-400">Desk Signals</div>
              <div className="text-base font-bold font-mono tabular-nums text-cyan-300 mt-0.5">
                {fm?.customerDeskInquiries ?? 0}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-400">Orders / Claims</div>
              <div className="text-base font-bold font-mono tabular-nums text-amber-300 mt-0.5">
                {fm?.checkoutOrders ?? 0}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-400">Verified Cash</div>
              <div className="text-base font-bold font-mono tabular-nums text-emerald-400 mt-0.5">
                ₹{Number(fm?.verifiedCashINR ?? 0).toLocaleString('en-IN')}
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">02. Affiliate + YouTube Review Funnel</h3>
            <span className="font-mono text-slate-400">Cuelinks + Amazon.in</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-400">Active Deals</div>
              <div className="text-base font-bold font-mono tabular-nums text-white mt-0.5">
                {fm?.catalogActiveDeals ?? autonomy?.activeDealsCount ?? 0}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-400">YT Reviews</div>
              <div className="text-base font-bold font-mono tabular-nums text-cyan-300 mt-0.5">
                {autonomy?.youtubeDiscovery?.cachedReviewsCount ?? 0}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-400">/vs/ Pages</div>
              <div className="text-base font-bold font-mono tabular-nums text-white mt-0.5">
                {fm?.comparisonPages ?? 0}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-400">Redirect Clicks</div>
              <div className="text-base font-bold font-mono tabular-nums text-emerald-400 mt-0.5">
                {fm?.redirectClicks ?? 0}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Journey Pipeline */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {STAGES.map((s, idx) => {
          const count = funnel[s.id] || 0;
          const isSelected = selectedStage === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSelectedStage(isSelected ? 'ALL' : s.id)}
              className={`p-4 rounded-xl text-left transition-all bg-slate-900 border ${
                isSelected ? 'ring-2 ring-cyan-400 border-transparent' : s.border
              }`}
            >
              <div className="text-[11px] font-semibold text-slate-400">{s.label}</div>
              <div className="text-2xl font-black font-mono tabular-nums text-white mt-1">{count}</div>
              <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
                <span>Stage {idx + 1}</span>
                {idx < 5 && <ArrowRight className="w-3 h-3 text-slate-500" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Journey List & Timeline Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium px-1">
            <span>Buyer Profiles ({filteredJourneys.length})</span>
            {selectedStage !== 'ALL' && (
              <button onClick={() => setSelectedStage('ALL')} className="text-cyan-400 hover:underline">
                Clear filter ({selectedStage})
              </button>
            )}
          </div>

          <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
            {loading ? (
              <div className="p-8 rounded-xl bg-slate-900 border border-slate-800 text-center text-slate-400 text-xs">
                Loading verified buyer journeys...
              </div>
            ) : filteredJourneys.length === 0 ? (
              <div className="p-8 rounded-xl bg-slate-900 border border-slate-800 text-center text-slate-500 text-xs">
                No recorded buyer journeys in this stage yet.
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
                        ? 'bg-slate-800/90 border-cyan-500/50'
                        : 'bg-slate-900 border-slate-800 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="font-semibold text-white text-sm">
                        {j.customerName || `Visitor #${String(j.visitorId || '').slice(-4)}`}
                      </div>
                      <span className="text-[11px] font-mono text-cyan-300">{j.stage}</span>
                    </div>

                    <div className="text-xs text-slate-400 flex items-center justify-between">
                      <span>Channel: <strong className="text-slate-300">{j.firstTouchChannel || 'Direct'}</strong></span>
                      {j.totalLifetimeValueINR > 0 && (
                        <span className="text-emerald-400 font-semibold font-mono tabular-nums">
                          {formatINR(j.totalLifetimeValueINR)}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 text-[11px] text-slate-500">
                      <span>{j.touchpoints?.length || 0} touchpoints</span>
                      <span aria-hidden="true"> · </span>
                      <span>{j.classification}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-7">
          {selectedJourney ? (
            <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-2">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    {selectedJourney.customerName || 'Anonymous Buyer'}
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
                  <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums">
                    {formatINR(selectedJourney.totalLifetimeValueINR)}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  Multi-Touch Chronological Timeline
                </h4>

                <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                  {selectedJourney.touchpoints?.map((tp: any, index: number) => (
                    <div key={index} className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white capitalize">
                          {String(tp.event || '').replace(/_/g, ' ')}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {new Date(tp.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        </span>
                      </div>
                      <div className="text-slate-400">
                        <span>{tp.channel}</span>
                        {tp.campaignId && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="text-cyan-400">{tp.campaignId}</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-xl bg-slate-900 border border-slate-800 text-center text-slate-500 text-xs">
              Select a buyer profile to inspect multi-touch journey attribution.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
