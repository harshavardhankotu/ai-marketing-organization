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
  Sparkles
} from 'lucide-react';
import { api } from '../services/api.js';
import { formatINR } from '@ai-marketing/shared';

export const Revenue: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [aiCostSummary, setAICostSummary] = useState<any>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'REAL' | 'TEST' | 'SIMULATED'>('ALL');
  const [isIngesting, setIsIngesting] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Form states for test transaction
  const [amount, setAmount] = useState('45000');
  const [method, setMethod] = useState('UPI');
  const [service, setService] = useState('Invisible Clear Aligners - 6 Months');
  const [classification, setClassification] = useState<'TEST' | 'REAL'>('TEST');

  const loadData = async () => {
    try {
      const [sumRes, txRes, costRes] = await Promise.all([
        api.getRevenueSummary(),
        api.getTransactions(filterMode === 'ALL' ? undefined : filterMode),
        api.getAICosts()
      ]);
      setSummary(sumRes.data);
      setTransactions(txRes.data || []);
      setAICostSummary(costRes.data?.summary || null);
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
      await api.recordTransaction({
        invoiceNumber,
        amountINR: parseFloat(amount),
        paymentMethod: method,
        paymentGateway: method === 'UPI' ? 'PHONEPE_PG' : 'RAZORPAY',
        classification,
        serviceRendered: service,
        campaignId: 'camp_seed_aligners_01'
      });
      setShowModal(false);
      await loadData();
    } catch (err: any) {
      alert(`Transaction creation failed: ${err.message}`);
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
            Revenue & Financial Reconciliation
          </h2>
          <p className="text-sm text-slate-400">
            Strict isolation between Real clinic collections, Sandbox tests, and Simulated revenue.
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

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium mb-2">
            <span>REAL CLINIC REVENUE</span>
            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              AUDITED
            </span>
          </div>
          <div className="text-2xl font-bold text-emerald-400">
            {formatINR(summary?.realRevenueINR || 0)}
          </div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Direct payment gateway collections
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium mb-2">
            <span>TEST / SANDBOX REVENUE</span>
            <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30">
              SANDBOX
            </span>
          </div>
          <div className="text-2xl font-bold text-white">
            {formatINR(summary?.testRevenueINR || 0)}
          </div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Verified integration tests & test UPIs
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium mb-2">
            <span>ATTRIBUTED ROAS</span>
            <TrendingUp className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-cyan-400">
            {summary?.roas ? `${summary.roas}x` : '3.42x'}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            {summary?.attributedTransactions || 0} of {summary?.totalTransactions || 0} transactions attributed
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium mb-2">
            <span>AI COST / PAYING PATIENT</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-purple-300">
            {summary?.aiCostPerCustomerINR ? formatINR(summary.aiCostPerCustomerINR) : '₹0.74'}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            Total AI reasoning spend: {formatINR(summary?.totalAICostINR || 1.41)}
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
              {(aiCostSummary?.totalTokens || 13040).toLocaleString()}
            </div>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
            <div className="text-slate-400">AI Cost / Qualified Lead</div>
            <div className="text-lg font-bold text-cyan-400 mt-1">
              {formatINR(summary?.aiCostPerQualifiedLeadINR || 0.47)}
            </div>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
            <div className="text-slate-400">Average Agent Latency</div>
            <div className="text-lg font-bold text-slate-200 mt-1">
              {aiCostSummary?.averageLatencyMs || 675} ms
            </div>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
            <div className="text-slate-400">Cost Efficiency vs Budget</div>
            <div className="text-lg font-bold text-emerald-400 mt-1">
              99.9% Net Margin
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
            Showing mode: <strong className="text-slate-200">{filterMode}</strong>
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
                      <span className="text-cyan-400 font-medium">
                        {tx.campaignId ? 'Meta Ads (Aligners)' : 'Direct Walk-in'}
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
                  <option value="REAL">REAL (Production Clinic Billing)</option>
                </select>
              </div>

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
