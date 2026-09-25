import React, { useState } from 'react';
import { 
  Building2, 
  MapPin, 
  DollarSign, 
  Target, 
  Globe, 
  Sparkles, 
  ArrowRight,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { api } from '../../services/api.js';

interface BusinessOnboardingProps {
  onCompleted: (business: any) => void;
}

export const BusinessOnboarding: React.FC<BusinessOnboardingProps> = ({ onCompleted }) => {
  const [name, setName] = useState('');
  const [verticalId, setVerticalId] = useState('HEALTHCARE_CLINIC');
  const [verticalName, setVerticalName] = useState('Clinics, Healthcare & Diagnostics');
  const [city, setCity] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [monthlyBudgetINR, setMonthlyBudgetINR] = useState(25000);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [primaryLanguage, setPrimaryLanguage] = useState('English');
  const [goalTitle, setGoalTitle] = useState('Acquire 50 Qualified Customers in 60 Days');
  const [targetValue, setTargetValue] = useState(50);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verticals = [
    { id: 'HEALTHCARE_CLINIC', name: 'Clinics, Healthcare & Diagnostics' },
    { id: 'RESTAURANT_CAFE', name: 'Restaurants, Cafes & Food' },
    { id: 'REAL_ESTATE', name: 'Real Estate & Property Developers' },
    { id: 'EDUCATION_COACHING', name: 'Education, Test Prep & Coaching' },
    { id: 'SALON_SPA', name: 'Salons, Spas & Wellness' },
    { id: 'RETAIL_SERVICES', name: 'Retail, E-commerce & SMB Services' }
  ];

  const handleVerticalChange = (vId: string) => {
    setVerticalId(vId);
    const found = verticals.find(v => v.id === vId);
    if (found) setVerticalName(found.name);
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
      // 1. Create Business
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
        brandVoice: `Professional, authentic, customer-centric, and focused on transparent pricing in INR.`,
        valuePropositions: ['Verified Local Reputation', 'Transparent INR Pricing', 'Fast Response Guarantee'],
        offerings: [
          {
            id: `off_primary_${Date.now()}`,
            title: `Primary Service Offering`,
            description: `Core service package provided in ${city}.`,
            priceINR: monthlyBudgetINR > 0 ? Math.round(monthlyBudgetINR / 5) : 1000
          }
        ],
        monthlyBudgetINR,
        autonomyMode: 'CONTROLLED_AUTONOMY'
      });

      const newBizId = bizRes.data?.id;

      // 2. Create Primary Goal
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
    <div className="max-w-2xl mx-auto p-6 md:p-8 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-6 my-8">
      <div>
        <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider mb-1">
          <Building2 className="w-4 h-4" />
          Multi-Tenant Onboarding
        </div>
        <h2 className="text-2xl font-black text-white">Onboard a New Business</h2>
        <p className="text-slate-400 text-xs mt-1">
          Configure any real business to launch autonomous market intelligence, research, and tailored acquisition strategies.
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
              placeholder="e.g. Apex Health Clinic"
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
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">City *</label>
            <input
              type="text"
              required
              placeholder="e.g. Hyderabad, Bangalore, Mumbai"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Neighborhood / Area</label>
            <input
              type="text"
              placeholder="e.g. Indiranagar, Hitec City"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Monthly Marketing Budget (INR)</label>
            <input
              type="number"
              min="0"
              step="5000"
              value={monthlyBudgetINR}
              onChange={(e) => setMonthlyBudgetINR(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">Enter ₹0 to activate Zero-Budget Organic mode.</span>
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

          <div className="md:col-span-2">
            <label className="block text-slate-300 font-semibold mb-1">Growth Goal</label>
            <input
              type="text"
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-3 rounded-xl font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-lg shadow-cyan-500/25 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {isSubmitting ? (
              <span>Initializing Business Profile...</span>
            ) : (
              <>
                <span>Launch Business Platform</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
