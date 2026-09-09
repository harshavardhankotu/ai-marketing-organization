import React, { useState } from 'react';
import { 
  Bot, 
  Search, 
  Filter, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  ExternalLink,
  Shield,
  Layers,
  Sparkles,
  X
} from 'lucide-react';
import { AgentDescriptor, formatINR } from '@ai-marketing/shared';

interface AgentsProps {
  agents: AgentDescriptor[];
}

export const Agents: React.FC<AgentsProps> = ({ agents }) => {
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedAgent, setSelectedAgent] = useState<AgentDescriptor | null>(null);

  const categories = [
    { id: 'ALL', label: 'All 80 Agents', count: agents.length },
    { id: 'RESEARCH_INTELLIGENCE', label: 'Research & Intel', count: 20 },
    { id: 'CONTENT', label: 'Content Studio', count: 20 },
    { id: 'MARKETING_GROWTH', label: 'Marketing & Growth', count: 20 },
    { id: 'ANALYTICS_LEARNING', label: 'Analytics & Learning', count: 20 },
  ];

  const filteredAgents = agents.filter(agent => {
    const matchesCategory = activeCategory === 'ALL' || agent.category === activeCategory;
    const matchesSearch = agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          agent.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          agent.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-cyan-400" />
            The 80-Agent Autonomous Organization
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Governed by the Control Plane. Specialized workers orchestrated via priority queues under Gemini free-tier capacity.
          </p>
        </div>

        {/* Search */}
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

      {/* Division Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        {categories.map(c => (
          <button
            key={c.id}
            onClick={() => setActiveCategory(c.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeCategory === c.id
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>{c.label}</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              activeCategory === c.id ? 'bg-slate-950 text-cyan-400' : 'bg-slate-700 text-slate-300'
            }`}>
              {c.count}
            </span>
          </button>
        ))}
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredAgents.map(agent => (
          <div
            key={agent.id}
            onClick={() => setSelectedAgent(agent)}
            className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-850 cursor-pointer transition-all flex flex-col justify-between group shadow-sm"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  {agent.id}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  {agent.status}
                </span>
              </div>
              <h3 className="font-bold text-sm text-slate-100 group-hover:text-cyan-400 transition-colors">
                {agent.name}
              </h3>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                {agent.role}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
              <span>Success: <strong className="text-slate-300">{(agent.performanceMetrics.completionRate * 100).toFixed(0)}%</strong></span>
              <span>Memory: <strong className="text-slate-300">{agent.memoryScope}</strong></span>
            </div>
          </div>
        ))}
      </div>

      {/* Agent Contract Inspector Modal */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[85vh] overflow-y-auto">
            <button
              onClick={() => setSelectedAgent(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center font-mono font-bold">
                {selectedAgent.id.split('-')[0]}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white">{selectedAgent.name}</h3>
                  <span className="font-mono text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                    v{selectedAgent.version}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{selectedAgent.role}</p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              {/* System Instruction */}
              <div>
                <label className="block text-slate-400 font-semibold mb-1">System Instruction</label>
                <div className="p-3 bg-slate-850 rounded-lg border border-slate-800 text-slate-300 font-mono text-[11px] leading-relaxed">
                  {selectedAgent.systemInstruction}
                </div>
              </div>

              {/* Capabilities & Tools */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Allowed Tools</label>
                  <div className="flex flex-wrap gap-1">
                    {selectedAgent.allowedTools.map((t, idx) => (
                      <span key={idx} className="px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Task Permissions</label>
                  <div className="flex flex-wrap gap-1">
                    {selectedAgent.taskPermissions.map((p, idx) => (
                      <span key={idx} className="px-2 py-1 rounded bg-cyan-950/40 text-cyan-400 border border-cyan-800/40">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Metrics */}
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Telemetry & Cost Metrics</label>
                <div className="grid grid-cols-3 gap-2 p-3 bg-slate-850 rounded-lg border border-slate-800 text-center">
                  <div>
                    <div className="text-slate-500 text-[10px]">Avg Latency</div>
                    <div className="font-bold text-slate-200 text-sm">{selectedAgent.performanceMetrics.avgLatencyMs}ms</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[10px]">Executions</div>
                    <div className="font-bold text-slate-200 text-sm">{selectedAgent.performanceMetrics.totalExecutions}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[10px]">Cost Incurred</div>
                    <div className="font-bold text-emerald-400 text-sm">{formatINR(selectedAgent.performanceMetrics.costIncurredINR)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};