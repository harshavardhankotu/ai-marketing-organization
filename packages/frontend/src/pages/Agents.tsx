import React, { useState, useEffect } from 'react';
import {
  Bot,
  Search,
  Play,
  RefreshCw,
  X
} from 'lucide-react';
import { AgentDescriptor, formatINR } from '@ai-marketing/shared';
import { api } from '../services/api.js';

interface AgentsProps {
  agents: AgentDescriptor[];
}

export const Agents: React.FC<AgentsProps> = ({ agents }) => {
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedAgent, setSelectedAgent] = useState<AgentDescriptor | null>(null);
  const [scorecards, setScorecards] = useState<Record<string, any>>({});
  const [automationData, setAutomationData] = useState<any>(null);
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);

  const loadAutomationAndScorecards = async () => {
    const [scRes, autoRes] = await Promise.all([
      api.getAgentScorecards().catch(() => ({ data: [] })),
      api.getOwnerAutomation().catch(() => null)
    ]);
    const list = scRes?.data || [];
    const map: Record<string, any> = {};
    for (const sc of list) {
      if (sc.agentId) map[sc.agentId] = sc;
    }
    setScorecards(map);
    setAutomationData(autoRes?.data || autoRes || null);
  };

  useEffect(() => {
    loadAutomationAndScorecards();
  }, []);

  const handleRunWorkflow = async (workflowId: string) => {
    setRunningWorkflowId(workflowId);
    setWorkflowMessage(null);
    try {
      const res = await api.runAutomationWorkflow(workflowId);
      setWorkflowMessage(
        `Workflow ${workflowId} executed (${res?.status || res?.data?.status || 'COMPLETED'}).`
      );
      await loadAutomationAndScorecards();
    } catch (err: any) {
      setWorkflowMessage(err?.data?.error || err?.message || `Failed to run ${workflowId}.`);
    } finally {
      setRunningWorkflowId(null);
    }
  };

  const handleToggleWorkflow = async (workflowId: string, nextEnabled: boolean) => {
    try {
      await api.toggleAutomationWorkflow(workflowId, nextEnabled);
      await loadAutomationAndScorecards();
    } catch {}
  };

  const categories = [
    { id: 'ALL', label: 'All 80 Agents', count: agents.length },
    { id: 'RESEARCH_INTELLIGENCE', label: 'Research & Intel', count: 20 },
    { id: 'CONTENT', label: 'Content Studio', count: 20 },
    { id: 'MARKETING_GROWTH', label: 'Marketing & Growth', count: 20 },
    { id: 'ANALYTICS_LEARNING', label: 'Analytics & Learning', count: 20 }
  ];

  const filteredAgents = agents.filter(agent => {
    const matchesCategory = activeCategory === 'ALL' || agent.category === activeCategory;
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const workflows: any[] = automationData?.workflows || automationData?.listWorkflows || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-cyan-400" />
            AI Org (80 Agents) &amp; Live Workflow Registry
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Orchestrated via AutomationRegistryEngine and SystemDoctor under strict Gemini free-tier quotas.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search agents or roles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* Live Autonomous Workflows & Heartbeats */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white">Live Autonomous Workflows ({workflows.length})</h3>
            <p className="text-xs text-slate-400">
              Global Pause: <span className="font-mono text-slate-200">{automationData?.isGlobalPaused ? 'PAUSED' : 'ACTIVE'}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={loadAutomationAndScorecards}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Heartbeats</span>
          </button>
        </div>

        {workflowMessage && (
          <div className="p-3 rounded bg-slate-950 border border-cyan-500/30 text-xs text-cyan-200">
            {workflowMessage}
          </div>
        )}

        {workflows.length === 0 ? (
          <p className="text-xs text-slate-400">No active workflow definitions returned yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            {workflows.map((wf: any) => (
              <div key={wf.id} className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white truncate">{wf.name || wf.id}</span>
                    <span className={`font-mono text-[11px] ${wf.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {wf.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-1">
                    Last Run: {wf.lastRunAt ? new Date(wf.lastRunAt).toLocaleString() : 'Never'}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleToggleWorkflow(wf.id, !wf.enabled)}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                  >
                    {wf.enabled ? 'Pause' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    disabled={runningWorkflowId === wf.id}
                    onClick={() => handleRunWorkflow(wf.id)}
                    className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-[11px] inline-flex items-center gap-1"
                  >
                    <Play className="w-3 h-3" />
                    <span>{runningWorkflowId === wf.id ? 'Running...' : 'Run Now'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Division Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        {categories.map(c => (
          <button
            key={c.id}
            onClick={() => setActiveCategory(c.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeCategory === c.id
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>{c.label}</span>
            <span className="font-mono tabular-nums text-[11px] opacity-80">({c.count})</span>
          </button>
        ))}
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredAgents.map(agent => (
          <div
            key={agent.id}
            onClick={() => setSelectedAgent(agent)}
            className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/50 cursor-pointer transition-all flex flex-col justify-between group"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[11px] text-slate-400">{agent.id}</span>
                <span className="text-[11px] font-mono text-emerald-400 font-medium">{agent.status}</span>
              </div>
              <h3 className="font-bold text-sm text-slate-100 group-hover:text-cyan-400 transition-colors">
                {agent.name}
              </h3>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">{agent.role}</p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
              {scorecards[agent.id] && scorecards[agent.id].realDecisionsCount > 0 ? (
                <>
                  <span>Decisions: <strong className="text-slate-300 font-mono tabular-nums">{scorecards[agent.id].realDecisionsCount}</strong></span>
                  <span>Quality: <strong className="text-slate-300 font-mono tabular-nums">{(scorecards[agent.id].outcomeQualityScore * 100).toFixed(0)}%</strong></span>
                </>
              ) : (
                <>
                  <span className="font-mono text-[10px] text-slate-500">NO_EXECUTIONS</span>
                  <span>Scope: <strong className="text-slate-400">{agent.memoryScope}</strong></span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Agent Contract Inspector Modal */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[85vh] overflow-y-auto">
            <button
              onClick={() => setSelectedAgent(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center font-mono font-bold">
                {selectedAgent.id.split('-')[0]}
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">{selectedAgent.name}</h3>
                <p className="text-xs text-slate-400">
                  {selectedAgent.role} · v{selectedAgent.version}
                </p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">System Instruction</label>
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-slate-300 font-mono text-[11px] leading-relaxed">
                  {selectedAgent.systemInstruction}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Allowed Tools</label>
                  <div className="text-slate-300 font-mono text-[11px] space-y-1">
                    {selectedAgent.allowedTools.map((t, idx) => (
                      <div key={idx} className="p-1.5 rounded bg-slate-950 border border-slate-800">{t}</div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Task Permissions</label>
                  <div className="text-cyan-400 font-mono text-[11px] space-y-1">
                    {selectedAgent.taskPermissions.map((p, idx) => (
                      <div key={idx} className="p-1.5 rounded bg-slate-950 border border-slate-800">{p}</div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Measured Performance &amp; Telemetry</label>
                {selectedAgent && scorecards[selectedAgent.id] && scorecards[selectedAgent.id].realDecisionsCount > 0 ? (
                  <div className="grid grid-cols-4 gap-2 p-3 bg-slate-950 rounded-lg border border-slate-800 text-center font-mono tabular-nums">
                    <div>
                      <div className="text-slate-500 text-[10px]">Real Decisions</div>
                      <div className="font-bold text-slate-200 text-sm">{scorecards[selectedAgent.id].realDecisionsCount}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">Successful</div>
                      <div className="font-bold text-slate-200 text-sm">{scorecards[selectedAgent.id].successfulActions}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">Quality Score</div>
                      <div className="font-bold text-cyan-400 text-sm">{(scorecards[selectedAgent.id].outcomeQualityScore * 100).toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">Revenue Influenced</div>
                      <div className="font-bold text-emerald-400 text-sm">{formatINR(scorecards[selectedAgent.id].realRevenueInfluencedINR || 0)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-center">
                    <div className="font-mono text-xs font-semibold text-amber-400 mb-1">NO_VERIFIED_EXECUTION_DATA</div>
                    <div className="text-slate-500 text-[11px]">Zero verified production executions recorded yet for {selectedAgent?.name}.</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};