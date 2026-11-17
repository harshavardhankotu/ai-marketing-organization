import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Mail,
  Play,
  RefreshCw,
  AlertCircle,
  GitBranch,
  UploadCloud,
  Globe,
  Search,
  Share2,
  MessageSquare
} from 'lucide-react';
import { api } from '../../services/api.js';

interface DistributionKitDeal {
  dealId: string;
  title: string;
  merchant: string;
  category: string;
  priceINR: number;
  referencePriceINR: number;
  verifiedDiscountPercent: number;
  couponCode: string | null;
  dealDetailUrl: string;
  officialRedirectUrl: string;
  amazonUrl: string;
  comparisonUrl: string | null;
  buyerGuideUrl: string;
  targetSubreddit: string;
  youtubeReview: {
    title: string;
    videoId: string;
    videoUrl: string;
    channelTitle?: string;
  } | null;
  snippets: {
    youtubeCommentReply: string;
    redditReply: string;
    igTelegramCaption: string;
  };
}

interface DistributionKitData {
  siteUrl: string;
  topImpulseDeals: DistributionKitDeal[];
  searchEngineChecklist: {
    sitemapUrl: string;
    robotsUrl: string;
    indexNowKeyUrl: string;
    indexNowStatus: string;
    googleSearchConsoleInstructions: string;
    bingWebmasterInstructions: string;
  };
  generatedAt: string;
}

interface ReadyAuditItem {
  domain: string;
  businessName: string;
  targetUrl: string;
  defectCount: number;
  prospectTriggerScore?: number;
  triggerTags?: string[];
  performanceScore: number | null;
  seoScore: number | null;
  previewUrl: string;
  checkoutUrl: string;
  priceINR: number;
  matchedDraftId: string | null;
  matchedContactEmail: string | null;
  matchedContactPhone: string | null;
  mailtoUrl?: string | null;
  whatsappShareUrl?: string | null;
  updatedAt: string;
}

interface InstagramStatusSummary {
  configured: boolean;
  status: 'READY_LIVE_TOKEN' | 'READY_OAUTH_CONNECT_URL' | 'NOT_CONFIGURED';
  handle: string;
  igUserIdPresent: boolean;
  appConfigured: boolean;
  hasLiveToken: boolean;
  authorizeEndpoint: string;
  tokenAgeDays: number | null;
  lastPublishedMediaId: string | null;
  lastPublishedAt: string | null;
  lastPollAt: string | null;
  repliesSentCount: number;
  missingEnv: string[];
}

interface PendingDraftItem {
  id: string;
  businessId: string | null;
  segment: string | null;
  prospectName: string;
  channel: string;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  messageDraft: string;
  responseStatus: string | null;
  humanApproved: boolean;
  dispatched: boolean;
  mailtoUrl?: string | null;
  whatsappShareUrl?: string | null;
  createdAt: string;
}

interface TopDealItem {
  id: string;
  title: string;
  merchant: string;
  category: string;
  affiliateNetwork: string;
  currentPriceINR: number;
  referencePriceINR: number | null;
  verifiedDiscountPercent: number;
  expectedProfitPer100VisitorsINR: number;
  verifiedCommissionRatePercent: number | null;
  grossCommissionPerApprovedOrderINR: number | null;
  evolutionStatus: string;
  trackedShareUrl: string;
  shareText: string;
}

interface ApiUtilizationItem {
  id: string;
  name: string;
  configured: boolean;
  used: number;
  cap: number | null;
  window: string;
  channelId?: string;
}

interface FunnelLeakDiagnosis {
  funnelMatrix: {
    catalogActiveDeals: number;
    comparisonPages: number;
    viewsAndSignals: number;
    redirectClicks: number;
    customerDeskInquiries: number;
    checkoutOrders: number;
    verifiedCashINR: number;
  };
  bottleneckStage: string;
  recommendedAction: string;
  autoAppliedFix: string;
  diagnosisSource: string;
  evaluatedAt: string;
}

interface ReadyActionsPayload {
  generatedAt: string;
  storageTarget: string;
  remoteD1Configured: boolean;
  withVerifiedCommissionRateCount: number;
  instagramIntegration?: InstagramStatusSummary | null;
  readyAudits: ReadyAuditItem[];
  pendingDrafts: PendingDraftItem[];
  topDeals: TopDealItem[];
  apiUtilization: ApiUtilizationItem[];
  systemDoctor?: {
    lastReport: any | null;
    funnelDiagnosis: FunnelLeakDiagnosis;
  };
}

interface LiveHarvestResult {
  executedAt: string;
  durationMs: number;
  storageTarget: string;
  remoteD1Synced: boolean;
  apiCallsMade: number;
  cuelinks: {
    configured: boolean;
    syncSuccess: boolean;
    reason: string | null;
    campaignsDiscovered: number;
    offersRetrieved: number;
    liveOffersFetched: number;
    liveOffersIngested: number;
    payoutsHydrated: {
      inspected: number;
      updatedCampaigns: number;
      syncedPublicDeals: number;
    };
  };
  marketResearch: {
    workflowStatus: string;
    tavilyDiscovery?: {
      executed: boolean;
      query?: string;
      resultsCount?: number;
      suggestionsCount?: number;
    };
  };
  reconciliation: {
    processed: number;
    reconciled: number;
    failed: number;
  };
  amazonDiscovery?: {
    discovered: number;
    skippedReason?: string | null;
  };
  geminiAnalysis?: {
    executed: boolean;
    priorityCategories?: string[];
  };
  withVerifiedCommissionRateCount: number;
}

