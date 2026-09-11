import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/layout/Sidebar.js';
import { Navbar } from './components/layout/Navbar.js';
import { KillSwitchModal } from './components/layout/KillSwitchModal.js';
import { Dashboard } from './pages/Dashboard.js';
import { Revenue } from './pages/Revenue.js';
import { CustomerJourney } from './pages/CustomerJourney.js';
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

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [loading, setLoading] = useState<boolean>(true);
  const [isCycleRunning, setIsCycleRunning] = useState<boolean>(false);
  const [isKillModalOpen, setIsKillModalOpen] = useState<boolean>(false);

  // Core domain states
  const [business, setBusiness] = useState<any>(null);
  const [goals, setGoals] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [contentAssets, setContentAssets] = useState<any[]>([]);
  const [researchFindings, setResearchFindings] = useState<any[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any>({ metrics: {}, events: [], attributions: [] });
  const [experiments, setExperiments] = useState<any[]>([]);
  const [evolutionData, setEvolutionData] = useState<any>({ strategies: [], learnings: [], decisions: [] });
  const [approvals, setApprovals] = useState<any[]>([]);
  const [quota, setQuota] = useState<any>(null);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);

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
        actRes
      ] = await Promise.all([
        api.getBusiness().catch(() => ({ data: null })),
        api.getGoals().catch(() => ({ data: [] })),
        api.getAgents().catch(() => ({ data: [] })),
        api.getCampaigns().catch(() => ({ data: [] })),
        api.getContent().catch(() => ({ data: [] })),
        api.getResearch().catch(() => ({ data: [] })),
        api.getDashboardAnalytics().catch(() => ({ data: { metrics: {}, events: [], attributions: [] } })),
        api.getExperiments().catch(() => ({ data: [] })),
        api.getEvolution().catch(() => ({ data: { strategies: [], learnings: [], decisions: [] } })),
        api.getApprovals().catch(() => ({ data: [] })),
        api.getQuota().catch(() => ({ data: null })),
        api.getIntegrations().catch(() => ({ data: [] })),
        api.getActivity().catch(() => ({ data: [] }))
      ]);

      setBusiness(bizRes.data);
      setGoals(goalsRes.data || []);
      setAgents(agentsRes.data || []);
      setCampaigns(campRes.data || []);
      setContentAssets(cntRes.data || []);
      setResearchFindings(resRes.data || []);
      setAnalyticsData(anaRes.data || { metrics: {}, events: [], attributions: [] });
      setExperiments(expRes.data || []);
      setEvolutionData(evoRes.data || { strategies: [], learnings: [], decisions: [] });
      setApprovals(appRes.data || []);
      setQuota(quoRes.data);
      setIntegrations(intRes.data || []);
      setActivityLogs(actRes.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const handleTriggerCycle = async () => {
    setIsCycleRunning(true);
    try {
      await api.triggerCycle(business?.id, goals[0]?.id);
      await loadAllData();
    } catch (err: any) {
      alert(`Marketing cycle failed: ${err.message}`);
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
        />

        {/* Scrollable Page Canvas */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
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
            />
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