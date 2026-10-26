/**
 * MarketExperimentManager — Controlled Multi-Market Experiment Engine
 *
 * Implements Spec Phase 9:
 * - Tracks hypothesis, targets, actual leads, conversions, and explicit stop conditions for each vertical.
 * - Prevents endless unpromising outreach cycles by enforcing objective stop/pause conditions.
 * - Enforces zero synthetic data in experiment metrics.
 */

import { getDb } from '../db/client.js';

export interface MarketExperiment {
  id: string;
  experimentId: string;
  vertical: 'HEALTHCARE' | 'EDUCATION' | 'LOCAL_SERVICES' | 'B2B_COMMERCE' | 'AFFILIATE_COMMERCE';
  hypothesis: string;
  leadTarget: number;
  conversionTarget: number;
  actualLeads: number;
  actualConversions: number;
  stopCondition: string;
  status: 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'PROMOTED' | 'REVISED';
  startDate: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
}

export class MarketExperimentManager {
  private static instance: MarketExperimentManager;

  private constructor() {
    this.ensureInitialized();
  }

  public static getInstance(): MarketExperimentManager {
    if (!MarketExperimentManager.instance) {
      MarketExperimentManager.instance = new MarketExperimentManager();
    }
    return MarketExperimentManager.instance;
  }

  public ensureInitialized(): void {
    const db = getDb();
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM market_experiments').get() as { count: number };
      if (row && row.count > 0) return;
    } catch {
      return;
    }

    const experiments = [
      {
        id: 'exp_hc_triage_v4',
        experimentId: 'EXP_HEALTHCARE_APPT_TRIAGE_V4',
        vertical: 'HEALTHCARE',
        hypothesis: 'Personalized outreach to Indian dental & polyclinic practices highlighting dark-hours inquiry drop-off will generate at least 1 paid pilot (₹15,000 setup) within 20 qualified conversations.',
        leadTarget: 20,
        conversionTarget: 1,
        stopCondition: 'Pause outreach and revise value proposition if 50 owner-approved outreach attempts yield 0 positive replies or 0 booked demo walkthroughs.'
      },
      {
        id: 'exp_edu_lead_v4',
        experimentId: 'EXP_EDUCATION_LEAD_CAPTURE_V4',
        vertical: 'EDUCATION',
        hypothesis: 'Targeted outreach to test-prep coaching institutes offering instant WhatsApp brochure delivery will generate 1 paid pilot (₹12,000 setup) within 20 qualified conversations.',
        leadTarget: 20,
        conversionTarget: 1,
        stopCondition: 'Pause experiment if 50 outreach attempts yield 0 positive replies.'
      }
    ];

    for (const exp of experiments) {
      try {
        db.prepare(`
          INSERT INTO market_experiments (
            id, experiment_id, vertical, hypothesis, lead_target, conversion_target,
            actual_leads, actual_conversions, stop_condition, status, start_date, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 'ACTIVE', datetime('now'), datetime('now'), datetime('now'))
          ON CONFLICT(experiment_id) DO NOTHING;
        `).run(exp.id, exp.experimentId, exp.vertical, exp.hypothesis, exp.leadTarget, exp.conversionTarget, exp.stopCondition);
      } catch {}
    }
  }

  public listExperiments(): MarketExperiment[] {
    const db = getDb();
    try {
      const rows = db.prepare('SELECT * FROM market_experiments ORDER BY created_at ASC').all() as any[];
      return rows.map(r => ({
        id: r.id,
        experimentId: r.experiment_id,
        vertical: r.vertical,
        hypothesis: r.hypothesis,
        leadTarget: r.lead_target,
        conversionTarget: r.conversion_target,
        actualLeads: r.actual_leads,
        actualConversions: r.actual_conversions,
        stopCondition: r.stop_condition,
        status: r.status,
        startDate: r.start_date,
        endDate: r.end_date,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));
    } catch {
      return [];
    }
  }

  public recordLeadQualified(experimentId: string): void {
    const db = getDb();
    db.prepare(`
      UPDATE market_experiments
      SET actual_leads = actual_leads + 1, updated_at = datetime('now')
      WHERE experiment_id = ?
    `).run(experimentId);
  }

  public recordConversion(experimentId: string): void {
    const db = getDb();
    db.prepare(`
      UPDATE market_experiments
      SET actual_conversions = actual_conversions + 1,
          status = CASE WHEN actual_conversions + 1 >= conversion_target THEN 'PROMOTED' ELSE status END,
          updated_at = datetime('now')
      WHERE experiment_id = ?
    `).run(experimentId);
  }

  public evaluateStopCondition(experimentId: string, totalDispatches: number, positiveResponses: number): { shouldStop: boolean; reason?: string } {
    if (totalDispatches >= 50 && positiveResponses === 0) {
      const db = getDb();
      db.prepare(`
        UPDATE market_experiments
        SET status = 'STOPPED', updated_at = datetime('now')
        WHERE experiment_id = ?
      `).run(experimentId);
      return {
        shouldStop: true,
        reason: `STOP_CONDITION_MET: ${totalDispatches} dispatches reached with 0 positive responses. Experiment ${experimentId} automatically halted.`
      };
    }
    return { shouldStop: false };
  }
}