interface DeployManifestPayload {
  repo: string;
  branch: string;
  tokenConfigured: boolean;
  totalScanned: number;
  changedCount: number;
  modifiedFiles: Array<{ path: string; size: number }>;
  addedFiles: Array<{ path: string; size: number }>;
}

export const FirstSaleCommandCenter: React.FC = () => {
  const [data, setData] = useState<ReadyActionsPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [harvesting, setHarvesting] = useState<boolean>(false);
  const [harvestResult, setHarvestResult] = useState<LiveHarvestResult | null>(null);
  const [harvestError, setHarvestError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [sendingDraftId, setSendingDraftId] = useState<string | null>(null);
  const [draftStatusMap, setDraftStatusMap] = useState<Record<string, { ok: boolean; text: string }>>({});

  // 1-Click GitHub PR Sync Bridge state (token stays strictly transient in memory)
  const [manifestLoading, setManifestLoading] = useState<boolean>(false);
  const [manifest, setManifest] = useState<DeployManifestPayload | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [githubTokenInput, setGithubTokenInput] = useState<string>('');
  const [targetBranch, setTargetBranch] = useState<string>('feat/stage-k-safe-profit-engine');
  const [commitMessage, setCommitMessage] = useState<string>('feat: Stage K Safe Profit Engine, Dual-Rail & /vs/ Comparisons');
  const [pushingDeploy, setPushingDeploy] = useState<boolean>(false);
  const [deploySuccess, setDeploySuccess] = useState<{
    branch?: string;
    baseBranch?: string;
    commitSha: string;
    commitUrl: string;
    prUrl?: string | null;
    prNumber?: number | null;
    filesPushedCount: number;
    noChanges?: boolean;
  } | null>(null);
  const [healingDoctor, setHealingDoctor] = useState<boolean>(false);
  const [doctorReport, setDoctorReport] = useState<any | null>(null);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [igPublishing, setIgPublishing] = useState<boolean>(false);
  const [igPolling, setIgPolling] = useState<boolean>(false);
  const [igMessage, setIgMessage] = useState<string | null>(null);
  const [igError, setIgError] = useState<string | null>(null);
  const [distKit, setDistKit] = useState<DistributionKitData | null>(null);
  const [distKitLoading, setDistKitLoading] = useState<boolean>(false);
  const [distKitError, setDistKitError] = useState<string | null>(null);

  const loadDistributionKit = useCallback(async () => {
    setDistKitLoading(true);
    setDistKitError(null);
    try {
      const res = await api.getIntentDistributionKit();
      if (res?.success) {
        setDistKit(res);
      }
    } catch (err: any) {
      setDistKitError(err?.data?.message || err?.message || 'Failed to load distribution kit.');
    } finally {
      setDistKitLoading(false);
    }
  }, []);

  const loadReadyActions = useCallback(async () => {
    setError(null);
    try {
      const res = await api.getFirstSaleReadyActions();
      if (res?.data) {
        setData(res.data);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not load ready first-sale actions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReadyActions();
    loadDistributionKit();
  }, [loadReadyActions, loadDistributionKit]);

  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      if (
        !origin.endsWith('.run.app') &&
        !origin.endsWith('.onrender.com') &&
        !origin.includes('localhost') &&
        !origin.includes('127.0.0.1')
      ) {
        return;
      }
      if (event.data?.type === 'INSTAGRAM_OAUTH_SUCCESS') {
        setIgError(null);
        setIgMessage(
          `Connected ${event.data.handle || '@bestdeals0162'} via Meta OAuth (60-day token stored).`
        );
        loadReadyActions();
      } else if (event.data?.type === 'INSTAGRAM_OAUTH_ERROR') {
        setIgError(
          event.data.errorDescription || event.data.error || 'Instagram OAuth authorization failed.'
        );
      }
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [loadReadyActions]);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      setCopiedKey(null);
    }
  };

  const handleTriggerLiveHarvest = async () => {
    setHarvesting(true);
    setHarvestError(null);
    try {
      const res = await api.triggerFirstSaleLiveHarvest();
      if (res?.data) {
        setHarvestResult(res.data);
        if (res.data.systemDoctor) {
          setDoctorReport(res.data.systemDoctor);
        }
      }
      await loadReadyActions();
    } catch (err: any) {
      setHarvestError(err?.message || 'Live harvest failed.');
    } finally {
      setHarvesting(false);
    }
  };

  const handleRunSystemDoctorHeal = async () => {
    setHealingDoctor(true);
    setDoctorError(null);
    try {
      const res = await api.runSystemDoctorHeal();
      if (res?.data) {
        setDoctorReport(res.data);
      }
      await loadReadyActions();
    } catch (err: any) {
      setDoctorError(err?.message || 'Self-healing run failed.');
    } finally {
      setHealingDoctor(false);
    }
  };

  const handlePublishTopDealToIg = async (dealId?: string) => {
    setIgPublishing(true);
    setIgError(null);
    setIgMessage(null);
    try {
      const res = await api.publishDealToInstagram(dealId ? { dealId } : {});
      if (res?.data?.ok) {
        setIgMessage(`Published to ${res.data.handle || '@bestdeals0162'} (Media ID: ${res.data.mediaId})`);
        await loadReadyActions();
      } else {
        setIgError(res?.data?.reason || 'Instagram publish could not complete.');
      }
    } catch (err: any) {
      setIgError(err?.data?.reason || err?.data?.message || err?.message || 'Instagram publish failed.');
    } finally {
      setIgPublishing(false);
    }
  };

  const handleConnectInstagramOAuth = async () => {
    setIgError(null);
    setIgMessage(null);
    try {
      const redirectUri = `${window.location.origin}/api/v1/integrations/instagram/oauth/callback`;
      const res = await api.getInstagramOAuthUrl(redirectUri);
      const authUrl = res?.data?.url || res?.data?.authorizeUrl;
      if (!authUrl) {
        setIgError('Instagram OAuth URL is unavailable. Verify INSTAGRAM_APP_ID.');
        return;
      }
      const authWindow = window.open(
        authUrl,
        'instagram_oauth_popup',
        'width=600,height=700'
      );
      if (!authWindow) {
        setIgError('Popup blocked by browser. Please allow popups for this site to connect Instagram.');
      }
    } catch (err: any) {
      setIgError(err?.data?.message || err?.message || 'Failed to initiate Instagram OAuth.');
    }
  };

  const handlePollIgEngagement = async () => {
    setIgPolling(true);
    setIgError(null);
    setIgMessage(null);
    try {
      const res = await api.pollInstagramEngagement();
      const d = res?.data;
      if (d) {
        setIgMessage(`Synced IG engagement: checked ${d.commentsChecked ?? 0} comments, ${d.dmsChecked ?? 0} DMs, sent ${d.repliesSent ?? 0} Dual-Rail replies.`);
        await loadReadyActions();
      }
    } catch (err: any) {
      setIgError(err?.data?.message || err?.message || 'Instagram poll failed.');
    } finally {
      setIgPolling(false);
    }
  };

  const buildInstagramCaption = (deal: TopDealItem) => {
    const price = Math.round(Number(deal.currentPriceINR || 0));
    const mrp = Math.round(Number(deal.referencePriceINR || 0));
    const mrpPart = mrp > price ? ` (${deal.verifiedDiscountPercent || Math.round(((mrp - price) / mrp) * 100)}% off MRP ₹${mrp.toLocaleString('en-IN')})` : '';
    return `#Ad Verified Fair-Price Drop: ${deal.title}\nLive Price: ₹${price.toLocaleString('en-IN')}${mrpPart} on ${deal.merchant}\n\nComment "DEAL" below or DM "DEAL" for instant Store + Amazon.in check links.\nBio Hub: ${window.location.origin}/ig`;
  };

  const handleApproveAndSend = async (draftId: string) => {
    setSendingDraftId(draftId);
    try {
      const res = await api.approveAndSendFirstSaleDraft(draftId);
      if (res?.dispatched) {
        setDraftStatusMap((prev) => ({
          ...prev,
          [draftId]: {
            ok: true,
            text: `Sent via Brevo to ${res.recipientEmail}${res.dailySendsRemaining !== null && res.dailySendsRemaining !== undefined ? ` (${res.dailySendsRemaining} daily sends left)` : ''}`
          }
        }));
        await loadReadyActions();
      } else {
        setDraftStatusMap((prev) => ({
          ...prev,
          [draftId]: {
            ok: false,
            text: res?.reason || 'Approved, dispatch deferred.'
          }
        }));
      }
    } catch (err: any) {
      setDraftStatusMap((prev) => ({
        ...prev,
        [draftId]: {
          ok: false,
          text: err?.data?.reason || err?.data?.message || err?.message || 'Send failed.'
        }
      }));
    } finally {
      setSendingDraftId(null);
    }
  };

  const handleLoadManifest = async () => {
    setManifestLoading(true);
    setDeployError(null);
    try {
      const res = await api.getDeployManifest('main', githubTokenInput.trim() || undefined);
      if (res?.data) {
        setManifest(res.data);
      }
    } catch (err: any) {
      setDeployError(err?.data?.message || err?.message || 'Could not inspect GitHub main tree.');
    } finally {
      setManifestLoading(false);
    }
  };

  const handlePushToGithub = async () => {
    const cleanBranch = targetBranch.trim() || 'feat/stage-k-safe-profit-engine';
    if (cleanBranch === 'main' || cleanBranch === 'master') {
      setDeployError('Direct push to main/master is blocked. Use a PR feature branch.');
      return;
    }
    setPushingDeploy(true);
    setDeployError(null);
    setDeploySuccess(null);
    try {
      const res = await api.pushDeployToGithub({
        branch: cleanBranch,
        baseBranch: 'main',
        commitMessage: commitMessage.trim() || 'feat: Stage K Safe Profit Engine update',
        ...(githubTokenInput.trim() ? { githubToken: githubTokenInput.trim() } : {})
      });
      setGithubTokenInput('');
      if (res?.data) {
        setDeploySuccess(res.data);
        await handleLoadManifest();
      }
    } catch (err: any) {
      setDeployError(err?.data?.message || err?.message || 'Push to PR feature branch failed.');
    } finally {
      setPushingDeploy(false);
    }
  };

  return (
    <section
      aria-labelledby="first-sale-console-heading"
      className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-6"
    >
      {/* Header & Primary Action */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="space-y-1">
          <h3 id="first-sale-console-heading" className="text-base font-bold text-white tracking-tight">
            First-Sale Execution Console
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Cuelinks Channel 331585 &amp; Amazon.in Associates</span>
            <span aria-hidden="true">·</span>
            <span>₹499 SiteFix Audits &amp; Brevo Outreach</span>
            {data && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-300">{data.storageTarget}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-emerald-400">
                  {data.withVerifiedCommissionRateCount} deals with verified payout rate
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={loadReadyActions}
            disabled={loading || harvesting}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleTriggerLiveHarvest}
            disabled={harvesting}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{harvesting ? 'Running Live Harvest...' : 'Trigger 1 Live Harvest Cycle'}</span>
          </button>
        </div>
      </div>

      {/* Error / Harvest Feedback */}
      {error && (
        <div className="py-3 px-4 rounded-lg bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {harvestError && (
        <div className="py-3 px-4 rounded-lg bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{harvestError}</span>
        </div>
      )}

      {harvestResult && (
        <div className="py-3 px-4 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs text-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold text-emerald-300">Live harvest completed</span>
            <span className="text-slate-400 mx-2">·</span>
            <span className="font-mono tabular-nums">
              Cuelinks: {harvestResult.cuelinks.campaignsDiscovered} campaigns, {harvestResult.cuelinks.liveOffersIngested}/{harvestResult.cuelinks.liveOffersFetched} offers, {harvestResult.cuelinks.payoutsHydrated.updatedCampaigns} payouts
            </span>
            <span className="text-slate-400 mx-2">·</span>
            <span className="font-mono tabular-nums">
              Amazon.in: {harvestResult.amazonDiscovery?.discovered ?? 0}
            </span>
            <span className="text-slate-400 mx-2">·</span>
            <span className="font-mono tabular-nums">
              Reconciled: {harvestResult.reconciliation.reconciled}/{harvestResult.reconciliation.processed}
            </span>
            <span className="text-slate-400 mx-2">·</span>
            <span className="font-mono tabular-nums">
              Tavily: {harvestResult.marketResearch?.tavilyDiscovery?.resultsCount ?? 0} · Gemini: {harvestResult.geminiAnalysis?.executed ? '1' : '0'}
            </span>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-slate-400">
            {harvestResult.durationMs} ms · {harvestResult.storageTarget}
          </span>
        </div>
      )}

      {/* 1. Live API Utilization Meter (7 Providers) */}
      {data?.apiUtilization && (
        <div className="space-y-2.5 border-b border-slate-800 pb-5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200">Live API Utilization</span>
            <span className="text-slate-400 font-mono tabular-nums">
              {data.apiUtilization.filter((a) => a.configured).length}/{data.apiUtilization.length} providers configured
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 border-t border-slate-800 pt-3">
            {data.apiUtilization.map((item) => (
              <div key={item.id} className="py-2 sm:py-0 sm:px-3 first:sm:pl-0 last:sm:pr-0 space-y-1">
                <div className="text-xs font-medium text-slate-200 truncate">{item.name}</div>
                <div className="text-sm font-bold font-mono tabular-nums text-white">
                  {item.cap !== null ? `${item.used} / ${item.cap}` : `${item.used}`}
                </div>
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <span className={item.configured ? 'text-emerald-400' : 'text-amber-400'}>
                    {item.configured ? 'Ready' : 'Key Missing'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{item.window}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. Top 5 Highest-EV Deals for 1-Click Share */}
      <div className="space-y-3 border-b border-slate-800 pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-white">Top Deals Ranked by EV / 100 Visitors</h4>
            <p className="text-xs text-slate-400">
              Tracked links resolve through /api/v1/public/deals/:id/redirect with #Ad disclosure and subid attribution
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-400">
            Showing {data?.topDeals?.length ?? 0} top deals
          </span>
        </div>

        {loading && !data ? (
          <div className="py-4 text-xs text-slate-400">Loading ranked deals...</div>
        ) : (data?.topDeals?.length || 0) === 0 ? (
          <div className="py-4 text-xs text-slate-400">
            No active monetizable deals ranked yet. Run Trigger 1 Live Harvest Cycle above to ingest live Cuelinks and Amazon.in offers.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-medium">
                  <th className="py-2 pr-4 font-medium">Deal &amp; Merchant</th>
                  <th className="py-2 px-3 text-right font-medium">Price</th>
                  <th className="py-2 px-3 text-right font-medium">Rate</th>
                  <th className="py-2 px-3 text-right font-medium">EV / 100 Visits</th>
                  <th className="py-2 pl-3 text-right font-medium">Share Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {data?.topDeals.map((deal) => {
                  const shareCopied = copiedKey === `share_${deal.id}`;
                  const linkCopied = copiedKey === `link_${deal.id}`;
                  return (
                    <tr key={deal.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 pr-4 max-w-md">
                        <div className="font-semibold text-slate-100 truncate" title={deal.title}>
                          {deal.title}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          <span>{deal.merchant}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="font-mono">{deal.affiliateNetwork}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{deal.category}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-white whitespace-nowrap">
                        <div>₹{Number(deal.currentPriceINR || 0).toLocaleString('en-IN')}</div>
                        {deal.verifiedDiscountPercent > 0 && (
                          <div className="text-[11px] text-emerald-400">-{deal.verifiedDiscountPercent}%</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                        {deal.verifiedCommissionRatePercent !== null
                          ? `${Number(deal.verifiedCommissionRatePercent).toFixed(1)}%`
                          : deal.grossCommissionPerApprovedOrderINR !== null
                            ? `₹${Number(deal.grossCommissionPerApprovedOrderINR).toLocaleString('en-IN')}`
                            : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-400 whitespace-nowrap">
                        ₹{Number(deal.expectedProfitPer100VisitorsINR || 0).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopy(`ig_${deal.id}`, buildInstagramCaption(deal))}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-[11px] font-semibold inline-flex items-center gap-1"
                            title="Copy Instagram Caption + Comment-to-DM Hook"
                          >
                            {copiedKey === `ig_${deal.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedKey === `ig_${deal.id}` ? 'Copied IG' : 'IG Caption'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopy(`share_${deal.id}`, deal.shareText)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-[11px] font-semibold inline-flex items-center gap-1"
                          >
                            {shareCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            <span>{shareCopied ? 'Copied Post' : 'Copy Post'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopy(`link_${deal.id}`, deal.trackedShareUrl)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-medium inline-flex items-center gap-1"
                          >
                            {linkCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            <span>{linkCopied ? 'Copied' : 'URL'}</span>
                          </button>
                          <a
                            href={deal.trackedShareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded text-cyan-400 hover:text-cyan-300"
                            title="Open tracked affiliate redirect"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2b. @bestdeals0162 Instagram Business Distribution & Comment-to-DM Engine */}
      {(() => {
        const ig = data?.instagramIntegration;
        const igStatusLabel = ig?.status === 'READY_LIVE_TOKEN'
          ? 'Live Token Active'
          : ig?.status === 'READY_OAUTH_CONNECT_URL'
            ? 'OAuth App Ready — Connect Account'
            : 'Awaiting Meta App Credentials';
        return (
          <div className="border-b border-slate-800 pb-5 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-white">
                  Instagram Business Distribution ({ig?.handle || '@bestdeals0162'})
                </h4>
                <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-2 font-mono tabular-nums">
                  <span className={ig?.hasLiveToken ? 'text-emerald-400' : ig?.appConfigured ? 'text-cyan-300' : 'text-amber-300'}>
                    {igStatusLabel}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Auto-DMs sent: {ig?.repliesSentCount ?? 0}</span>
                  {ig?.tokenAgeDays !== null && ig?.tokenAgeDays !== undefined && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Token age: {ig.tokenAgeDays}d / 60d</span>
                    </>
                  )}
                  {ig?.lastPublishedMediaId && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Last Media: {ig.lastPublishedMediaId}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {ig && !ig.hasLiveToken && ig.appConfigured && (
                  <button
                    type="button"
                    onClick={handleConnectInstagramOAuth}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <span>Connect {ig.handle} via Meta OAuth</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handlePublishTopDealToIg()}
                  disabled={igPublishing || (data?.topDeals?.length || 0) === 0}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Play className="w-3 h-3" />
                  <span>{igPublishing ? 'Publishing...' : `Publish Top Deal to ${ig?.handle || '@bestdeals0162'}`}</span>
                </button>
                <button
                  type="button"
                  onClick={handlePollIgEngagement}
                  disabled={igPolling}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${igPolling ? 'animate-spin' : ''}`} />
                  <span>{igPolling ? 'Syncing...' : 'Sync Comments & DMs'}</span>
                </button>
                <a
                  href="/ig"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-medium inline-flex items-center gap-1"
                >
                  <span>/ig Bio Storefront</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {igError && (
              <div className="py-2 px-3 rounded-lg bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200">
                {igError}
              </div>
            )}
            {igMessage && (
              <div className="py-2 px-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs text-emerald-200">
                {igMessage}
              </div>
            )}
          </div>
        );
      })()}

      {/* 2c. Zero-Cost Buyer-Intent Distribution Kit */}
      <div className="rounded-xl border border-slate-700/80 bg-slate-900/60 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">
                Zero-Cost Buyer-Intent Distribution Kit
              </h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950/40 text-cyan-300 border border-cyan-800 font-semibold">
                Organic Traffic Accelerator
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Copy-paste value-first buyer-help snippets with mandatory #Ad disclosures and verified real prices (₹299–₹1,499).
            </p>
          </div>
          <button
            type="button"
            onClick={loadDistributionKit}
            disabled={distKitLoading}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3 h-3 ${distKitLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Kit</span>
          </button>
        </div>

        {distKitError && (
          <div className="py-2 px-3 rounded-lg bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200">
            {distKitError}
          </div>
        )}

        {/* Top 5 Live Verified Impulse Deals Snippets */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Top Verified Impulse Deals (₹299–₹1,499) &amp; Grounded Snippets
            </h4>
            <span className="text-xs font-mono text-slate-400">
              {distKit?.topImpulseDeals?.length ?? 0} active
            </span>
          </div>

          {(!distKit?.topImpulseDeals || distKit.topImpulseDeals.length === 0) ? (
            <p className="text-xs text-slate-400 py-2">
              {distKitLoading ? 'Loading verified impulse deals...' : 'No impulse deals available yet. Run a live harvest cycle to sync catalog.'}
            </p>
          ) : (
            <div className="space-y-3">
              {distKit.topImpulseDeals.map((deal) => (
                <div key={deal.dealId} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white truncate max-w-md">{deal.title}</span>
                        <span className="text-[11px] font-semibold text-emerald-400">₹{deal.priceINR}</span>
                        {deal.referencePriceINR > deal.priceINR && (
                          <span className="text-[10px] text-slate-500 line-through">MRP ₹{deal.referencePriceINR}</span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800">
                          {deal.verifiedDiscountPercent}% OFF
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        <span>{deal.merchant}</span> &bull; <span>{deal.category}</span> &bull; Target: <span className="font-mono text-cyan-300">{deal.targetSubreddit}</span>
                      </div>
                    </div>
                    {deal.youtubeReview && (
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                        <span className="text-red-400 font-bold">▶</span>
                        <span className="truncate max-w-[200px]" title={deal.youtubeReview.title}>
                          {deal.youtubeReview.title}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 3 Copy Action Buttons */}
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-800/60">
                    <button
                      type="button"
                      onClick={() => handleCopy(`yt_${deal.dealId}`, deal.snippets.youtubeCommentReply)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
                    >
                      {copiedKey === `yt_${deal.dealId}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-red-400" />}
                      <span>Copy YouTube Reply</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(`rd_${deal.dealId}`, deal.snippets.redditReply)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
                    >
                      {copiedKey === `rd_${deal.dealId}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-orange-400" />}
                      <span>Copy Reddit Reply ({deal.targetSubreddit})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(`ig_${deal.dealId}`, deal.snippets.igTelegramCaption)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
                    >
                      {copiedKey === `ig_${deal.dealId}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-pink-400" />}
                      <span>Copy IG/Telegram Caption</span>
                    </button>
                    <a
                      href={deal.dealDetailUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-1 text-[11px] font-semibold rounded bg-slate-800/40 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1 ml-auto"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>View Deal</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Search Engine Free Indexing Checklist */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Free Search Engine Indexing Checklist
              </h4>
            </div>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold font-mono ${
              distKit?.searchEngineChecklist?.indexNowStatus === 'ACTIVE'
                ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800'
                : 'bg-amber-950/50 text-amber-400 border border-amber-800'
            }`}>
              IndexNow: {distKit?.searchEngineChecklist?.indexNowStatus || 'AWAITING_INDEXNOW_KEY'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-400 pt-1">
            <div className="rounded bg-slate-900/60 p-2 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Sitemap URL:</span>
                <button
                  type="button"
                  onClick={() => handleCopy('sitemap', distKit?.searchEngineChecklist?.sitemapUrl || 'https://ai-marketing-organization.onrender.com/sitemap.xml')}
                  className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                >
                  {copiedKey === 'sitemap' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>Copy</span>
                </button>
              </div>
              <div className="font-mono text-[11px] text-slate-300 truncate">
                {distKit?.searchEngineChecklist?.sitemapUrl || 'https://ai-marketing-organization.onrender.com/sitemap.xml'}
              </div>
              <p className="text-[11px] text-slate-500 pt-1">
                {distKit?.searchEngineChecklist?.googleSearchConsoleInstructions || 'Submit sitemap in Google Search Console -> Sitemaps.'}
              </p>
            </div>

            <div className="rounded bg-slate-900/60 p-2 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">IndexNow Live Key:</span>
                <span className="text-[10px] text-emerald-400 font-mono">Auto-pings Bing &amp; Yandex</span>
              </div>
              <div className="font-mono text-[11px] text-slate-300 truncate">
                {distKit?.searchEngineChecklist?.indexNowKeyUrl || 'https://ai-marketing-organization.onrender.com/indexnow-key-38f9d0c2.txt'}
              </div>
              <p className="text-[11px] text-slate-500 pt-1">
                {distKit?.searchEngineChecklist?.bingWebmasterInstructions || 'Submit sitemap in Bing Webmaster Tools -> Sitemaps. IndexNow automatically pings on deal discovery.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Ready ₹499 SiteFix Audits & Pending Brevo Outreach */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ready-to-Send ₹499 SiteFix Audits */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white">Ready ₹499 SiteFix Audits</h4>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {data?.readyAudits?.length ?? 0} completed
            </span>
          </div>

          {(data?.readyAudits?.length || 0) === 0 ? (
            <p className="text-xs text-slate-400 py-2">
              No completed site audits found yet. Run a technical audit from Site Audit to generate a ₹499 preview &amp; checkout link.
            </p>
          ) : (
            <div className="divide-y divide-slate-800 border-t border-slate-800">
              {data?.readyAudits.slice(0, 5).map((audit) => {
                const previewCopied = copiedKey === `preview_${audit.domain}`;
                const checkoutCopied = copiedKey === `checkout_${audit.domain}`;
                return (
                  <div key={audit.domain} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-100 truncate">
                        {audit.businessName} ({audit.domain})
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 font-mono tabular-nums">
                        <span className="text-emerald-400 font-semibold">Trigger Score {audit.prospectTriggerScore ?? 0}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{audit.defectCount} issues found</span>
                        {audit.performanceScore !== null && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>Perf {audit.performanceScore}</span>
                          </>
                        )}
                        {audit.seoScore !== null && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>SEO {audit.seoScore}</span>
                          </>
                        )}
                        {audit.matchedContactEmail && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="text-cyan-400">{audit.matchedContactEmail}</span>
                          </>
                        )}
                      </div>
                      {Array.isArray(audit.triggerTags) && audit.triggerTags.length > 0 && (
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate">
                          Signals: {audit.triggerTags.join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(`preview_${audit.domain}`, audit.previewUrl)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium inline-flex items-center gap-1"
                      >
                        {previewCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{previewCopied ? 'Copied' : 'Preview'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy(`checkout_${audit.domain}`, audit.checkoutUrl)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-[11px] font-medium inline-flex items-center gap-1"
                      >
                        {checkoutCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{checkoutCopied ? 'Copied' : '₹499 Link'}</span>
                      </button>
                      {audit.mailtoUrl && (
                        <a
                          href={audit.mailtoUrl}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-medium"
                        >
                          Email
                        </a>
                      )}
                      {audit.whatsappShareUrl && (
                        <a
                          href={audit.whatsappShareUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-[11px] font-medium"
                        >
                          WhatsApp
                        </a>
                      )}
                      <a
                        href={audit.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-cyan-400 hover:text-cyan-300"
                        title="Open HMAC-signed audit preview"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pending Outreach Drafts (human_approved = 0) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white">Pending Outreach Drafts</h4>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {data?.pendingDrafts?.length ?? 0} awaiting owner approval
            </span>
          </div>

          {(data?.pendingDrafts?.length || 0) === 0 ? (
            <p className="text-xs text-slate-400 py-2">
              No pending drafts with human_approved = 0. Zero unsolicited outreach can send without explicit click approval here.
            </p>
          ) : (
            <div className="divide-y divide-slate-800 border-t border-slate-800">
              {data?.pendingDrafts.slice(0, 5).map((draft) => {
                const draftFeedback = draftStatusMap[draft.id];
                const isSending = sendingDraftId === draft.id;
                const hasEmail = Boolean(draft.email && draft.email.includes('@'));

                return (
                  <div key={draft.id} className="py-3 space-y-1.5 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100 truncate">{draft.prospectName}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          <span>{draft.channel}</span>
                          <span aria-hidden="true"> · </span>
                          <span className={hasEmail ? 'text-cyan-300' : 'text-amber-400'}>
                            {hasEmail ? draft.email : 'No verified email on record'}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {draft.mailtoUrl && (
                          <a
                            href={draft.mailtoUrl}
                            className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-medium"
                          >
                            Mailto
                          </a>
                        )}
                        {draft.whatsappShareUrl && (
                          <a
                            href={draft.whatsappShareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-[11px] font-medium"
                          >
                            wa.me
                          </a>
                        )}
                        <button
                          type="button"
                          disabled={!hasEmail || isSending}
                          onClick={() => handleApproveAndSend(draft.id)}
                          className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors"
                        >
                          <Mail className="w-3 h-3" />
                          <span>{isSending ? 'Sending...' : 'Approve & Send via Brevo'}</span>
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{draft.messageDraft}</p>
                    {draftFeedback && (
                      <div className={`text-[11px] ${draftFeedback.ok ? 'text-emerald-400' : 'text-amber-300'}`}>
                        {draftFeedback.text}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 3b. System Doctor & Funnel Leak Debugger */}
      {(() => {
        const activeReport = doctorReport || data?.systemDoctor?.lastReport;
        const diagnosis: FunnelLeakDiagnosis | undefined = activeReport?.funnelDiagnosis || data?.systemDoctor?.funnelDiagnosis;
        const m = diagnosis?.funnelMatrix;
        return (
          <div className="border-t border-slate-800 pt-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-white">System Doctor &amp; Funnel Leak Debugger</h4>
                <p className="text-xs text-slate-400">
                  Auto-repairs swapped Deal/MRP prices, reroutes unconfigured outreach channels to Brevo Email, disqualifies non-SMB portals, and diagnoses revenue funnel drop-offs.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRunSystemDoctorHeal}
                disabled={healingDoctor}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${healingDoctor ? 'animate-spin' : ''}`} />
                <span>{healingDoctor ? 'Healing & Diagnosing...' : 'Run Self-Heal & Repair Now'}</span>
              </button>
            </div>

            {doctorError && (
              <div className="py-2 px-3 rounded-lg bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200">
                {doctorError}
              </div>
            )}

            {m && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs">
                <div className="py-1.5 sm:py-0 sm:px-3 first:sm:pl-0">
                  <div className="text-slate-400 text-[11px]">Active Deals</div>
                  <div className="font-mono tabular-nums font-bold text-white text-sm">{m.catalogActiveDeals}</div>
                </div>
                <div className="py-1.5 sm:py-0 sm:px-3">
                  <div className="text-slate-400 text-[11px]">/vs/ Pairs</div>
                  <div className="font-mono tabular-nums font-bold text-cyan-300 text-sm">{m.comparisonPages}</div>
                </div>
                <div className="py-1.5 sm:py-0 sm:px-3">
                  <div className="text-slate-400 text-[11px]">Views &amp; Signals</div>
                  <div className="font-mono tabular-nums font-bold text-white text-sm">{m.viewsAndSignals}</div>
                </div>
                <div className="py-1.5 sm:py-0 sm:px-3">
                  <div className="text-slate-400 text-[11px]">Redirect Clicks</div>
                  <div className="font-mono tabular-nums font-bold text-white text-sm">{m.redirectClicks}</div>
                </div>
                <div className="py-1.5 sm:py-0 sm:px-3">
                  <div className="text-slate-400 text-[11px]">Desk Inquiries</div>
                  <div className="font-mono tabular-nums font-bold text-white text-sm">{m.customerDeskInquiries}</div>
                </div>
                <div className="py-1.5 sm:py-0 sm:px-3">
                  <div className="text-slate-400 text-[11px]">Checkouts</div>
                  <div className="font-mono tabular-nums font-bold text-white text-sm">{m.checkoutOrders}</div>
                </div>
                <div className="py-1.5 sm:py-0 sm:px-3 last:sm:pr-0">
                  <div className="text-slate-400 text-[11px]">Verified Cash</div>
                  <div className="font-mono tabular-nums font-bold text-emerald-400 text-sm">₹{Number(m.verifiedCashINR || 0).toFixed(2)}</div>
                </div>
              </div>
            )}

            {diagnosis && (
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-slate-400">Bottleneck:</span>{' '}
                    <span className="font-mono font-semibold text-amber-300">{diagnosis.bottleneckStage}</span>
                  </div>
                  <div className="font-mono tabular-nums text-[11px] text-slate-400">
                    {activeReport
                      ? `Repaired ${activeReport.priceRepair?.repairedCount ?? 0} prices · Rerouted ${activeReport.outreachRepair?.reroutedToEmailCount ?? 0} drafts · Disqualified ${activeReport.outreachRepair?.disqualifiedEnterpriseCount ?? 0} enterprise · ${activeReport.openAnomaliesCount ?? 0} open`
                      : `Source: ${diagnosis.diagnosisSource}`}
                  </div>
                </div>
                <div className="text-slate-200">
                  <span className="text-slate-400">Next Action:</span> {diagnosis.recommendedAction}
                </div>
                <div className="text-slate-400">
                  <span>Auto-Applied:</span> {diagnosis.autoAppliedFix}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* 4. 1-Click GitHub PR Sync Bridge (feature branch -> PR to main) */}
      <div className="border-t border-slate-800 pt-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
              <GitBranch className="w-4 h-4 text-cyan-400" />
              <span>GitHub PR Sync Bridge (Branch → Pull Request to main)</span>
            </h4>
            <p className="text-xs text-slate-400">
              Diff workspace files against harshavardhankotu/ai-marketing-organization (main), push to a PR feature branch, and open a Pull Request. Direct pushes to main/master are disabled.
            </p>
          </div>
          <button
            type="button"
            onClick={handleLoadManifest}
            disabled={manifestLoading || pushingDeploy}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${manifestLoading ? 'animate-spin' : ''}`} />
            <span>{manifestLoading ? 'Checking Tree...' : 'Check Changed Files'}</span>
          </button>
        </div>

        {deployError && (
          <div className="py-2.5 px-3 rounded-lg bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{deployError}</span>
          </div>
        )}

        {deploySuccess && (
          <div className="py-2.5 px-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-2">
            <span>
              {deploySuccess.noChanges
                ? 'Remote main branch is already up to date.'
                : `Committed ${deploySuccess.filesPushedCount} file(s) to ${deploySuccess.branch || targetBranch} (${deploySuccess.commitSha.slice(0, 7)}).`}
            </span>
            <div className="flex items-center gap-3">
              {deploySuccess.prUrl && (
                <a
                  href={deploySuccess.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-300 hover:text-emerald-200 underline font-semibold inline-flex items-center gap-1"
                >
                  <span>View Pull Request{deploySuccess.prNumber ? ` #${deploySuccess.prNumber}` : ''}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <a
                href={deploySuccess.commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-300 hover:text-cyan-200 underline inline-flex items-center gap-1"
              >
                <span>View Commit</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

        {manifest && (
          <div className="text-xs space-y-2 bg-slate-950/60 border border-slate-800 rounded-lg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300 font-mono tabular-nums">
              <span>{manifest.repo} ({manifest.branch})</span>
              <span>
                {manifest.totalScanned} scanned · {manifest.modifiedFiles.length} modified · {manifest.addedFiles.length} added
              </span>
            </div>
            {manifest.changedCount > 0 && (
              <div className="max-h-28 overflow-y-auto text-[11px] font-mono text-slate-400 space-y-0.5 border-t border-slate-800 pt-2">
                {manifest.modifiedFiles.map((f) => (
                  <div key={f.path}>M {f.path}</div>
                ))}
                {manifest.addedFiles.map((f) => (
                  <div key={f.path} className="text-emerald-400">A {f.path}</div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-2.5 text-xs">
          {!manifest?.tokenConfigured && (
            <input
              type="password"
              value={githubTokenInput}
              onChange={(e) => setGithubTokenInput(e.target.value)}
              placeholder="One-time GitHub PAT (Contents + PR Write)"
              autoComplete="off"
              className="md:w-56 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500"
            />
          )}
          <input
            type="text"
            value={targetBranch}
            onChange={(e) => setTargetBranch(e.target.value)}
            placeholder="PR branch (never main)"
            className="md:w-56 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 placeholder-slate-500 font-mono"
          />
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message"
            className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500"
          />
          <button
            type="button"
            onClick={handlePushToGithub}
            disabled={pushingDeploy || (!manifest?.tokenConfigured && !githubTokenInput.trim())}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold inline-flex items-center justify-center gap-1.5 shrink-0"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>{pushingDeploy ? 'Opening PR...' : 'Push Branch & Open PR'}</span>
          </button>
        </div>
      </div>
    </section>
  );
};
