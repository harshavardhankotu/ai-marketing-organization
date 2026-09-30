import React, { useState } from 'react';
import { ShieldCheck, KeyRound, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { api, ApiError } from '../../services/api.js';

interface OwnerLoginProps {
  onLoginSuccess: (session: any) => void;
}

export const OwnerLogin: React.FC<OwnerLoginProps> = ({ onLoginSuccess }) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setErrorMessage('Please enter your Owner API Key.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      // 1. Authenticate with backend and establish HttpOnly owner_session cookie
      await api.loginOwner(trimmedKey);

      // 2. Explicitly verify that the session cookie was accepted and principal is authenticated
      const sessionRes = await api.getOwnerSession();
      if (!sessionRes?.data || !sessionRes?.data?.user_id) {
        throw new Error('Session establishment could not be verified by backend.');
      }

      // 3. Clear sensitive input from component memory immediately
      setApiKey('');

      // 4. Notify parent app of successful authentication
      onLoginSuccess(sessionRes.data);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        setErrorMessage('Invalid owner credentials. Please check your OWNER_API_KEY.');
      } else if (err instanceof ApiError && err.status === 0) {
        setErrorMessage('Network error: Unable to connect to backend server. Verify the server is running.');
      } else {
        setErrorMessage(err?.message || 'Authentication failed. Please check server logs.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 py-12 font-sans selection:bg-cyan-500 selection:text-white">
      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
        {/* Header Icon & Brand */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-500/20 mb-4">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Owner Sign In</h1>
          <p className="text-sm text-slate-400 mt-2">
            AI Marketing Organization Engine
          </p>
          <span className="mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
            Protected Admin Boundary
          </span>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-3 animate-shake">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="owner-api-key" className="block text-xs font-semibold text-slate-300 mb-2">
              Owner API Key / Secret
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <KeyRound className="w-4 h-4" />
              </div>
              <input
                id="owner-api-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={loading}
                autoFocus
                autoComplete="current-password"
                placeholder="Enter OWNER_API_KEY..."
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-10 pr-11 py-2.5 text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200 transition-colors"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Authenticated via server-verified HttpOnly session cookie. Never stored in local storage.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="w-full py-2.5 px-4 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 shadow-lg shadow-cyan-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Authenticating Session...</span>
              </>
            ) : (
              <span>Sign In to Dashboard</span>
            )}
          </button>
        </form>

        {/* Footer info */}
        <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
          <p className="text-[11px] text-slate-500">
            India Single-Owner Instance • Strict Fail-Closed Security
          </p>
        </div>
      </div>
    </div>
  );
};
