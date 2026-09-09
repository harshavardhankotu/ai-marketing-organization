import React, { useState } from 'react';
import { 
  CheckSquare, 
  ShieldAlert, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  MessageSquare,
  AlertTriangle
} from 'lucide-react';

interface ApprovalsProps {
  approvals: any[];
  onResolve: (data: { requestId: string; action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES'; feedbackNotes?: string }) => Promise<void>;
}

export const Approvals: React.FC<ApprovalsProps> = ({ approvals, onResolve }) => {
  const [feedbackNotes, setFeedbackNotes] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

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

  const sampleApprovals = approvals.length > 0 ? approvals : [
    {
      id: 'apr_sample_01',
      title: 'Review High-Budget WhatsApp Broadcast Campaign',
      description: 'Campaign allocates ₹25,000 for Clear Aligners broadcast to 12,000 Western Hyderabad residents. Requires human sign-off due to spend threshold and medical sector regulation.',
      entity_type: 'CAMPAIGN',
      risk_score: 65,
      risk_factors: [
        'Healthcare regulated sector (Medical Council compliance)',
        'Budget commitment > ₹10,000 INR',
        'Direct patient communication channel (WhatsApp Business)'
      ],
      status: 'PENDING',
      created_at: new Date().toISOString()
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
          <CheckSquare className="w-5 h-5 text-cyan-400" />
          Human-in-the-Loop Approval Queue
        </h2>
        <p className="text-slate-400 text-xs mt-1">
          High-impact actions, large financial commitments, and regulated healthcare claims require explicit human oversight.
        </p>
      </div>

      {/* Approvals List */}
      <div className="space-y-4">
        {sampleApprovals.map((req: any) => (
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
            <div className="p-3.5 rounded-lg bg-slate-850 border border-slate-800 text-xs space-y-1.5">
              <span className="text-slate-400 font-semibold block text-[11px] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                Triggered Risk Factors:
              </span>
              <ul className="list-disc list-inside space-y-0.5 text-slate-300 text-[11px]">
                {(req.risk_factors || []).map((factor: string, idx: number) => (
                  <li key={idx}>{factor}</li>
                ))}
              </ul>
            </div>

            {/* Action Bar */}
            {req.status === 'PENDING' && (
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-800">
                <input
                  type="text"
                  placeholder="Optional review feedback notes for agent..."
                  value={feedbackNotes[req.id] || ''}
                  onChange={(e) => setFeedbackNotes({ ...feedbackNotes, [req.id]: e.target.value })}
                  className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 flex-1 focus:outline-none focus:border-cyan-500"
                />

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAction(req.id, 'REJECT')}
                    disabled={loadingId === req.id}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 transition-all"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleAction(req.id, 'APPROVE')}
                    disabled={loadingId === req.id}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-all shadow-md shadow-emerald-400/20"
                  >
                    {loadingId === req.id ? 'Processing...' : 'Approve & Execute'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};