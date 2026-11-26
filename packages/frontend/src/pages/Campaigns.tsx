import React, { useMemo, useState } from 'react';
import {
  Compass,
  Plus,
  FlaskConical,
  Search,
  BarChart3,
  Play,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  ExternalLink
} from 'lucide-react';
import { formatINR } from '@ai-marketing/shared';
import { api } from '../services/api.js';

interface CampaignsProps {
  campaigns: any[];
  experiments?: any[];
  onTriggerCycle: () => void;
  isCycleRunning: boolean;
  onRefresh?: () => Promise<void> | void;
  onNavigateTab?: (tab: any) => void;
}

interface VariationDraft {
  id: string;
  name: string;
  objective: string;
  targetAudience: string;
  channels: string[];
  budgetINR: number;
  callToAction: string;
  trafficSplitPercent: number;
}

const AVAILABLE_CHANNELS = [
  'WHATSAPP',
  'GOOGLE_BUSINESS_PROFILE',
  'INSTAGRAM',
  'GOOGLE_ADS',
  'META_ADS',
  'SEO_CONTENT'
];

const OUTCOME_TEXT_CLASS: Record<string, string> = {
  SCALE: 'text-emerald-400',
  STOP: 'text-rose-400',
  MODIFY: 'text-amber-400',
  RERUN: 'text-cyan-400',
  INCONCLUSIVE: 'text-slate-400'
};

function getSafeMetrics(exp: any) {
  const m = exp?.metrics || {};
  const baselineSamples = Number(m.baselineSamples ?? 0);
  const baselineConversions = Number(m.baselineConversions ?? 0);
  const treatmentSamples = Number(m.treatmentSamples ?? 0);
  const treatmentConversions = Number(m.treatmentConversions ?? 0);
  const baselineCR = baselineSamples > 0 ? (baselineConversions / baselineSamples) * 100 : 0;
  const treatmentCR = treatmentSamples > 0 ? (treatmentConversions / treatmentSamples) * 100 : 0;
  const upliftPercent =
    m.upliftPercent !== undefined
      ? Number(m.upliftPercent)
      : baselineCR > 0
      ? Number((((treatmentCR - baselineCR) / baselineCR) * 100).toFixed(1))
      : treatmentCR > 0
      ? 100
      : 0;

  return {
    baselineSamples,
    baselineConversions,
    treatmentSamples,
    treatmentConversions,
    baselineCR,
    treatmentCR,
    upliftPercent,
    pVal: Number(m.pVal ?? 1.0),
    variantLabel: m.variantLabel || exp?.title || 'Variation',
    variationConfig: m.variationConfig || null,
    baselineConfig: m.baselineConfig || null
  };
}

