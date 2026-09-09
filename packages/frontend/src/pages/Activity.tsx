import React from 'react';
import { Activity as ActivityIcon, Shield, Bot, User, CheckCircle2 } from 'lucide-react';

interface ActivityProps {
  logs: any[];
}

export const Activity: React.FC<ActivityProps> = ({ logs }) => {
  const sampleLogs = logs.length > 0 ? logs : [
    {
      id: 'log_1',
      actor_type: 'AGENT',
      actor_id: 'res-20',
      action: 'SYNTHESIZE_MARKET_INTELLIGENCE',
      entity_type: 'RESEARCH',
      entity_id: 'biz_smilekraft_hyd',
      created_at: new Date().toISOString(),
      details: { topic: 'Local Demand & Search Trends', certainty: 'OBSERVED' }
    },
    {
      id: 'log_2',
      actor_type: 'CONTROL_PLANE',
      actor_id: 'ai-ceo',
      action: 'STRATEGY_VERSION_CREATED',
      entity_type: 'STRATEGY',
      entity_id: 'strat_v1_smilekraft',
      created_at: new Date(Date.now() - 300000).toISOString(),
      details: { version: 1, expected_leads: 100 }
    },
    {
      id: 'log_3',
      actor_type: 'AGENT',
      actor_id: 'cnt-11',
      action: 'GENERATE_CONTENT_ASSET',
      entity_type: 'CONTENT_ASSET',
      entity_id: 'cnt_wa_01',
      created_at: new Date(Date.now() - 600000).toISOString(),
      details: { channel: 'WHATSAPP', language: 'English' }
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
          <ActivityIcon className="w-5 h-5 text-cyan-400" />
          Autonomous Organization Activity Trail
        </h2>
        <p className="text-slate-400 text-xs mt-1">
          Every meaningful agent action, supervisor check, and workflow transition is audited and persisted.
        </p>
      </div>

      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 shadow-sm space-y-4">
        <div className="space-y-3">
          {sampleLogs.map((log: any) => (
            <div key={log.id} className="p-3.5 rounded-lg bg-slate-850 border border-slate-800 flex items-start gap-3 text-xs">
              <div className="p-2 rounded-lg bg-slate-800 text-cyan-400 shrink-0 mt-0.5">
                {log.actor_type === 'USER' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100">{log.action.replace(/_/g, ' ')}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                      {log.actor_id}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                </div>

                <div className="text-slate-400 text-[11px]">
                  Target: <span className="text-slate-300 font-mono">{log.entity_type} ({log.entity_id})</span>
                </div>

                {log.details && (
                  <div className="p-2 rounded bg-slate-900/60 font-mono text-[10px] text-slate-400">
                    {JSON.stringify(log.details)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};