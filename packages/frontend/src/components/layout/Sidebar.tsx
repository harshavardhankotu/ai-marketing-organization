import React from 'react';
import { 
  LayoutDashboard, 
  Bot, 
  Compass, 
  FileText, 
  Search, 
  BarChart3, 
  FlaskConical, 
  History, 
  CheckSquare, 
  Activity, 
  Settings, 
  PlayCircle,
  IndianRupee,
  Users,
  Globe
} from 'lucide-react';

export type NavTab = 
  | 'dashboard'
  | 'public_landing'
  | 'revenue'
  | 'journey'
  | 'agents'
  | 'campaigns'
  | 'content'
  | 'research'
  | 'analytics'
  | 'experiments'
  | 'evolution'
  | 'approvals'
  | 'activity'
  | 'simulation'
  | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  pendingApprovalsCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, pendingApprovalsCount }) => {
  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'public_landing', label: 'Public Patient Page', icon: Globe },
    { id: 'revenue', label: 'Revenue & UPI', icon: IndianRupee },
    { id: 'journey', label: 'Customer Funnel', icon: Users },
    { id: 'agents', label: 'AI Org (80 Agents)', icon: Bot },
    { id: 'campaigns', label: 'Campaigns', icon: Compass },
    { id: 'content', label: 'Content Studio', icon: FileText },
    { id: 'research', label: 'Research & Intel', icon: Search },
    { id: 'analytics', label: 'Analytics & Attribution', icon: BarChart3 },
    { id: 'experiments', label: 'Experiments Lab', icon: FlaskConical },
    { id: 'evolution', label: 'Evolution & Decisions', icon: History },
    { id: 'approvals', label: 'Approval Queue', icon: CheckSquare, badge: pendingApprovalsCount },
    { id: 'simulation', label: 'Simulation / Dry Run', icon: PlayCircle },
    { id: 'activity', label: 'Activity Log', icon: Activity },
    { id: 'settings', label: 'Settings & Quotas', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-500/20">
          AI
        </div>
        <div>
          <h1 className="font-bold text-sm tracking-tight text-white leading-tight">AI Marketing Org</h1>
          <p className="text-xs text-slate-400 font-medium">India-First Edition</p>
        </div>
      </div>

      {/* Nav List */}
      <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id as NavTab)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge && item.badge > 0 ? (
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800 text-xs text-slate-500 flex flex-col gap-1">
        <div className="flex items-center justify-between text-slate-400 font-medium">
          <span>Target Business</span>
          <span className="text-cyan-400">Hyderabad</span>
        </div>
        <div>SmileKraft Dental (₹50k/mo)</div>
      </div>
    </aside>
  );
};