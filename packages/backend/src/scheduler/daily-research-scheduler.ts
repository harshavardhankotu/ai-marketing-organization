import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { MarketResearchPipeline } from '../research/market-research-pipeline.js';
import { UniversalLockManager } from '../quota/universal-lock-manager.js';

export interface DailyResearchReport {
  timestamp: string;
  totalBusinessesProcessed: number;
  results: Array<{
    businessId: string;
    businessName: string;
    findingsCount: number;
    draftsCreated: number;
    status: 'COMPLETED' | 'PAUSED_QUOTA_REACHED' | 'FAILED';
    error?: string;
  }>;
  universalLockStatus: ReturnType<UniversalLockManager['getStatus']>;
}

export class DailyMarketResearchScheduler {
  private static instance: DailyMarketResearchScheduler;
  private pipeline = new MarketResearchPipeline();
  private lockManager = UniversalLockManager.getInstance();
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastReport: DailyResearchReport | null = null;

  public static getInstance(): DailyMarketResearchScheduler {
    if (!DailyMarketResearchScheduler.instance) {
      DailyMarketResearchScheduler.instance = new DailyMarketResearchScheduler();
    }
    return DailyMarketResearchScheduler.instance;
  }

  /**
   * Executes the daily market research and draft generation for all onboarded businesses.
   * STRICT SAFETY DIRECTIVE: Informational & Draft Generation Only.
   * Refuses to post, message, email, or execute any outbound communication.
   */
  public async executeDailyResearch(): Promise<DailyResearchReport> {
    if (this.isRunning) {
      throw new Error('Daily market research job is already in progress.');
    }

    this.isRunning = true;
    const db = getDb();
    const now = new Date().toISOString();
    const businesses = db.prepare('SELECT id, organization_id, name, vertical_name, city FROM businesses').all() as any[];

    const results: DailyResearchReport['results'] = [];

    try {
      for (const biz of businesses) {
        try {
          // Check universal locks before processing each tenant
          const lockStatus = this.lockManager.getStatus();
          const tavilyLocked = Boolean(lockStatus.services.TAVILY_SEARCH?.isLocked);
          const googleLocked = Boolean(lockStatus.services.GOOGLE_CUSTOM_SEARCH?.isLocked);
          const geminiLocked = Boolean(lockStatus.services.GEMINI_API?.isLocked);

          if ((tavilyLocked || googleLocked) && geminiLocked) {
            results.push({
              businessId: biz.id,
              businessName: biz.name,
              findingsCount: 0,
              draftsCreated: 0,
              status: 'PAUSED_QUOTA_REACHED',
              error: 'Daily free-tier quota exhausted. Pipeline paused by UniversalLockManager.'
            });
            break;
          }

          // 1. Run Research Pipeline (Respects Universal Lock, 48h Cache, and Audit Logging)
          const runRes = await this.pipeline.runPipeline(biz.id, biz.organization_id);

          // 2. Create Internal Drafts Only (Never Published, Zero Outbound Messaging)
          let draftsCreated = 0;
          if (runRes.status === 'COMPLETED' && runRes.findings.length > 0) {
            const draftId = `draft_${randomUUID()}`;
            const draftTitle = `Daily Market Demand Signals - ${new Date().toLocaleDateString('en-IN')}`;
            const topDemand = runRes.findings.find(f => f.category === 'DEMAND')?.summary || 'High local search volume detected';
            const draftBody = JSON.stringify({
              observations: runRes.findings.map(f => ({ category: f.category, summary: f.summary, source: f.sourceUrl })),
              generatedAt: now,
              status: 'DRAFT_FOR_OWNER_REVIEW',
              externalOutboundProhibited: true
            });

            const campRow = db.prepare("SELECT id FROM campaigns WHERE business_id = ? LIMIT 1").get(biz.id) as any;
            const campaignId = campRow?.id || 'camp_organic_seo';

            db.prepare(`
              INSERT INTO content_assets (
                id, organization_id, campaign_id, agent_id, title, channel,
                content_type, language, content, call_to_action, target_funnel_stage,
                version, status, brand_voice_score, factual_confidence, compliance_flags_json,
                created_at, updated_at
              ) VALUES (?, ?, ?, 'research_strategist', ?, 'GOOGLE_BUSINESS_PROFILE',
                'SOCIAL_POST', 'en', ?, 'Review findings in dashboard', 'TOP_OF_FUNNEL',
                1, 'DRAFT', 0.95, 0.95, '[]', datetime('now'), datetime('now'))
            `).run(
              draftId,
              biz.organization_id,
              campaignId,
              draftTitle,
              `Local market insight: ${topDemand}. Draft prepared for business owner review.`
            );
            draftsCreated = 1;
          }

          // 3. Log Informational Execution to Immutable Audit Log
          db.prepare(`
            INSERT INTO audit_logs (
              id, organization_id, entity_type, entity_id,
              actor_id, actor_type, action, details_json, created_at
            ) VALUES (?, ?, 'BUSINESS', ?, 'daily_research_scheduler', 'SYSTEM', 'SCHEDULED_DAILY_RESEARCH_REFRESH', ?, ?)
          `).run(
            `audit_${randomUUID()}`,
            biz.organization_id,
            biz.id,
            JSON.stringify({
              businessName: biz.name,
              findingsCount: runRes.findings.length,
              draftsCreated,
              status: runRes.status,
              quotaRespected: true,
              outboundCommunication: 'NONE'
            }),
            now
          );

          results.push({
            businessId: biz.id,
            businessName: biz.name,
            findingsCount: runRes.findings.length,
            draftsCreated,
            status: runRes.status,
            error: runRes.error
          });
        } catch (err: any) {
          db.prepare(`
            INSERT INTO audit_logs (
              id, organization_id, entity_type, entity_id,
              actor_id, actor_type, action, details_json, created_at
            ) VALUES (?, ?, 'BUSINESS', ?, 'daily_research_scheduler', 'SYSTEM', 'SCHEDULED_DAILY_RESEARCH_REFRESH', ?, ?)
          `).run(
            `audit_${randomUUID()}`,
            biz.organization_id,
            biz.id,
            JSON.stringify({
              businessName: biz.name,
              findingsCount: 0,
              draftsCreated: 0,
              status: 'FAILED',
              error: err.message,
              quotaRespected: true,
              outboundCommunication: 'NONE'
            }),
            now
          );

          results.push({
            businessId: biz.id,
            businessName: biz.name,
            findingsCount: 0,
            draftsCreated: 0,
            status: 'FAILED',
            error: err.message
          });
        }
      }

      const report: DailyResearchReport = {
        timestamp: now,
        totalBusinessesProcessed: businesses.length,
        results,
        universalLockStatus: this.lockManager.getStatus()
      };

      this.lastReport = report;
      return report;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Starts the background interval (24 hours).
   */
  public startScheduler(intervalMs = 24 * 60 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.executeDailyResearch().catch(err => {
        console.error('[DAILY RESEARCH SCHEDULER ERROR]:', err);
      });
    }, intervalMs);
    console.info(`[DAILY RESEARCH SCHEDULER] Active. Interval: ${intervalMs / 3600000}h.`);
  }

  public stopScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getStatus() {
    return {
      active: Boolean(this.timer),
      isRunning: this.isRunning,
      lastReport: this.lastReport,
      universalLock: this.lockManager.getStatus()
    };
  }
}
