import React, { useState } from 'react';
import { AlertOctagon, Play, ShieldAlert, Cpu, Sparkles, Server, Globe, Check, X } from 'lucide-react';
import { getApiBaseUrl, setApiBaseUrl } from '../../services/api';

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
  const [showApiModal, setShowApiModal] = useState(false);
  const [currentApiUrl, setCurrentApiUrl] = useState(getApiBaseUrl());
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSaveApiUrl = (newUrl: string) => {
    setApiBaseUrl(newUrl);
    setCurrentApiUrl(getApiBaseUrl());
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setShowApiModal(false);
      window.location.reload();
    }, 600);
  };
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

        {/* Backend API Server Status & Configuration */}
        <button
          onClick={() => setShowApiModal(true)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
            currentApiUrl.includes('localhost')
              ? 'bg-slate-800 text-cyan-400 border-cyan-500/30 hover:border-cyan-500/60'
              : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'
          }`}
          title="Configure Backend API Server URL"
        >
          <Server className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {currentApiUrl.includes('localhost') ? 'API: Local (3001)' : 'API: Connected'}
          </span>
        </button>

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

      {/* Backend API Configuration Modal */}
      {showApiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold">
                <Server className="w-5 h-5 text-cyan-400" />
                <span>Backend API Connection</span>
              </div>
              <button
                onClick={() => setShowApiModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Configure the API server that powers the autonomous growth agents, SQLite database, and Razorpay reconciliation engine.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 block">
                API Base URL
              </label>
              <input
                type="text"
                value={currentApiUrl}
                onChange={(e) => setCurrentApiUrl(e.target.value)}
                placeholder="http://localhost:3001/api/v1"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex flex-wrap gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => setCurrentApiUrl('http://localhost:3001/api/v1')}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono"
              >
                Preset: http://localhost:3001/api/v1
              </button>
              <button
                type="button"
                onClick={() => setCurrentApiUrl('/api/v1')}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 font-mono"
              >
                Preset: /api/v1 (Same Origin)
              </button>
            </div>

            {savedSuccess && (
              <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                <span>Saved! Reloading page to connect...</span>
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowApiModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSaveApiUrl(currentApiUrl)}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold"
              >
                Save &amp; Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};