import React, { useState, useEffect } from 'react';
import { 
  IndianRupee, 
  ArrowUpRight, 
  CreditCard, 
  CheckCircle2, 
  Zap, 
  Filter, 
  Plus, 
  ShieldCheck,
  TrendingUp,
  Clock,
  Sparkles,
  AlertCircle,
  Lock,
  Layers,
  Check
} from 'lucide-react';
import { api } from '../services/api.js';
import { formatINR, RevenueTruthSummary } from '@ai-marketing/shared';

export const Revenue: React.FC = () => {
  const [summary, setSummary] = useState<RevenueTruthSummary | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [aiCostSummary, setAICostSummary] = useState<any>(null);
  const [readiness, setReadiness] = useState<any>(null);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'REAL' | 'TEST' | 'SIMULATED'>('ALL');
  const [isIngesting, setIsIngesting] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Form states for transaction entry
  const [amount, setAmount] = useState('45000');
  const [method, setMethod] = useState('UPI');
  const [service, setService] = useState('Invisible Clear Aligners - Phase 1');
  const [classification, setClassification] = useState<'TEST' | 'REAL'>('TEST');
  const [verificationSource, setVerificationSource] = useState('BANK_STATEMENT');
  const [transactionRef, setTransactionRef] = useState('');

  const loadData = async () => {
    try {
      const [sumRes, txRes, costRes, readyRes, dashRes] = await Promise.all([
        api.getRevenueSummary(),
        api.getTransactions(filterMode === 'ALL' ? undefined : filterMode),
        api.getAICosts(),
        api.getSystemReadiness().catch(() => ({ data: null })),
        api.getDashboardAnalytics().catch(() => ({ data: null }))
      ]);
      setSummary(sumRes.data);
      setTransactions(txRes.data || []);
      setAICostSummary(costRes.data?.summary || null);
      setReadiness(readyRes.data || null);
      setAnalyticsData(dashRes.data || null);
    } catch (e) {
      console.error('Failed to load revenue data', e);
    }
  };

  useEffect(() => {
    loadData();
  }, [filterMode]);

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsIngesting(true);
    try {
      const invoiceNumber = `INV-SK-${Date.now().toString().slice(-4)}`;
      if (classification === 'REAL') {
        if (!transactionRef.trim()) {
          alert('External Transaction Reference (Bank UTR / Invoice Ref) is mandatory for REAL revenue.');
          setIsIngesting(false);
          return;
        }
        await api.post('/revenue/verified-entry', {
          invoiceNumber,
          amountINR: parseFloat(amount),
          paymentMethod: method,
          transactionRef: transactionRef.trim(),
          verificationSource,
          serviceRendered: service,
          campaignId: 'camp_seed_aligners_01'
        });
      } else {
        await api.recordTransaction({
          invoiceNumber,
          amountINR: parseFloat(amount),
          paymentMethod: method,
          paymentGateway: method === 'UPI' ? 'PHONEPE_PG' : 'RAZORPAY',
          classification,
          serviceRendered: service,
          campaignId: 'camp_seed_aligners_01'
        });
      }
      setShowModal(false);
      setTransactionRef('');
      await loadData();
    } catch (err: any) {
      alert(`Transaction creation failed: ${err.message || err.error}`);
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <IndianRupee className="w-6 h-6 text-emerald-400" />
            Revenue & Financial Truth Reconciliation
          </h2>
          <p className="text-sm text-slate-400">
            Scientifically verified clinic ledger: Real collections strictly separated from Sandbox tests and Simulated models.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Classification Filters */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
            {(['ALL', 'REAL', 'TEST', 'SIMULATED'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                  filterMode === mode
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/20"
          >
            <Plus className="w-4 h-4" />
            Ingest Transaction
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* REVENUE TRUTH AUDIT PANEL */}
      {/* ========================================================================= */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-emerald-500/30 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            <div>
              <h3 className="text-base font-bold text-white tracking-wide uppercase flex items-center gap-2">
                Revenue Truth & Attribution Audit
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  VERIFIED BY CLINIC OWNER
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Independent verification against bank statements & payment gateways with strict attribution tracing.
              </p>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <span className="text-[11px] text-slate-400 block">AI Cost Accounting</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/30">
              STATUS: {summary?.aiCostStatus || 'ESTIMATED'}
            </span>
          </div>
        </div>

        {/* Operational State & Experiment Metadata Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 mb-5 bg-slate-950/80 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Current State:</span>
            <span className={`px-2.5 py-1 rounded-md text-xs font-bold font-mono ${
              readiness?.operatingState === 'LIVE_EXPERIMENT' || readiness?.operatingState === 'PROFITABLE' || readiness?.operatingState === 'AUTONOMOUS_SCALING'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
            }`}>
              {readiness?.operatingState || readiness?.status || 'READY_FOR_REAL_EXPERIMENT'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div>
              <span className="text-slate-500 mr-1">Model:</span>
              <span className="font-mono text-slate-200">gemini-3.8-flash</span>
            </div>
            <div>
              <span className="text-slate-500 mr-1">Actual LLM Calls:</span>
              <span className="font-mono text-slate-200">{aiCostSummary?.total_calls ?? 0}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-1">Latest Campaign:</span>
              <span className="font-mono text-slate-200">Gachibowli Aligners (camp_seed_aligners_01)</span>
            </div>
          </div>
        </div>

        {/* 6-Column Truth Matrix */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {/* 1. Real Revenue Recorded */}
          <div className="p-3.5 bg-slate-950/70 rounded-xl border border-slate-800/80">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block mb-1">
              Real Recorded
            </span>
            <div className="text-lg font-bold text-white">
              {formatINR(summary?.realRevenueRecordedINR ?? 0)}
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">
              Clinic financial ledger
            </span>
          </div>

          {/* 2. Independently Verified */}
          <div className="p-3.5 bg-slate-950/70 rounded-xl border border-emerald-500/20">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-emerald-400 block mb-1">
              Indep. Verified
            </span>
            <div className="text-lg font-bold text-emerald-400">
              {formatINR(summary?.realRevenueIndependentlyVerifiedINR ?? 0)}
            </div>
            <span className="text-[10px] text-emerald-500/70 mt-1 block">
              Bank / Gateway audit
            </span>
          </div>

          {/* 3. Marketing-Attributed Real Revenue */}
          <div className="p-3.5 bg-slate-950/70 rounded-xl border border-cyan-500/30">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-cyan-300 block mb-1">
              Attributed Real Rev
            </span>
            <div className="text-lg font-bold text-cyan-400">
              {formatINR(summary?.realMarketingAttributedRevenueINR ?? 0)}
            </div>
            <span className="text-[10px] text-cyan-500/70 mt-1 block">
              Tied to ad campaigns
            </span>
          </div>

          {/* 4. Unattributed Real Revenue */}
          <div className="p-3.5 bg-slate-950/70 rounded-xl border border-slate-800/80">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block mb-1">
              Unattributed Rev
            </span>
            <div className="text-lg font-bold text-slate-300">
              {formatINR(summary?.unattributedRealRevenueINR ?? 0)}
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">
              Direct walk-in / referral
            </span>
          </div>

          {/* 5. Sandbox / Test Revenue */}
          <div className="p-3.5 bg-slate-950/70 rounded-xl border border-amber-500/20">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-amber-400 block mb-1">
              Test / Sandbox
            </span>
            <div className="text-lg font-bold text-amber-300">
              {formatINR(summary?.testRevenueINR ?? 0)}
            </div>
            <span className="text-[10px] text-amber-500/70 mt-1 block">
              Zero real impact
            </span>
          </div>

          {/* 6. Simulated Value */}
          <div className="p-3.5 bg-slate-950/70 rounded-xl border border-blue-500/20">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-blue-400 block mb-1">
              Simulated Value
            </span>
            <div className="text-lg font-bold text-blue-300">
              {formatINR(summary?.simulatedRevenueINR ?? 0)}
            </div>
            <span className="text-[10px] text-blue-500/70 mt-1 block">
              Modeled projection
            </span>
          </div>
        </div>

        {/* Real Funnel & Patient Journey Funnel */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60">
            <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">Visitors</span>
            <span className="text-base font-bold text-white font-mono">{analyticsData?.metrics?.totalVisitors ?? readiness?.metrics?.realLeadsCount ?? 0}</span>
            <span className="text-[9px] text-slate-500 block mt-0.5">Tracked sessions</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60">
            <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">Real Leads</span>
            <span className="text-base font-bold text-white font-mono">{readiness?.metrics?.realLeadsCount ?? 0}</span>
            <span className="text-[9px] text-slate-500 block mt-0.5">Verified inbound</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60">
            <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">Qualified Leads</span>
            <span className="text-base font-bold text-cyan-400 font-mono">{readiness?.metrics?.realConsultationsCount ?? 0}</span>
            <span className="text-[9px] text-slate-500 block mt-0.5">Criteria verified</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60">
            <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">Consultations</span>
            <span className="text-base font-bold text-white font-mono">{readiness?.metrics?.realConsultationsCount ?? 0}</span>
            <span className="text-[9px] text-slate-500 block mt-0.5">Attended / booked</span>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-xl border border-emerald-500/30">
            <span className="text-[10px] uppercase font-semibold text-emerald-400 block mb-0.5">Real Customers</span>
            <span className="text-base font-bold text-emerald-400 font-mono">{readiness?.metrics?.realCustomersCount ?? 0}</span>
            <span className="text-[9px] text-emerald-500/70 block mt-0.5">Treatment started</span>
          </div>
        </div>

        {/* Verified ROAS & Unit Economics Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-3 border-t border-slate-800 text-xs">
          <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
            <span className="text-slate-400 font-medium">Marketing Ad Spend</span>
            <span className="font-bold text-white font-mono">{formatINR(summary?.marketingSpendINR ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-cyan-950/20 rounded-lg border border-cyan-500/30">
            <span className="text-cyan-300 font-medium flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              Verified ROAS
            </span>
            <div className="text-right">
              <span className="font-bold text-cyan-400 text-base font-mono block">
                {summary?.verifiedRoas && summary.verifiedRoas > 0 ? `${summary.verifiedRoas.toFixed(2)}x` : '0.00x'}
              </span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                summary?.verifiedRoas && summary.verifiedRoas > 0
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {summary?.verifiedRoas && summary.verifiedRoas > 0 ? 'AUDITED ATTRIBUTION' : 'INSUFFICIENT VERIFIED DATA'}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between p-3 bg-emerald-950/20 rounded-lg border border-emerald-500/30">
            <span className="text-emerald-300 font-medium">Verified Marketing ROI</span>
            <span className="font-bold text-emerald-400 text-base font-mono">
              {summary?.verifiedRoi !== undefined ? `${(summary.verifiedRoi * 100).toFixed(1)}%` : '0.0%'}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 bg-purple-950/20 rounded-lg border border-purple-500/30">
            <span className="text-purple-300 font-medium flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              Total AI Cost
            </span>
            <span className="font-bold text-purple-300 font-mono">
              {formatINR(summary?.totalAICostINR ?? 0)}
            </span>
          </div>
        </div>
      </div>

      {/* AI Token & Unit Economics Breakdown */}
      <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          AI Unit Economics & Token Allocation (Gemini 3.8 Flash)
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
            <div className="text-slate-400">Total Tokens Consumed</div>
            <div className="text-lg font-bold text-white mt-1">
              {aiCostSummary?.totalTokens ? aiCostSummary.totalTokens.toLocaleString() : '0'}
            </div>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
            <div className="text-slate-400">AI Cost / Qualified Lead</div>
            <div className="text-lg font-bold text-cyan-400 mt-1">
              {summary?.aiCostPerQualifiedLeadINR ? formatINR(summary.aiCostPerQualifiedLeadINR) : '₹0.00'}
            </div>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
            <div className="text-slate-400">AI Cost / Paying Patient</div>
            <div className="text-lg font-bold text-purple-300 mt-1">
              {summary?.aiCostPerCustomerINR ? formatINR(summary.aiCostPerCustomerINR) : '₹0.00'}
            </div>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
            <div className="text-slate-400">Average Agent Latency</div>
            <div className="text-lg font-bold text-slate-200 mt-1">
              {aiCostSummary?.averageLatencyMs ? `${aiCostSummary.averageLatencyMs} ms` : 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* Transactions Audit Table */}
      <div className="rounded-xl bg-slate-900/70 border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-cyan-400" />
            Verified Transaction Feed ({transactions.length})
          </h3>
          <span className="text-xs text-slate-400">
            Showing filter: <strong className="text-slate-200">{filterMode}</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/70 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Amount (INR)</th>
                <th className="px-4 py-3">Payment Mode</th>
                <th className="px-4 py-3">Service Rendered</th>
                <th className="px-4 py-3">Attribution</th>
                <th className="px-4 py-3">Classification</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No transactions found for filter mode {filterMode}.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-medium text-slate-200">
                      {tx.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 font-semibold text-white">
                      {formatINR(tx.amountINR)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {tx.paymentMethod}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 max-w-xs truncate">
                      {tx.serviceRendered || 'General Dental Treatment'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={tx.campaignId ? 'text-cyan-400 font-medium' : 'text-slate-500'}>
                        {tx.campaignId ? 'Campaign Attributed' : 'Direct Walk-in'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          tx.classification === 'REAL'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : tx.classification === 'TEST'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                        }`}
                      >
                        {tx.classification}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1 text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {tx.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ingest Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-400" />
                Ingest New Transaction
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTransaction} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Amount in Indian Rupees (INR)
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Payment Method
                </label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                >
                  <option value="UPI">UPI (PhonePe, GPay, Paytm)</option>
                  <option value="NO_COST_EMI">0% No-Cost EMI (Bajaj Finserv, Pine Labs)</option>
                  <option value="CREDIT_CARD">Credit Card</option>
                  <option value="NETBANKING">Netbanking</option>
                  <option value="CASH">In-Clinic Cash</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Service Rendered
                </label>
                <input
                  type="text"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Data Classification
                </label>
                <select
                  value={classification}
                  onChange={(e: any) => setClassification(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                >
                  <option value="TEST">TEST (Sandbox Verification)</option>
                  <option value="REAL">REAL (Production Clinic Ledger - Owner Sign-off Required)</option>
                </select>
              </div>

              {classification === 'REAL' && (
                <div className="p-3 bg-emerald-950/30 border border-emerald-500/40 rounded-lg space-y-3">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-[11px]">
                    <Lock className="w-3.5 h-3.5" />
                    Clinic Owner Audit Verification
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Verification Source
                    </label>
                    <select
                      value={verificationSource}
                      onChange={(e) => setVerificationSource(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
                    >
                      <option value="BANK_STATEMENT">Clinic Bank Account Statement (HDFC/ICICI)</option>
                      <option value="RAZORPAY_PORTAL">Razorpay Settlement Dashboard</option>
                      <option value="CLINIC_POS_RECEIPT">In-Clinic EDC / POS Printed Slip</option>
                      <option value="PHONEPE_PG">PhonePe PG Settlement</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      External Transaction Reference / UTR
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. UTR-HDFC-98472917"
                      value={transactionRef}
                      onChange={(e) => setTransactionRef(e.target.value)}
                      required={classification === 'REAL'}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-[11px]"
                    />
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isIngesting}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1"
                >
                  {isIngesting ? 'Recording...' : 'Record Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
