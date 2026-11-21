import React, { useState, useEffect, useRef } from 'react';
import { 
  CheckSquare, 
  ShieldAlert, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  MessageSquare,
  AlertTriangle,
  Sparkles,
  Mail,
  Send,
  Check,
  AlertCircle,
  RefreshCw,
  Loader2
} from 'lucide-react';
import { api } from '../services/api.js';

interface ApprovalsProps {
  approvals: any[];
  onResolve: (data: { requestId: string; action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES'; feedbackNotes?: string }) => Promise<void>;
  onRefresh?: () => Promise<void> | void;
}

export const Approvals: React.FC<ApprovalsProps> = ({ approvals, onResolve, onRefresh }) => {
  const [feedbackNotes, setFeedbackNotes] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isHarvesting, setIsHarvesting] = useState<boolean>(false);
  const [harvestMsg, setHarvestMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [readyActions, setReadyActions] = useState<any>(null);
  const [inFlightDraftIds, setInFlightDraftIds] = useState<Record<string, boolean>>({});
  const [loadingDrafts, setLoadingDrafts] = useState<boolean>(true);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const fetchSeqRef = useRef<number>(0);

  const isDispatchingAny = Object.values(inFlightDraftIds).some(Boolean) || Boolean(loadingId) || isHarvesting;

  const loadPendingDrafts = async () => {
    const seq = ++fetchSeqRef.current;
    setLoadingDrafts(true);
    setDraftsError(null);
    try {
      const res = await api.getFirstSaleReadyActions();
      if (seq === fetchSeqRef.current) {
        setReadyActions(res?.data || null);
      }
    } catch (err: any) {
      if (seq === fetchSeqRef.current) {
        setDraftsError(err?.message || 'Failed to load outreach drafts.');
      }
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoadingDrafts(false);
      }
    }
  };

  useEffect(() => {
    loadPendingDrafts();
    return () => {
      ++fetchSeqRef.current;
    };
  }, []);

  const handleAction = async (requestId: string, action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES') => {
    setLoadingId(requestId);
    try {
      await onResolve({
        requestId,
        action,
        feedbackNotes: feedbackNotes[requestId]
      });
    } finally {
      setLoadingId(null);
    }
  };

  const handleRunFullCycle = async () => {
    setIsHarvesting(true);
    setHarvestMsg(null);
    setActionError(null);
    try {
      await api.triggerFirstSaleLiveHarvest();
      setHarvestMsg('Full autonomous cycle executed! New deals, audits, and drafts refreshed.');
      await loadPendingDrafts();
      await onRefresh?.();
    } catch (err: any) {
      setActionError(`Harvest trigger failed: ${err?.data?.error || err?.message || 'Unknown error'}`);
    } finally {
      setIsHarvesting(false);
    }
  };

  const handleApproveDraft = async (draftId: string) => {
    setInFlightDraftIds(prev => ({ ...prev, [draftId]: true }));
    setActionError(null);
    try {
      await api.approveAndSendFirstSaleDraft(draftId);
      setHarvestMsg('Draft approved and dispatched via Brevo MCP!');
      await loadPendingDrafts();
      await onRefresh?.();
    } catch (err: any) {
      setActionError(`Dispatch failed: ${err?.data?.error || err?.message || 'Unknown error'}`);
    } finally {
      setInFlightDraftIds(prev => {
        const next = { ...prev };
        delete next[draftId];
        return next;
      });
    }
  };

  const pendingDrafts = readyActions?.pendingDrafts || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-cyan-400" />
            Human-in-the-Loop Approval Queue
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            High-impact actions, outbound buyer emails, and regulated healthcare claims require explicit human oversight.
          </p>
        </div>

        <button
          onClick={handleRunFullCycle}
          disabled={isHarvesting}
          className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-cyan-600 via-indigo-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 shadow-md shadow-cyan-600/25 disabled:opacity-50 transition-all flex items-center gap-2 shrink-0 self-start sm:self-auto"
        >
          <Sparkles className="w-4 h-4 text-amber-300" />
          <span>{isHarvesting ? 'Running Full Autonomous Cycle...' : 'Run Full Autonomous Cycle Now'}</span>
        </button>
      </div>

      {harvestMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{harvestMsg}</span>
        </div>
      )}

      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Pending Outreach Drafts Awaiting Human Review (Stage P / Q Live Funnel) */}
      {loadingDrafts ? (
        <div className="p-8 rounded-xl bg-slate-900 border border-slate-800 text-center space-y-2">
          <Loader2 className="w-5 h-5 text-cyan-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-400">Loading pending first-sale outreach drafts...</p>
        </div>
      ) : draftsError ? (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{draftsError}</span>
          </div>
          <button
            onClick={loadPendingDrafts}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-semibold flex items-center gap-1 shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      ) : pendingDrafts.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <Mail className="w-4 h-4 text-amber-400" />
            Pending First-Sale Outreach Drafts ({pendingDrafts.length})
          </h3>
          <div className="space-y-3">
            {pendingDrafts.map((d: any) => (
              <div key={d.id} className="p-5 rounded-xl bg-slate-900 border border-amber-500/30 space-y-3 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-white">{d.prospectName}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      Channel: {d.channel}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">To: {d.email || d.phone || 'No recipient'}</span>
                  </div>
                  <button
                    onClick={() => handleApproveDraft(d.id)}
                    disabled={isDispatchingAny}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all self-end sm:self-auto"
                  >
                    <Send className="w-3 h-3" />
                    {inFlightDraftIds[d.id] ? 'Sending via Brevo...' : 'Approve & Send via Brevo'}
                  </button>
                </div>
                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg text-xs text-slate-300 whitespace-pre-wrap font-mono text-[11px]">
                  {d.messageDraft}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* System Policy Approvals List */}
      <div className="space-y-4">
        {!loadingDrafts && !draftsError && approvals.length === 0 && pendingDrafts.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <h3 className="text-sm font-bold text-white">All Autonomous Actions Approved</h3>
            <p className="text-slate-400 text-xs max-w-sm mx-auto">
              No pending approvals in the human-in-the-loop queue. Click <strong>"Run Full Autonomous Cycle Now"</strong> to trigger discovery, audits, and new outreach drafts.
            </p>
          </div>
        ) : (
          approvals.map((req: any) => (
            <div key={req.id} className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-white">{req.title}</span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    {req.status}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-semibold">Risk Score:</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-extrabold ${
                    req.risk_score >= 60 ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {req.risk_score} / 100
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">{req.description}</p>

              {/* Risk Factors */}
              {req.risk_factors && req.risk_factors.length > 0 && (
                <div className="p-3.5 rounded-lg bg-slate-850 border border-slate-800 text-xs space-y-1.5">
                  <span className="text-slate-400 font-semibold block text-[11px] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    Triggered Risk Factors:
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-300 text-[11px]">
                    {req.risk_factors.map((factor: string, idx: number) => (
                      <li key={idx}>{factor}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Guard resolution controls to PENDING only */}
              {req.status === 'PENDING' && (
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-800">
                  <input
                    type="text"
                    placeholder="Optional review feedback..."
                    value={feedbackNotes[req.id] || ''}
                    onChange={(e) => setFeedbackNotes({ ...feedbackNotes, [req.id]: e.target.value })}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 flex-1"
                  />

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAction(req.id, 'REJECT')}
                      disabled={isDispatchingAny || loadingId === req.id}
                      className="px-3.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-bold text-xs transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleAction(req.id, 'APPROVE')}
                      disabled={isDispatchingAny || loadingId === req.id}
                      className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve Action
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};