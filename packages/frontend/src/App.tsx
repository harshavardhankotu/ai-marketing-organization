import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/layout/Sidebar.js';
import { Navbar } from './components/layout/Navbar.js';
import { KillSwitchModal } from './components/layout/KillSwitchModal.js';
import { Dashboard } from './pages/Dashboard.js';
import { Revenue } from './pages/Revenue.js';
import { CustomerJourney } from './pages/CustomerJourney.js';
import { PublicBookingPage } from './pages/PublicBookingPage.js';
import { UniversalFunnelPage } from './pages/UniversalFunnelPage.js';
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
import { BusinessOnboarding } from './components/onboarding/BusinessOnboarding.js';
import { OwnerLogin } from './components/auth/OwnerLogin.js';
import { api, onUnauthorized } from './services/api.js';
import { AGENT_REGISTRY } from './services/seed-defaults.js';

export type AuthState = 'BOOTING' | 'AUTHENTICATED' | 'UNAUTHENTICATED';

export const App: React.FC = () => {
  const [authState, setAuthState] = useState<AuthState>('BOOTING');
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [loading, setLoading] = useState<boolean>(true);
  const [isCycleRunning, setIsCycleRunning] = useState<boolean>(false);
  const [isKillModalOpen, setIsKillModalOpen] = useState<boolean>(false);
  const [cycleError, setCycleError] = useState<string | null>(null);

  // Core domain states populated strictly from the authenticated backend
  const [business, setBusiness] = useState<any>(null);
  const [goals, setGoals] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>(AGENT_REGISTRY);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [contentAssets, setContentAssets] = useState<any[]>([]);
  const [researchFindings, setResearchFindings] = useState<any[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any>({ metrics: null, events: [], attributions: [] });
  const [experiments, setExperiments] = useState<any[]>([]);
  const [evolutionData, setEvolutionData] = useState<any>(null);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [quota, setQuota] = useState<any>(null);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [readiness, setReadiness] = useState<any>(null);

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

      setBusiness(bizRes.data || null);
      setGoals(goalsRes.data || []);
      setAgents(agentsRes.data && agentsRes.data.length > 0 ? agentsRes.data : AGENT_REGISTRY);
      setCampaigns(campRes.data || []);
      setContentAssets(cntRes.data || []);
      setResearchFindings(resRes.data || []);
      setAnalyticsData(anaRes.data || { metrics: null, events: [], attributions: [] });
      setExperiments(expRes.data || []);
      setEvolutionData(evoRes.data || null);
      setApprovals(appRes.data || []);
      setQuota(quoRes.data || null);
      setIntegrations(intRes.data || []);
      setActivityLogs(actRes.data || []);
      setReadiness(readyRes.data || null);
    } finally {
      setLoading(false);
    }
  };

  // Universal public demand funnels.
  // Canonical shape: /f/<business-public-slug>/<funnel-slug>
  // Also accepts /book/<business-public-slug>/<funnel-slug> for simple links.
  const isPublicFunnelRoute = typeof window !== 'undefined' && (
    window.location.pathname === '/book' ||
    window.location.pathname.startsWith('/book/') ||
    window.location.pathname.startsWith('/f/')
  );

  const bootstrapOwnerSession = async () => {
    setAuthState('BOOTING');
    setLoading(true);
    try {
      const sessionRes = await api.getOwnerSession();
      if (sessionRes?.data?.principal_type === 'OWNER' || sessionRes?.data?.user_id) {
        setAuthState('AUTHENTICATED');
        await loadAllData();
      } else {
        setAuthState('UNAUTHENTICATED');
        setLoading(false);
      }
    } catch {
      setAuthState('UNAUTHENTICATED');
      setLoading(false);
    }
  };

  useEffect(() => {
    // Public demand funnels must not fan out into authenticated owner APIs
    if (isPublicFunnelRoute) {
      setLoading(false);
      return;
    }

    onUnauthorized(() => {
      setAuthState('UNAUTHENTICATED');
    });

    bootstrapOwnerSession();
  }, [isPublicFunnelRoute]);

  const handleLoginSuccess = async () => {
    setAuthState('AUTHENTICATED');
    setLoading(true);
    await loadAllData();
  };

  const handleLogout = async () => {
    try {
      await api.logoutOwner();
    } catch {}
    setAuthState('UNAUTHENTICATED');
    setBusiness(null);
    setGoals([]);
    setCampaigns([]);
    setContentAssets([]);
    setResearchFindings([]);
    setAnalyticsData({ metrics: null, events: [], attributions: [] });
    setExperiments([]);
    setEvolutionData(null);
    setApprovals([]);
    setQuota(null);
    setIntegrations([]);
    setActivityLogs([]);
    setReadiness(null);
  };

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

  if (isPublicFunnelRoute) {
    return <UniversalFunnelPage />;
  }

  if (authState === 'BOOTING') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 font-sans">
        <div className="w-10 h-10 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium text-slate-300">Verifying Owner Session...</p>
        <p className="text-xs text-slate-500 mt-1">Connecting to Secure Boundary</p>
      </div>
    );
  }

  if (authState === 'UNAUTHENTICATED') {
    return <OwnerLogin onLoginSuccess={handleLoginSuccess} />;
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
          businessName={business?.name || 'Onboard a Business'}
          autonomyMode={business?.autonomy_mode || 'ASSISTED'}
          killSwitchActive={business?.kill_switch_active === 1}
          onOpenKillSwitchModal={() => setIsKillModalOpen(true)}
          onTriggerCycle={handleTriggerCycle}
          isCycleRunning={isCycleRunning}
          onLogout={handleLogout}
          quotaInfo={{
            requestsToday: quota?.geminiRequestsToday || 0,
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

          {(currentTab === 'onboarding' || (!business && currentTab === 'dashboard')) && (
            <BusinessOnboarding
              onCompleted={(newBiz) => {
                setBusiness(newBiz);
                loadAllData();
                setCurrentTab('dashboard');
              }}
            />
          )}

          {currentTab === 'dashboard' && business && (
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
            <ContentStudio contentAssets={contentAssets} business={business} />
          )}

          {currentTab === 'research' && (
            <Research
              findings={researchFindings}
              businessId={business?.id}
              onRefresh={loadAllData}
            />
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