export const Campaigns: React.FC<CampaignsProps> = ({
  campaigns,
  experiments = [],
  onTriggerCycle,
  isCycleRunning,
  onRefresh,
  onNavigateTab
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'AB_TESTED'>('ALL');
  const [expandedCampaignIds, setExpandedCampaignIds] = useState<Record<string, boolean>>({});

  // A/B Test Modal State
  const [isAbModalOpen, setIsAbModalOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [testTitle, setTestTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [baselineCallToAction, setBaselineCallToAction] = useState('');
  const [successMetric, setSuccessMetric] = useState('qualified_leads');
  const [expectedEffect, setExpectedEffect] = useState('+25% qualified lead conversion rate');
  const [minimumEvidenceRequirement, setMinimumEvidenceRequirement] = useState(30);
  const [variations, setVariations] = useState<VariationDraft[]>([]);
  const [isSubmittingAb, setIsSubmittingAb] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Automated comparison & cohort input state
  const [comparingCampaignId, setComparingCampaignId] = useState<string | null>(null);
  const [comparingExpId, setComparingExpId] = useState<string | null>(null);
  const [editingMetricsExpId, setEditingMetricsExpId] = useState<string | null>(null);
  const [cohortDraft, setCohortDraft] = useState<{
    baselineSamples: number;
    baselineConversions: number;
    treatmentSamples: number;
    treatmentConversions: number;
  }>({
    baselineSamples: 100,
    baselineConversions: 8,
    treatmentSamples: 100,
    treatmentConversions: 18
  });
  const [feedbackBanner, setFeedbackBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [comparisons, setComparisons] = useState<any[]>([]);
  const [buyerGuides, setBuyerGuides] = useState<any[]>([]);
  const [telegramStatus, setTelegramStatus] = useState<any>(null);
  const [igStatus, setIgStatus] = useState<any>(null);

  React.useEffect(() => {
    Promise.all([
      api.getPublicComparisons(6).catch(() => null),
      api.getPublicBuyerGuides(6).catch(() => null),
      api.getTelegramStatus().catch(() => null),
      api.getInstagramStatus().catch(() => null)
    ]).then(([cmpRes, guideRes, tgRes, igRes]) => {
      const cmpList = cmpRes?.comparisons ?? cmpRes?.data?.comparisons ?? (Array.isArray(cmpRes?.data) ? cmpRes.data : []);
      const guideList = guideRes?.guides ?? guideRes?.data?.guides ?? (Array.isArray(guideRes?.data) ? guideRes.data : []);
      setComparisons(Array.isArray(cmpList) ? cmpList : []);
      setBuyerGuides(Array.isArray(guideList) ? guideList : []);
      setTelegramStatus(tgRes?.data || tgRes || null);
      setIgStatus(igRes?.data || igRes || null);
    });
  }, []);

  const experimentsByCampaign = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const exp of experiments) {
      if (exp.campaign_id) {
        if (!map[exp.campaign_id]) map[exp.campaign_id] = [];
        map[exp.campaign_id].push(exp);
      }
    }
    return map;
  }, [experiments]);

  const filteredCampaigns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return campaigns.filter((camp: any) => {
      const campExps = experimentsByCampaign[camp.id] || [];
      if (statusFilter === 'ACTIVE' && String(camp.status || '').toUpperCase() !== 'ACTIVE') {
        return false;
      }
      if (statusFilter === 'AB_TESTED' && campExps.length === 0) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        camp.title,
        camp.objective,
        camp.target_audience,
        camp.geography?.city,
        ...(Array.isArray(camp.channels) ? camp.channels : [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [campaigns, experimentsByCampaign, searchQuery, statusFilter]);

  const populateModalForCampaign = (camp: any) => {
    const channels = Array.isArray(camp.channels) && camp.channels.length > 0
      ? camp.channels
      : ['WHATSAPP', 'GOOGLE_BUSINESS_PROFILE'];
    setSelectedCampaignId(camp.id);
    setTestTitle(`${camp.title} — Messaging & Channel Split`);
    setHypothesis(
      `Testing a sharper value-driven offer variation against "${camp.title}" baseline will lift ${camp.primary_kpi || 'qualified_leads'} by >= 20%.`
    );
    setBaselineCallToAction(`Standard ${camp.primary_kpi || 'consultation'} CTA`);
    setSuccessMetric(camp.primary_kpi || 'qualified_leads');
    setExpectedEffect('+25% qualified lead conversion rate');
    setMinimumEvidenceRequirement(30);
    setVariations([
      {
        id: `var_${Date.now()}`,
        name: 'Variant B — Transparent Pricing + Direct WhatsApp CTA',
        objective: camp.objective || '',
        targetAudience: camp.target_audience || '',
        channels,
        budgetINR: Number(camp.budget_inr) || 0,
        callToAction: 'Book instant slot on WhatsApp with upfront pricing',
        trafficSplitPercent: 50
      }
    ]);
    setModalError(null);
  };

  const openAbModal = (campaign?: any) => {
    const target = campaign || campaigns[0];
    if (!target) {
      setFeedbackBanner({
        type: 'error',
        text: 'Launch or create a campaign flight before creating an A/B test variation.'
      });
      return;
    }
    populateModalForCampaign(target);
    setIsAbModalOpen(true);
  };

  const handleCampaignSelectionChange = (campaignId: string) => {
    const found = campaigns.find((c: any) => c.id === campaignId);
    if (found) {
      populateModalForCampaign(found);
    }
  };

  const addVariation = () => {
    const source = campaigns.find((c: any) => c.id === selectedCampaignId);
    const nextLetter = String.fromCharCode(66 + variations.length);
    const equalSplit = Math.max(10, Math.floor(100 / (variations.length + 2)));
    setVariations((prev) => [
      ...prev.map((v) => ({ ...v, trafficSplitPercent: equalSplit })),
      {
        id: `var_${Date.now()}_${prev.length}`,
        name: `Variant ${nextLetter} — Localized Offer Hook`,
        objective: source?.objective || '',
        targetAudience: source?.target_audience || '',
        channels: Array.isArray(source?.channels) && source.channels.length > 0 ? source.channels : ['WHATSAPP'],
        budgetINR: Number(source?.budget_inr) || 0,
        callToAction: 'Claim limited-window priority assessment',
        trafficSplitPercent: equalSplit
      }
    ]);
  };

  const removeVariation = (varId: string) => {
    if (variations.length <= 1) return;
    setVariations((prev) => prev.filter((v) => v.id !== varId));
  };

  const updateVariation = (varId: string, patch: Partial<VariationDraft>) => {
    setVariations((prev) => prev.map((v) => (v.id === varId ? { ...v, ...patch } : v)));
  };

  const toggleVariationChannel = (varId: string, channel: string) => {
    setVariations((prev) =>
      prev.map((v) => {
        if (v.id !== varId) return v;
        const exists = v.channels.includes(channel);
        const nextChannels = exists
          ? v.channels.filter((c) => c !== channel)
          : [...v.channels, channel];
        return {
          ...v,
          channels: nextChannels.length > 0 ? nextChannels : [channel]
        };
      })
    );
  };

  const handleSubmitAbTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampaignId) {
      setModalError('Select a campaign to test.');
      return;
    }
    if (variations.some((v) => !v.name.trim())) {
      setModalError('Every variation needs a descriptive name.');
      return;
    }

    setIsSubmittingAb(true);
    setModalError(null);
    try {
      const source = campaigns.find((c: any) => c.id === selectedCampaignId);
      const res = await api.createCampaignAbTest(selectedCampaignId, {
        title: testTitle.trim() || undefined,
        hypothesis: hypothesis.trim(),
        baseline: {
          label: 'Control (Original Campaign)',
          objective: source?.objective,
          targetAudience: source?.target_audience,
          channels: source?.channels || [],
          budgetINR: Number(source?.budget_inr) || 0,
          callToAction: baselineCallToAction.trim() || 'Original campaign CTA'
        },
        variations: variations.map((v) => ({
          name: v.name.trim(),
          objective: v.objective.trim(),
          targetAudience: v.targetAudience.trim(),
          channels: v.channels,
          budgetINR: Number(v.budgetINR) || 0,
          callToAction: v.callToAction.trim(),
          trafficSplitPercent: Number(v.trafficSplitPercent) || 50
        })),
        successMetric,
        expectedEffect: expectedEffect.trim(),
        minimumEvidenceRequirement: Number(minimumEvidenceRequirement) || 30
      });

      setExpandedCampaignIds((prev) => ({ ...prev, [selectedCampaignId]: true }));
      setIsAbModalOpen(false);
      setFeedbackBanner({
        type: 'success',
        text: `Created ${res?.data?.experiments?.length || variations.length} campaign A/B variation(s) for "${source?.title || 'campaign'}".`
      });
      await onRefresh?.();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to create campaign A/B test.');
    } finally {
      setIsSubmittingAb(false);
    }
  };

  const handleRunCampaignComparison = async (campaignId: string) => {
    setComparingCampaignId(campaignId);
    setFeedbackBanner(null);
    try {
      const res = await api.compareCampaignAbTests(campaignId);
      const top = res?.data?.topRecommendation;
      setExpandedCampaignIds((prev) => ({ ...prev, [campaignId]: true }));
      setFeedbackBanner({
        type: 'success',
        text: top
          ? `Automated comparison complete: ${top.outcome} — ${top.decisionSummary}`
          : 'Automated performance comparison completed.'
      });
      await onRefresh?.();
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: err?.message || 'Failed to run automated performance comparison.'
      });
    } finally {
      setComparingCampaignId(null);
    }
  };

  const openCohortEditor = (exp: any) => {
    const m = getSafeMetrics(exp);
    setEditingMetricsExpId(exp.id);
    setCohortDraft({
      baselineSamples: m.baselineSamples > 0 ? m.baselineSamples : 100,
      baselineConversions: m.baselineConversions,
      treatmentSamples: m.treatmentSamples > 0 ? m.treatmentSamples : 100,
      treatmentConversions: m.treatmentConversions
    });
  };

  const handleEvaluateWithCohort = async (expId: string) => {
    setComparingExpId(expId);
    setFeedbackBanner(null);
    try {
      const res = await api.compareExperiment(expId, cohortDraft);
      const ev = res?.data?.evaluation;
      setEditingMetricsExpId(null);
      setFeedbackBanner({
        type: 'success',
        text: ev ? `Statistical evaluation (${ev.outcome}): ${ev.decisionSummary}` : 'Experiment evaluated.'
      });
      await onRefresh?.();
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: err?.message || 'Failed to evaluate experiment cohort metrics.'
      });
    } finally {
      setComparingExpId(null);
    }
  };

  const toggleExpanded = (campaignId: string) => {
    setExpandedCampaignIds((prev) => ({ ...prev, [campaignId]: !prev[campaignId] }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Compass className="w-5 h-5 text-cyan-400" />
            Marketing Campaigns & Channel Flights
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Every campaign maps to a measurable business goal, strict INR budget caps, and statistical A/B variation testing.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => openAbModal()}
            disabled={campaigns.length === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:text-cyan-200 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FlaskConical className="w-4 h-4" />
            <span>A/B Test</span>
          </button>

          <button
            type="button"
            onClick={onTriggerCycle}
            disabled={isCycleRunning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Launch Next Campaign Flight</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackBanner && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-start justify-between gap-3 ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-start gap-2">
            {feedbackBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <span className="leading-relaxed">{feedbackBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-slate-400 hover:text-white shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Live Public Distribution Surfaces (/vs/, /best/, Telegram, Instagram) */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-white">Live Organic Distribution Channels</h3>
          <div className="text-xs font-mono text-slate-400">
            <span>Telegram: {telegramStatus?.configured ? 'CONFIGURED' : 'NOT_CONFIGURED'}</span>
            <span aria-hidden="true"> · </span>
            <span>Instagram: {igStatus?.status || 'UNKNOWN'}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
            <div className="font-semibold text-slate-200">Published /vs/ Comparisons ({comparisons.length})</div>
            {comparisons.length === 0 ? (
              <p className="text-slate-500">No /vs/ comparison pages generated yet.</p>
            ) : (
              <ul className="space-y-1">
                {comparisons.slice(0, 4).map((c: any, idx: number) => {
                  const cmpSlug = String(c?.comparisonSlug || c?.slug || '').trim();
                  return (
                    <li key={`${cmpSlug || c?.title || 'cmp'}_${idx}`} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-300">{c.title || cmpSlug || 'Comparison'}</span>
                      {cmpSlug ? (
                        <a href={`/vs/${encodeURIComponent(cmpSlug)}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline inline-flex items-center gap-1 shrink-0">
                          <span>Open</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
            <div className="font-semibold text-slate-200">Published /best/ Buyer Guides ({buyerGuides.length})</div>
            {buyerGuides.length === 0 ? (
              <p className="text-slate-500">No /best/ buyer guides published yet.</p>
            ) : (
              <ul className="space-y-1">
                {buyerGuides.slice(0, 4).map((g: any, idx: number) => {
                  const guideSlug = String(g?.intentSlug || g?.slug || '').trim();
                  return (
                    <li key={`${guideSlug || g?.title || 'guide'}_${idx}`} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-300">{g.title || g.h1 || guideSlug || 'Buyer Guide'}</span>
                      {guideSlug ? (
                        <a href={`/best/${encodeURIComponent(guideSlug)}`} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline inline-flex items-center gap-1 shrink-0">
                          <span>Open</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-slate-800/80">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter campaigns by title, audience, or channel..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          {([
            { id: 'ALL', label: `All (${campaigns.length})` },
            {
              id: 'ACTIVE',
              label: `Active (${campaigns.filter((c: any) => String(c.status || '').toUpperCase() === 'ACTIVE').length})`
            },
            {
              id: 'AB_TESTED',
              label: `With A/B Tests (${campaigns.filter((c: any) => (experimentsByCampaign[c.id] || []).length > 0).length})`
            }
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                statusFilter === tab.id
                  ? 'bg-slate-800 text-cyan-300 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty State */}
      {campaigns.length === 0 ? (
        <div className="p-10 rounded-xl bg-slate-900 border border-slate-800 text-center space-y-3">
          <Compass className="w-8 h-8 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-slate-200">No Campaign Flights Launched Yet</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Launch your first campaign flight to define target channels, INR budget caps, and start creating A/B test variations for automated performance comparison.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={onTriggerCycle}
              disabled={isCycleRunning}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>Launch Next Campaign Flight</span>
            </button>
          </div>
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-900 border border-slate-800 text-center space-y-2">
          <p className="text-sm font-semibold text-slate-300">No campaigns match the active filter</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('ALL');
            }}
            className="text-xs font-semibold text-cyan-400 hover:text-cyan-300"
          >
            Reset filters
          </button>
        </div>
      ) : (
        /* Campaigns List */
        <div className="space-y-4">
          {filteredCampaigns.map((camp: any, idx: number) => {
            const achievedLeads = Number(camp.achieved_qualified_leads ?? 0);
            const targetLeads = Number(camp.target_qualified_leads ?? 100);
            const progress = targetLeads > 0 ? Math.min(100, Math.round((achievedLeads / targetLeads) * 100)) : 0;
            const campExps = experimentsByCampaign[camp.id] || [];
            const isExpanded = expandedCampaignIds[camp.id] ?? campExps.length > 0;
            const winningExp = campExps.find((e) => e.outcome === 'SCALE');

            return (
              <div
                key={camp.id || `camp_${idx}`}
                className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden"
              >
                <div className="p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                  <div className="space-y-2.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-base font-bold text-white">{camp.title}</h3>
                      <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-emerald-400">
                        {camp.status}
                      </span>
                      {campExps.length > 0 && (
                        <span className="text-[11px] font-mono text-cyan-400 tabular-nums">
                          • {campExps.length} A/B {campExps.length === 1 ? 'Test' : 'Tests'}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">{camp.objective}</p>

                    {/* Target Audience & Geo */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400 pt-0.5">
                      <span>
                        Audience: <strong className="text-slate-200 font-semibold">{camp.target_audience}</strong>
                      </span>
                      <span>
                        Geography: <strong className="text-slate-200 font-semibold">{camp.geography?.city || 'India'}</strong>
                      </span>
                      <span>
                        Channels:{' '}
                        <strong className="text-slate-200 font-mono text-[11px]">
                          {(Array.isArray(camp.channels) && camp.channels.length > 0
                            ? camp.channels
                            : ['WHATSAPP', 'GOOGLE_BUSINESS_PROFILE']
                          ).join(' · ')}
                        </strong>
                      </span>
                    </div>

                    {/* Campaign A/B Actions */}
                    <div className="flex flex-wrap items-center gap-2.5 pt-2">
                      <button
                        type="button"
                        onClick={() => openAbModal(camp)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:text-white transition-colors whitespace-nowrap shrink-0"
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                        <span>A/B Test</span>
                      </button>

                      {campExps.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRunCampaignComparison(camp.id)}
                            disabled={comparingCampaignId === camp.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-800 hover:border-slate-600 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                          >
                            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                            <span>
                              {comparingCampaignId === camp.id
                                ? 'Comparing...'
                                : 'Run Automated Comparison'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleExpanded(camp.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap"
                          >
                            <span>{isExpanded ? 'Hide Comparison' : 'Show Comparison'}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Progress & Metrics */}
                  <div className="w-full lg:w-72 p-4 rounded-lg bg-slate-950/60 border border-slate-800 space-y-3 shrink-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Qualified Leads</span>
                      <span className="font-bold font-mono tabular-nums text-cyan-400">
                        {achievedLeads} / {targetLeads}
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${progress}%` }} />
                    </div>

                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-slate-500 block text-[10px]">Budget Allocated</span>
                        <strong className="text-slate-200 font-mono tabular-nums">
                          {formatINR(Number(camp.budget_inr) || 0)}
                        </strong>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-500 block text-[10px]">Spent to Date</span>
                        <strong className="text-slate-200 font-mono tabular-nums">
                          {formatINR(Number(camp.spent_inr) || 0)}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Automated A/B Performance Comparison Section */}
                {campExps.length > 0 && isExpanded && (
                  <div className="border-t border-slate-800 bg-slate-950/50 px-6 py-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="font-bold text-slate-200">
                          Automated A/B Variation Performance Comparison
                        </span>
                        {winningExp && (
                          <span className="text-emerald-400 font-semibold">
                            — Winner: {getSafeMetrics(winningExp).variantLabel}
                          </span>
                        )}
                      </div>

                      {onNavigateTab && (
                        <button
                          type="button"
                          onClick={() => onNavigateTab('experiments')}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300"
                        >
                          <span>Open Split-Test Lab</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div className="overflow-x-auto border border-slate-800 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-900/90 border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                            <th className="py-2.5 px-3 font-semibold">Variation vs Control</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Control CR</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Variant CR</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Uplift</th>
                            <th className="py-2.5 px-3 font-semibold text-right">p-value</th>
                            <th className="py-2.5 px-3 font-semibold">Decision</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Evaluate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80">
                          {campExps.map((exp: any, expIdx: number) => {
                            const m = getSafeMetrics(exp);
                            const outcome = exp.outcome || 'RUNNING';
                            const isEditing = editingMetricsExpId === exp.id;

                            return (
                              <React.Fragment key={exp.id || `exp_${expIdx}`}>
                                <tr className="hover:bg-slate-900/60 transition-colors">
                                  <td className="py-2.5 px-3 align-top max-w-xs">
                                    <div className="font-semibold text-slate-200">{m.variantLabel}</div>
                                    <div className="text-[11px] text-slate-400 truncate mt-0.5" title={exp.treatment}>
                                      {m.variationConfig?.callToAction || exp.treatment}
                                    </div>
                                    {m.variationConfig?.channels && (
                                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                                        {(m.variationConfig.channels || []).join(' · ')}
                                        {m.variationConfig.trafficSplitPercent
                                          ? ` (${m.variationConfig.trafficSplitPercent}% split)`
                                          : ''}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums align-top text-slate-300">
                                    <div>{m.baselineCR.toFixed(1)}%</div>
                                    <div className="text-[10px] text-slate-500">
                                      {m.baselineConversions}/{m.baselineSamples}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums align-top text-cyan-300">
                                    <div>{m.treatmentCR.toFixed(1)}%</div>
                                    <div className="text-[10px] text-slate-500">
                                      {m.treatmentConversions}/{m.treatmentSamples}
                                    </div>
                                  </td>
                                  <td
                                    className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold align-top ${
                                      m.upliftPercent > 0
                                        ? 'text-emerald-400'
                                        : m.upliftPercent < 0
                                        ? 'text-rose-400'
                                        : 'text-slate-400'
                                    }`}
                                  >
                                    {m.upliftPercent > 0 ? `+${m.upliftPercent.toFixed(1)}%` : `${m.upliftPercent.toFixed(1)}%`}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums align-top text-slate-300">
                                    {m.pVal.toFixed(3)}
                                  </td>
                                  <td className="py-2.5 px-3 align-top max-w-xs">
                                    <div className={`font-mono font-bold text-[11px] ${OUTCOME_TEXT_CLASS[outcome] || 'text-slate-300'}`}>
                                      {outcome}
                                    </div>
                                    {exp.decision_summary && (
                                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                        {exp.decision_summary}
                                      </p>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right align-top whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        isEditing ? setEditingMetricsExpId(null) : openCohortEditor(exp)
                                      }
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-700 bg-slate-900 text-[11px] font-semibold text-slate-200 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors"
                                    >
                                      <Play className="w-3 h-3" />
                                      <span>{isEditing ? 'Cancel' : 'Compare Data'}</span>
                                    </button>
                                  </td>
                                </tr>

                                {isEditing && (
                                  <tr className="bg-slate-900/90">
                                    <td colSpan={7} className="p-3 border-t border-slate-800">
                                      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
                                          <label className="block">
                                            <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                                              Control Samples
                                            </span>
                                            <input
                                              type="number"
                                              min={0}
                                              value={cohortDraft.baselineSamples}
                                              onChange={(e) =>
                                                setCohortDraft((d) => ({
                                                  ...d,
                                                  baselineSamples: Math.max(0, Number(e.target.value) || 0)
                                                }))
                                              }
                                              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-mono tabular-nums text-white"
                                            />
                                          </label>
                                          <label className="block">
                                            <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                                              Control Conversions
                                            </span>
                                            <input
                                              type="number"
                                              min={0}
                                              value={cohortDraft.baselineConversions}
                                              onChange={(e) =>
                                                setCohortDraft((d) => ({
                                                  ...d,
                                                  baselineConversions: Math.max(0, Number(e.target.value) || 0)
                                                }))
                                              }
                                              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-mono tabular-nums text-white"
                                            />
                                          </label>
                                          <label className="block">
                                            <span className="text-[10px] text-cyan-400 uppercase font-semibold block mb-1">
                                              Variation Samples
                                            </span>
                                            <input
                                              type="number"
                                              min={0}
                                              value={cohortDraft.treatmentSamples}
                                              onChange={(e) =>
                                                setCohortDraft((d) => ({
                                                  ...d,
                                                  treatmentSamples: Math.max(0, Number(e.target.value) || 0)
                                                }))
                                              }
                                              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-cyan-500/40 text-xs font-mono tabular-nums text-white"
                                            />
                                          </label>
                                          <label className="block">
                                            <span className="text-[10px] text-cyan-400 uppercase font-semibold block mb-1">
                                              Variation Conversions
                                            </span>
                                            <input
                                              type="number"
                                              min={0}
                                              value={cohortDraft.treatmentConversions}
                                              onChange={(e) =>
                                                setCohortDraft((d) => ({
                                                  ...d,
                                                  treatmentConversions: Math.max(0, Number(e.target.value) || 0)
                                                }))
                                              }
                                              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-cyan-500/40 text-xs font-mono tabular-nums text-white"
                                            />
                                          </label>
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => handleEvaluateWithCohort(exp.id)}
                                          disabled={comparingExpId === exp.id}
                                          className="px-3.5 py-2 rounded-lg text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                                        >
                                          {comparingExpId === exp.id
                                            ? 'Running Z-Test...'
                                            : 'Run Statistical Evaluation'}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Campaign A/B Test Modal */}
      {isAbModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ab-test-modal-title"
        >
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 shadow-2xl">
            <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FlaskConical className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 id="ab-test-modal-title" className="text-base font-bold text-white">
                    Create Campaign A/B Test Variations
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Define one or more campaign variations against the control baseline for automated z-test comparison.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAbModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitAbTest} className="p-6 space-y-5">
              {modalError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              {/* Source Campaign Selector & Hypothesis */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Source Campaign (Control)
                  </span>
                  <select
                    value={selectedCampaignId}
                    onChange={(e) => handleCampaignSelectionChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    {campaigns.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Experiment Title
                  </span>
                  <input
                    type="text"
                    value={testTitle}
                    onChange={(e) => setTestTitle(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Baseline Control CTA
                  </span>
                  <input
                    type="text"
                    value={baselineCallToAction}
                    onChange={(e) => setBaselineCallToAction(e.target.value)}
                    placeholder="Original call to action"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Success Metric
                    </span>
                    <select
                      value={successMetric}
                      onChange={(e) => setSuccessMetric(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="qualified_leads">Qualified Leads</option>
                      <option value="conversion_rate">Conversion Rate</option>
                      <option value="confirmed_bookings">Confirmed Bookings</option>
                      <option value="revenue_per_visitor">Revenue / Visitor</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Min Sample Size
                    </span>
                    <input
                      type="number"
                      min={10}
                      max={10000}
                      value={minimumEvidenceRequirement}
                      onChange={(e) => setMinimumEvidenceRequirement(Math.max(10, Number(e.target.value) || 30))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-cyan-500"
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="block md:col-span-2">
                  <span className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Test Hypothesis
                  </span>
                  <input
                    type="text"
                    value={hypothesis}
                    onChange={(e) => setHypothesis(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Expected Effect
                  </span>
                  <input
                    type="text"
                    value={expectedEffect}
                    onChange={(e) => setExpectedEffect(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </label>
              </div>

              {/* Variations Section */}
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                    Campaign Variations ({variations.length})
                  </span>
                  <button
                    type="button"
                    onClick={addVariation}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Variation</span>
                  </button>
                </div>

                {variations.map((v, idx) => (
                  <div
                    key={v.id}
                    className="p-4 rounded-lg bg-slate-950/70 border border-slate-800 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">
                        Variation {idx + 1}
                      </span>
                      {variations.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeVariation(v.id)}
                          className="inline-flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="block md:col-span-2">
                        <span className="text-[11px] text-slate-400 block mb-1">Variation Name</span>
                        <input
                          type="text"
                          value={v.name}
                          onChange={(e) => updateVariation(v.id, { name: e.target.value })}
                          required
                          className="w-full px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                        />
                      </label>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-[11px] text-slate-400 block mb-1">Traffic %</span>
                          <input
                            type="number"
                            min={5}
                            max={95}
                            value={v.trafficSplitPercent}
                            onChange={(e) =>
                              updateVariation(v.id, {
                                trafficSplitPercent: Math.max(5, Math.min(95, Number(e.target.value) || 50))
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs font-mono tabular-nums text-white"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[11px] text-slate-400 block mb-1">Budget (INR)</span>
                          <input
                            type="number"
                            min={0}
                            value={v.budgetINR}
                            onChange={(e) =>
                              updateVariation(v.id, { budgetINR: Math.max(0, Number(e.target.value) || 0) })
                            }
                            className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs font-mono tabular-nums text-white"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-[11px] text-slate-400 block mb-1">
                          Objective / Value Proposition Variation
                        </span>
                        <input
                          type="text"
                          value={v.objective}
                          onChange={(e) => updateVariation(v.id, { objective: e.target.value })}
                          className="w-full px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                        />
                      </label>

                      <label className="block">
                        <span className="text-[11px] text-slate-400 block mb-1">
                          Call-to-Action Variation
                        </span>
                        <input
                          type="text"
                          value={v.callToAction}
                          onChange={(e) => updateVariation(v.id, { callToAction: e.target.value })}
                          className="w-full px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="text-[11px] text-slate-400 block mb-1">Target Audience Segment</span>
                      <input
                        type="text"
                        value={v.targetAudience}
                        onChange={(e) => updateVariation(v.id, { targetAudience: e.target.value })}
                        className="w-full px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                      />
                    </label>

                    <div>
                      <span className="text-[11px] text-slate-400 block mb-1.5">Active Channels</span>
                      <div className="flex flex-wrap gap-1.5">
                        {AVAILABLE_CHANNELS.map((ch) => {
                          const selected = v.channels.includes(ch);
                          return (
                            <button
                              key={ch}
                              type="button"
                              onClick={() => toggleVariationChannel(v.id, ch)}
                              className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors ${
                                selected
                                  ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {ch}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAbModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-white border border-slate-700 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAb}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-50"
                >
                  <FlaskConical className="w-4 h-4" />
                  <span>{isSubmittingAb ? 'Creating Variations...' : 'Launch A/B Test Variations'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};