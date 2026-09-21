import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/layout/Sidebar.js';
import { Navbar } from './components/layout/Navbar.js';
import { KillSwitchModal } from './components/layout/KillSwitchModal.js';
import { Dashboard } from './pages/Dashboard.js';
import { Revenue } from './pages/Revenue.js';
import { CustomerJourney } from './pages/CustomerJourney.js';
import { PublicBookingPage } from './pages/PublicBookingPage.js';
import { Agents } from './pages/Agents.js';
import { Campaigns } from './pages/Campaigns.js';
import { ContentStudio } from './pages/ContentStudio.js';
import { Research } from './pages/Research.js';
import { Analytics } from './pages/Analytics.js';
import { Experiments } from './pages/Experiments.js';
import { Evolution } from './pages/Evolution.js';
import { Approvals } from './pages/Approvals.js';
import { Activity } from './pages/Activity.js';
import { Simulation } from './pages/Simulation.js';
import { Settings } from './pages/Settings.js';
import { HealthStatusCard } from './components/common/HealthStatusCard.js';
import { api } from './services/api.js';
import { 
  DEFAULT_BUSINESS, 
  DEFAULT_GOALS, 
  DEFAULT_CAMPAIGNS, 
  DEFAULT_CONTENT_ASSETS, 
  DEFAULT_RESEARCH, 
  DEFAULT_EXPERIMENTS, 
  DEFAULT_EVOLUTION, 
  DEFAULT_METRICS, 
  DEFAULT_APPROVALS, 
  DEFAULT_INTEGRATIONS, 
  DEFAULT_QUOTA, 
  DEFAULT_READINESS,
  AGENT_REGISTRY 
} from './services/seed-defaults.js';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [loading, setLoading] = useState<boolean>(true);
  const [isCycleRunning, setIsCycleRunning] = useState<boolean>(false);
  const [isKillModalOpen, setIsKillModalOpen] = useState<boolean>(false);
  const [cycleError, setCycleError] = useState<string | null>(null);

  // Core domain states with rich canonical defaults
  const [business, setBusiness] = useState<any>(DEFAULT_BUSINESS);
  const [goals, setGoals] = useState<any[]>(DEFAULT_GOALS);
  const [agents, setAgents] = useState<any[]>(AGENT_REGISTRY);
  const [campaigns, setCampaigns] = useState<any[]>(DEFAULT_CAMPAIGNS);
  const [contentAssets, setContentAssets] = useState<any[]>(DEFAULT_CONTENT_ASSETS);
  const [researchFindings, setResearchFindings] = useState<any[]>(DEFAULT_RESEARCH);
  const [analyticsData, setAnalyticsData] = useState<any>({ metrics: DEFAULT_METRICS, events: [], attributions: [] });
  const [experiments, setExperiments] = useState<any[]>(DEFAULT_EXPERIMENTS);
  const [evolutionData, setEvolutionData] = useState<any>(DEFAULT_EVOLUTION);
  const [approvals, setApprovals] = useState<any[]>(DEFAULT_APPROVALS);
  const [quota, setQuota] = useState<any>(DEFAULT_QUOTA);
  const [integrations, setIntegrations] = useState<any[]>(DEFAULT_INTEGRATIONS);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [readiness, setReadiness] = useState<any>(DEFAULT_READINESS);

  const loadAllData = async () => {
    try {
      const [
        bizRes,
        goalsRes,
        agentsRes,
        campRes,
        cntRes,
        resRes,
        anaRes,
        expRes,
        evoRes,
        appRes,
        quoRes,
        intRes,
        actRes,
        readyRes
      ] = await Promise.all([
        api.getBusiness().catch(() => ({ data: null })),
        api.getGoals().catch(() => ({ data: [] })),
        api.getAgents().catch(() => ({ data: [] })),
        api.getCampaigns().catch(() => ({ data: [] })),
        api.getContent().catch(() => ({ data: [] })),
        api.getResearch().catch(() => ({ data: [] })),
        api.getDashboardAnalytics().catch(() => ({ data: null })),
        api.getExperiments().catch(() => ({ data: [] })),
        api.getEvolution().catch(() => ({ data: null })),
        api.getApprovals().catch(() => ({ data: [] })),
        api.getQuota().catch(() => ({ data: null })),
        api.getIntegrations().catch(() => ({ data: [] })),
        api.getActivity().catch(() => ({ data: [] })),
        api.getSystemReadiness().catch(() => ({ data: null }))
      ]);

      setBusiness(bizRes.data || DEFAULT_BUSINESS);
      setGoals(goalsRes.data && goalsRes.data.length > 0 ? goalsRes.data : DEFAULT_GOALS);
      setAgents(agentsRes.data && agentsRes.data.length > 0 ? agentsRes.data : AGENT_REGISTRY);
      setCampaigns(campRes.data && campRes.data.length > 0 ? campRes.data : DEFAULT_CAMPAIGNS);
      setContentAssets(cntRes.data && cntRes.data.length > 0 ? cntRes.data : DEFAULT_CONTENT_ASSETS);
      setResearchFindings(resRes.data && resRes.data.length > 0 ? resRes.data : DEFAULT_RESEARCH);
      setAnalyticsData(anaRes.data?.metrics?.impressions ? anaRes.data : { metrics: DEFAULT_METRICS, events: [], attributions: [] });
      setExperiments(expRes.data && expRes.data.length > 0 ? expRes.data : DEFAULT_EXPERIMENTS);
      setEvolutionData(evoRes.data?.strategies?.length > 0 ? evoRes.data : DEFAULT_EVOLUTION);
      setApprovals(appRes.data && appRes.data.length > 0 ? appRes.data : DEFAULT_APPROVALS);
      setQuota(quoRes.data || DEFAULT_QUOTA);
      setIntegrations(intRes.data && intRes.data.length > 0 ? intRes.data : DEFAULT_INTEGRATIONS);
      setActivityLogs(actRes.data || []);
      setReadiness(readyRes.data || DEFAULT_READINESS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const handleTriggerCycle = async () => {
    setIsCycleRunning(true);
    setCycleError(null);
    try {
      await api.triggerCycle(business?.id, goals[0]?.id);
      await loadAllData();
    } catch (err: any) {
      setCycleError(err.message);
    } finally {
      setIsCycleRunning(false);
    }
  };

  const handleToggleKillSwitch = async (reason: string) => {
    if (!business?.id) return;
    const newActive = !business.kill_switch_active;
    await api.toggleKillSwitch(business.id, newActive, reason);
    await loadAllData();
  };

  const handleResolveApproval = async (data: any) => {
    await api.resolveApproval(data);
    await loadAllData();
  };

  const pendingApprovalsCount = approvals.filter(a => a.status === 'PENDING').length;

  // Direct public patient route (e.g. ad landing page /aligners-hyderabad)
  const isDirectPublicLanding = typeof window !== 'undefined' && (
    window.location.pathname === '/aligners-hyderabad' ||
    window.location.pathname === '/aligners' ||
    window.location.pathname.startsWith('/booking') ||
    window.location.pathname.startsWith('/public')
  );

  if (isDirectPublicLanding) {
    return <PublicBookingPage />;
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        pendingApprovalsCount={pendingApprovalsCount}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Navbar
          businessName={business?.name || 'SmileKraft Dental Clinic'}
          autonomyMode={business?.autonomy_mode || 'ASSISTED'}
          killSwitchActive={business?.kill_switch_active === 1}
          onOpenKillSwitchModal={() => setIsKillModalOpen(true)}
          onTriggerCycle={handleTriggerCycle}
          isCycleRunning={isCycleRunning}
          quotaInfo={{
            requestsToday: quota?.geminiRequestsToday || 14,
            maxRequests: quota?.geminiMaxDailyRequests || 1500,
            isTripped: quota?.circuitBreakerTripped || false
          }}
          operatingMilestone={readiness?.operatingState || readiness?.status}
        />

        {/* Scrollable Page Canvas */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {cycleError && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start justify-between gap-3 shadow-lg">
              <div className="flex items-start gap-2">
                <span className="font-bold text-rose-200 shrink-0">System Alert:</span>
                <span className="leading-relaxed">{cycleError}</span>
              </div>
              <button
                onClick={() => setCycleError(null)}
                className="text-rose-400 hover:text-white font-bold px-2 py-0.5 rounded hover:bg-rose-500/20"
              >
                ✕
              </button>
            </div>
          )}

          <HealthStatusCard />

          {currentTab === 'dashboard' && (
            <Dashboard
              metrics={analyticsData.metrics}
              business={business}
              goal={goals[0]}
              campaigns={campaigns}
              experiments={experiments}
              onTriggerCycle={handleTriggerCycle}
              isCycleRunning={isCycleRunning}
              onNavigateTab={setCurrentTab}
              readiness={readiness}
            />
          )}

          {currentTab === 'public_landing' && (
            <PublicBookingPage onBackToAdmin={() => setCurrentTab('dashboard')} />
          )}

          {currentTab === 'revenue' && (
            <Revenue />
          )}

          {currentTab === 'journey' && (
            <CustomerJourney />
          )}

          {currentTab === 'agents' && (
            <Agents agents={agents} />
          )}

          {currentTab === 'campaigns' && (
            <Campaigns
              campaigns={campaigns}
              onTriggerCycle={handleTriggerCycle}
              isCycleRunning={isCycleRunning}
            />
          )}

          {currentTab === 'content' && (
            <ContentStudio contentAssets={contentAssets} />
          )}

          {currentTab === 'research' && (
            <Research findings={researchFindings} />
          )}

          {currentTab === 'analytics' && (
            <Analytics
              metrics={analyticsData.metrics}
              events={analyticsData.events}
              attributions={analyticsData.attributions}
            />
          )}

          {currentTab === 'experiments' && (
            <Experiments experiments={experiments} />
          )}

          {currentTab === 'evolution' && (
            <Evolution evolutionData={evolutionData} />
          )}

          {currentTab === 'approvals' && (
            <Approvals
              approvals={approvals}
              onResolve={handleResolveApproval}
            />
          )}

          {currentTab === 'activity' && (
            <Activity logs={activityLogs} />
          )}

          {currentTab === 'simulation' && (
            <Simulation />
          )}

          {currentTab === 'settings' && (
            <Settings
              business={business}
              quota={quota}
              integrations={integrations}
            />
          )}
        </main>
      </div>

      {/* Global Kill Switch Modal */}
      <KillSwitchModal
        isOpen={isKillModalOpen}
        onClose={() => setIsKillModalOpen(false)}
        killSwitchActive={business?.kill_switch_active === 1}
        onConfirm={handleToggleKillSwitch}
      />
    </div>
  );
};