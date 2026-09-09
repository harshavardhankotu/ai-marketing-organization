import React, { useState } from 'react';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';

interface KillSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  killSwitchActive: boolean;
  onConfirm: (reason: string) => Promise<void>;
}

export const KillSwitchModal: React.FC<KillSwitchModalProps> = ({
  isOpen,
  onClose,
  killSwitchActive,
  onConfirm
}) => {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setLoading(true);
    try {
      await onConfirm(reason);
      setReason('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl relative">
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">
              {killSwitchActive ? 'Reset Emergency Kill Switch' : 'Trigger Global Kill Switch'}
            </h3>
            <p className="text-xs text-slate-400">
              {killSwitchActive
                ? 'Resume paused workflows and restore marketing organization operations.'
                : 'Instantly halts all autonomous agents, pauses publications, and locks budgets.'}
            </p>
          </div>
        </div>

        {!killSwitchActive && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <span>
              All active campaigns will be paused. Active Gemini background tasks will be terminated immediately. State is preserved.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Reason for {killSwitchActive ? 'Reset' : 'Emergency Stop'}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={3}
              placeholder={
                killSwitchActive 
                  ? 'e.g. Audit completed, clinic schedule cleared for patient bookings.' 
                  : 'e.g. Ad creative review pending, doctor unavailable for next 48 hours.'
              }
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !reason.trim()}
              className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition-all disabled:opacity-50 ${
                killSwitchActive
                  ? 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/30'
                  : 'bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/30'
              }`}
            >
              {loading 
                ? 'Processing...' 
                : killSwitchActive 
                  ? 'Confirm Reset & Resume' 
                  : 'Engage Emergency Stop'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};