import React, { useState, useEffect } from 'react';
import { Activity as ActivityIcon, Shield, Bot, User, CheckCircle2, Clock } from 'lucide-react';
import { api } from '../services/api.js';

interface ActivityProps {
  logs: any[];
}

export const Activity: React.FC<ActivityProps> = ({ logs: propLogs }) => {
  const [liveLogs, setLiveLogs] = useState<any[]>(propLogs || []);
  const [automationLogs, setAutomationLogs] = useState<any[]>([]);

  useEffect(() => {
    let isMounted = true;
    if (propLogs && propLogs.length > 0) {
      setLiveLogs(propLogs);
    } else {
      api.getActivity().then(res => {
        if (isMounted) setLiveLogs(Array.isArray(res.data) ? res.data : []);
      }).catch(() => {
        if (isMounted) setLiveLogs([]);
      });
    }

    api.getOwnerAutomation().then(res => {
      if (isMounted && res.data?.recentLogs) {
        setAutomationLogs(res.data.recentLogs);
      }
    }).catch(() => {
      if (isMounted) setAutomationLogs([]);
    });

    return () => {
      isMounted = false;
    };
  }, [propLogs]);

  const displayLogs = liveLogs.length > 0 ? liveLogs : automationLogs;

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
        {displayLogs.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <Clock className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-sm font-bold text-white">No Recent Activity Recorded</h3>
            <p className="text-slate-400 text-xs max-w-sm mx-auto">
              Workflow executions and agent decisions will appear here in real-time as autonomous cycles run.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayLogs.map((log: any, idx: number) => (
              <div key={log.id || `act_${idx}`} className="p-3.5 rounded-lg bg-slate-850 border border-slate-800 flex items-start gap-3 text-xs">
                <div className="p-2 rounded-lg bg-slate-800 text-cyan-400 shrink-0 mt-0.5">
                  {log.actor_type === 'USER' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100">
                        {String(log.action || log.workflow_id || 'EXECUTE_WORKFLOW').replace(/_/g, ' ')}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                        {log.actor_id || log.status || 'SYSTEM'}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {new Date(log.created_at || log.started_at || Date.now()).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="text-slate-400 text-[11px]">
                    Target: <span className="text-slate-300 font-mono">{log.entity_type || 'WORKFLOW'} ({log.entity_id || log.workflow_id || 'cron'})</span>
                  </div>

                  {(log.details || log.findings_summary) && (
                    <div className="p-2 rounded bg-slate-900/60 font-mono text-[10px] text-slate-400">
                      {typeof (log.details || log.findings_summary) === 'object' ? JSON.stringify(log.details || log.findings_summary) : String(log.findings_summary || log.details)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};