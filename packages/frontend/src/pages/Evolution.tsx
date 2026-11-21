import React, { useEffect, useState } from 'react';
import { History, GitCommit, BookOpen } from 'lucide-react';
import { formatINR } from '@ai-marketing/shared';
import { api } from '../services/api.js';

interface EvolutionProps {
  evolutionData: {
    strategies?: any[];
    learnings?: any[];
    decisions?: any[];
  } | null;
}

export const Evolution: React.FC<EvolutionProps> = ({ evolutionData }) => {
  const [doctorStatus, setDoctorStatus] = useState<any>(null);

  useEffect(() => {
    api.getSystemDoctorStatus().then((res) => setDoctorStatus(res?.data || res || null)).catch(() => {});
  }, []);

  const strategies = evolutionData?.strategies || [];
  const decisions = evolutionData?.decisions || [];
  const diagnosis = doctorStatus?.funnelDiagnosis || doctorStatus?.lastReport?.funnelDiagnosis;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
          <History className="w-5 h-5 text-cyan-400" />
          Closed-Loop Evolution &amp; SystemDoctor Decisions
        </h2>
        <p className="text-slate-400 text-xs mt-1">
          Tracks empirical strategy versions and live Autonomous SystemDoctor self-healing decisions across D1 state.
        </p>
      </div>

      {/* Live SystemDoctor Diagnosis Decision Card */}
      {diagnosis && (
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Latest Autonomous SystemDoctor Evaluation</h3>
            <span className="font-mono text-amber-300">{diagnosis.bottleneckStage}</span>
          </div>
          <p className="text-slate-200">{diagnosis.recommendedAction}</p>
          <p className="text-slate-400 font-mono text-[11px]">
            Auto-Applied Fix: {diagnosis.autoAppliedFix} · Source: {diagnosis.diagnosisSource}
          </p>
        </div>
      )}

      {/* Strategy Version History */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <GitCommit className="w-4 h-4 text-cyan-400" />
          Versioned Strategy Evolution ({strategies.length})
        </h3>

        {strategies.length === 0 ? (
          <p className="text-xs text-slate-400">
            No strategy versions generated in DB yet. Trigger a growth cycle on Overview after onboarding a target workspace.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {strategies.map((s: any) => (
              <div
                key={s.id}
                className={`p-5 rounded-xl border space-y-3 ${
                  s.status === 'ACTIVE'
                    ? 'bg-cyan-950/20 border-cyan-500/40'
                    : 'bg-slate-950 border-slate-800 opacity-85'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-white">Strategy v{s.version}</span>
                  <span className={`font-mono text-[11px] font-bold ${s.status === 'ACTIVE' ? 'text-cyan-400' : 'text-slate-400'}`}>
                    {s.status}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed font-medium">{s.rationale}</p>
                <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                  {(s.channelStrategy || []).map((ch: any, idx: number) => (
                    <span key={idx} className="px-2 py-1 rounded bg-slate-900 border border-slate-800 font-mono">
                      {ch.channel}: {ch.allocation}%
                    </span>
                  ))}
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
                  <span>Expected Leads: <strong className="text-slate-100">{s.expected_leads}</strong></span>
                  <span>Target CPQL: <strong className="text-cyan-400">{formatINR(s.expected_cpql_inr || 0)}</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Decision Journal */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-cyan-400" />
          The Decision Journal ({decisions.length})
        </h3>

        {decisions.length === 0 ? (
          <p className="text-xs text-slate-400">
            Zero historical decision journal rows persisted yet.
          </p>
        ) : (
          <div className="space-y-3">
            {decisions.map((d: any) => (
              <div key={d.id} className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="font-bold text-slate-100 text-sm">{d.decision}</span>
                  <span className="font-mono text-[11px] font-bold text-emerald-400">
                    {d.outcome_evaluation || 'RECORDED'}
                  </span>
                </div>
                <p className="text-slate-300"><strong className="text-slate-400">Reason:</strong> {d.reason}</p>
                <p className="text-slate-400"><strong className="text-slate-500">Evidence:</strong> {d.evidence}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};