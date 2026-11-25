import React, { useState } from 'react';
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
  Building2,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'onboarding'
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

interface SidebarItem {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

const ADVANCED_TAB_IDS: NavTab[] = ['agents', 'simulation', 'experiments', 'evolution'];

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, pendingApprovalsCount }) => {
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => ADVANCED_TAB_IDS.includes(currentTab));

  const primarySections: Array<{ title: string; items: SidebarItem[] }> = [
    {
      title: 'Business',
      items: [
        { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
        { id: 'onboarding', label: 'Onboard Business', icon: Building2 },
        { id: 'revenue', label: 'Revenue & UPI', icon: IndianRupee }
      ]
    },
    {
      title: 'Customers',
      items: [
        { id: 'journey', label: 'Customer Funnel', icon: Users },
        { id: 'research', label: 'Research & Intel', icon: Search }
      ]
    },
    {
      title: 'Marketing',
      items: [
        { id: 'campaigns', label: 'Campaigns', icon: Compass },
        { id: 'content', label: 'Content Studio', icon: FileText },
        { id: 'analytics', label: 'Analytics & Attribution', icon: BarChart3 },
        { id: 'approvals', label: 'Approval Queue', icon: CheckSquare, badge: pendingApprovalsCount }
      ]
    },
    {
      title: 'System',
      items: [
        { id: 'activity', label: 'Activity Log', icon: Activity },
        { id: 'settings', label: 'Settings & Quotas', icon: Settings }
      ]
    }
  ];

  const advancedItems: SidebarItem[] = [
    { id: 'agents', label: '80-Agent Directory', icon: Bot },
    { id: 'simulation', label: 'Simulation / Dry Run', icon: PlayCircle },
    { id: 'experiments', label: 'Experiments Lab', icon: FlaskConical },
    { id: 'evolution', label: 'Evolution & Decisions', icon: History }
  ];

  const renderNavButton = (item: SidebarItem) => {
    const Icon = item.icon;
    const isActive = currentTab === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelectTab(item.id)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all ${
          isActive
            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
          <span className="truncate">{item.label}</span>
        </div>
        {item.badge && item.badge > 0 ? (
          <span className="px-1.5 py-0.5 text-[11px] font-semibold font-mono tabular-nums rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
            {item.badge}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
      <div className="p-5 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-500/20">
          AI
        </div>
        <div>
          <h1 className="font-bold text-sm tracking-tight text-white leading-tight">AI Marketing Org</h1>
          <p className="text-xs text-slate-400 font-medium">India-First Edition</p>
        </div>
      </div>

      <nav className="p-3 space-y-4 flex-1 overflow-y-auto">
        {primarySections.map(section => (
          <div key={section.title} className="space-y-1">
            <div className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {section.title}
            </div>
            {section.items.map(renderNavButton)}
          </div>
        ))}

        <div className="pt-2 border-t border-slate-800/80 space-y-1">
          <button
            type="button"
            onClick={() => setAdvancedOpen(prev => !prev)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200"
            aria-expanded={advancedOpen}
          >
            <span>Advanced</span>
            {advancedOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          {advancedOpen && <div className="space-y-1">{advancedItems.map(renderNavButton)}</div>}
        </div>
      </nav>

      {(() => {
        let activeBiz: any = null;
        try {
          const raw = localStorage.getItem('ai_marketing_active_business');
          if (raw) activeBiz = JSON.parse(raw);
        } catch {}

        return (
          <div className="p-4 border-t border-slate-800 text-xs text-slate-500 flex flex-col gap-1">
            <div className="flex items-center justify-between text-slate-400 font-medium">
              <span>Operating Scope</span>
              <span className="text-cyan-400 font-mono">{activeBiz?.city || 'Pan-India'}</span>
            </div>
            <div className="font-semibold text-slate-300 truncate">
              {activeBiz?.name || 'Single-Owner System'}
            </div>
          </div>
        );
      })()}
    </aside>
  );
};
