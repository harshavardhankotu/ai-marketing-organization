import React, { useState } from 'react';
import {
  Building2,
  ArrowRight,
  AlertCircle,
  Search,
  ExternalLink,
  CheckCircle2
} from 'lucide-react';
import { api } from '../../services/api.js';

interface BusinessOnboardingProps {
  onCompleted: (business: any) => void;
}

export const BusinessOnboarding: React.FC<BusinessOnboardingProps> = ({ onCompleted }) => {
  const [name, setName] = useState('');
  const [verticalId, setVerticalId] = useState('RETAIL_SERVICES');
  const [verticalName, setVerticalName] = useState('Retail, E-commerce & SMB Services');
  const [city, setCity] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [monthlyBudgetINR, setMonthlyBudgetINR] = useState(0);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [primaryLanguage, setPrimaryLanguage] = useState('English');
  const [goalTitle, setGoalTitle] = useState('Generate First Verified Customers via Organic & Direct Channels');
  const [targetValue, setTargetValue] = useState(50);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Interactive SiteFix URL Scanner state
  const [scanUrl, setScanUrl] = useState('');
  const [scanBizName, setScanBizName] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<any | null>(null);

  const verticals = [
    { id: 'RETAIL_SERVICES', name: 'Retail, E-commerce & SMB Services' },
    { id: 'RESTAURANT_CAFE', name: 'Restaurants, Cafes & Food' },
    { id: 'REAL_ESTATE', name: 'Real Estate & Property Developers' },
    { id: 'EDUCATION_COACHING', name: 'Education, Test Prep & Coaching' },
    { id: 'SALON_SPA', name: 'Salons, Spas & Wellness' },
    { id: 'HEALTHCARE_CLINIC', name: 'Clinics & Diagnostics (Regulated — No Autonomous Cold Outreach)' }
  ];

  const handleVerticalChange = (vId: string) => {
    setVerticalId(vId);
    const found = verticals.find(v => v.id === vId);
    if (found) setVerticalName(found.name);
  };

  const handleRunSiteScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanUrl.trim()) {
      setScanError('Enter a target business URL (e.g. https://example.com) to inspect.');
      return;
    }
    setScanning(true);
    setScanError(null);
    try {
      const res = await api.scanSiteAudit({
        url: scanUrl.trim(),
        businessName: scanBizName.trim() || undefined
      });
      const raw = res?.result || res?.data || res;
      const defects = Array.isArray(raw?.defects)
        ? raw.defects
        : Array.isArray(raw?.findings)
        ? raw.findings.filter((f: any) => f.status !== 'PASS')
        : [];
      setScanResult({
        ...raw,
        businessName: raw?.businessName || raw?.preview?.title || raw?.domain || scanBizName.trim(),
        performanceScore: raw?.performanceScore ?? raw?.pageSpeed?.performanceScore ?? null,
        seoScore: raw?.seoScore ?? raw?.pageSpeed?.seoScore ?? raw?.score ?? null,
        targetUrl: raw?.targetUrl || raw?.url || scanUrl.trim(),
        defects
      });
    } catch (err: any) {
      setScanError(err?.data?.error || err?.message || 'Site audit scan failed.');
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !city.trim()) {
      setError('Please provide at least a Business Name and City.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const bizRes = await api.createBusiness({
        name: name.trim(),
        verticalId,
        verticalName,
        city: city.trim(),
        neighborhood: neighborhood.trim(),
        websiteUrl: websiteUrl.trim() || undefined,
        phone: phone.trim() || undefined,
        primaryLanguage,
        secondaryLanguages: ['Hindi'],
        brandVoice: 'Transparent pricing in INR, concise factual communication, zero synthetic hype.',
        valuePropositions: ['Verified Local Reputation', 'Transparent INR Pricing', 'Fast Response Guarantee'],
        offerings: [
          {
            id: `off_primary_${Date.now()}`,
            title: 'SiteFix Technical Diagnostic & Implementation Pack',
            description: `Direct technical growth offering for ${city}.`,
            priceINR: 499
          }
        ],
        monthlyBudgetINR,
        autonomyMode: 'CONTROLLED_AUTONOMY'
      });

      const newBizId = bizRes.data?.id;

      if (newBizId) {
        await api.createGoal({
          businessId: newBizId,
          title: goalTitle.trim(),
          targetMetric: 'qualified_leads',
          targetValue,
          metricUnit: 'leads',
          timeframeDays: 60,
          budgetAllocatedINR: monthlyBudgetINR,
          kpis: [
            { name: 'Target Leads', baseline: 0, target: targetValue, current: 0, unit: 'leads' }
          ]
        }).catch(() => {});
      }

      onCompleted({
        id: newBizId,
        name,
        vertical_id: verticalId,
        vertical_name: verticalName,
        city,
        neighborhood,
        monthlyBudgetINR
      });
    } catch (err: any) {
      setError(err.message || 'Failed to onboard business');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 my-4">
      {/* Live SiteFix URL Scanner (Instant Technical Diagnostic) */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Search className="w-4 h-4 text-cyan-400" />
              Live SiteFix URL Scanner &amp; HTML Defect Inspector
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Scan any commercial website to inspect live HTML defects, performance scores, and generate a ₹499 Fix-Pack checkout link.
            </p>
          </div>
          <a
            href="/tools/site-audit"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-cyan-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <span>Open Public Audit Page</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <form onSubmit={handleRunSiteScan} className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
          <input
            type="url"
            value={scanUrl}
            onChange={(e) => setScanUrl(e.target.value)}
            placeholder="https://merchant-site.in"
            required
            className="md:col-span-6 px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500 font-mono"
          />
          <input
            type="text"
            value={scanBizName}
            onChange={(e) => setScanBizName(e.target.value)}
            placeholder="Business Name (optional)"
            className="md:col-span-3 px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            disabled={scanning}
            className="md:col-span-3 px-4 py-2.5 rounded-lg font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 transition-colors"
          >
            {scanning ? 'Scanning Site...' : 'Run Live Scan'}
          </button>
        </form>

        {scanError && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{scanError}</span>
          </div>
        )}

        {scanResult && (
          <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{scanResult.businessName || scanResult.domain || scanUrl}</span>
              </div>
              <div className="font-mono tabular-nums text-slate-300">
                <span>Perf: {scanResult.performanceScore ?? '—'}</span>
                <span aria-hidden="true"> · </span>
                <span>SEO: {scanResult.seoScore ?? '—'}</span>
                <span aria-hidden="true"> · </span>
                <span className="text-amber-300">Defects: {Array.isArray(scanResult.defects) ? scanResult.defects.length : (scanResult.defectCount ?? 0)}</span>
              </div>
            </div>

            {Array.isArray(scanResult.defects) && scanResult.defects.length > 0 && (
              <ul className="space-y-1 text-slate-300 border-t border-slate-800 pt-2">
                {scanResult.defects.slice(0, 5).map((def: any, idx: number) => (
                  <li key={idx} className="flex items-start justify-between gap-3">
                    <span>{def.title || def.code || def.issue}</span>
                    <span className="font-mono text-[11px] text-slate-400 shrink-0">{def.severity || 'WARN'}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <span className="text-slate-400 font-mono truncate">{scanResult.targetUrl || scanUrl}</span>
              <a
                href={`/tools/site-audit?url=${encodeURIComponent(scanResult.targetUrl || scanUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold inline-flex items-center gap-1"
              >
                <span>Open Fix-Pack Checkout (₹499)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Business Workspace Configuration */}
      <div className="p-6 md:p-8 rounded-xl bg-slate-900 border border-slate-800 space-y-6">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider mb-1">
            <Building2 className="w-4 h-4" />
            Workspace Target Configuration
          </div>
          <h2 className="text-xl font-bold text-white">Onboard a Commercial Business Profile</h2>
          <p className="text-slate-400 text-xs mt-1">
            Configure target market geography, zero-budget organic mode, and language settings. Autonomous cold outreach stays disabled for regulated medical/dental domains per Standing Order #8.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Business Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Bharat Direct Commerce"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Industry Vertical *</label>
              <select
                value={verticalId}
                onChange={(e) => handleVerticalChange(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
              >
                {verticals.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              {verticalId === 'HEALTHCARE_CLINIC' && (
                <p className="text-[11px] text-amber-300 mt-1">
                  Standing Order #8: Outbound cold email/messaging is permanently blocked for healthcare &amp; dental domains.
                </p>
              )}
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">City *</label>
              <input
                type="text"
                required
                placeholder="e.g. Hyderabad, Bengaluru, Mumbai"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Website URL</label>
              <input
                type="url"
                placeholder="https://example.in"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Monthly Paid Media Budget (INR)</label>
              <input
                type="number"
                min="0"
                step="1000"
                value={monthlyBudgetINR}
                onChange={(e) => setMonthlyBudgetINR(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500 font-mono tabular-nums"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">Default ₹0 locks Zero-Budget Organic Policy.</span>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Primary Language</label>
              <select
                value={primaryLanguage}
                onChange={(e) => setPrimaryLanguage(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
                <option value="Telugu">Telugu</option>
                <option value="Tamil">Tamil</option>
                <option value="Kannada">Kannada</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Neighborhood / Region</label>
              <input
                type="text"
                placeholder="e.g. Pan-India / Indiranagar"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Contact Phone (Optional)</label>
              <input
                type="text"
                placeholder="+91..."
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Primary Growth Goal</label>
              <input
                type="text"
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Target Leads</label>
              <input
                type="number"
                min="1"
                value={targetValue}
                onChange={(e) => setTargetValue(Math.max(1, Number(e.target.value) || 50))}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500 font-mono tabular-nums"
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-lg font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              <span>{isSubmitting ? 'Initializing Workspace...' : 'Save Business Profile'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
