import { Hono } from 'hono';
import { getDb } from '../db/client.js';
import { QuotaManager } from '../ai/quota-manager.js';
import { KillSwitchController } from '../control-plane/kill-switch.js';
import { ApprovalManager } from '../control-plane/approval-manager.js';
import { EventTracker } from '../analytics/event-tracker.js';
import { ExperimentEngine } from '../experiments/experiment-engine.js';
import { ClosedLoopMarketingCycle } from '../workflows/closed-loop-cycle.js';
import { CustomerJourneyTracker } from '../revenue/customer-journey-tracker.js';
import { RevenueReconciliationEngine } from '../revenue/revenue-reconciliation.js';
import { CostAccountingEngine } from '../revenue/cost-accounting.js';
import { AGENT_REGISTRY, getAgentById } from '@ai-marketing/shared';
import {
  CreateBusinessProfileSchema,
  CreateGoalSchema,
  CreateCampaignSchema,
  ApprovalActionSchema,
  IngestAnalyticsEventSchema,
  EmergencyKillSwitchSchema
} from '@ai-marketing/shared';

import { isProduction } from '../config/env.js';
import { SystemReadinessEngine } from '../control-plane/system-readiness.js';
import { googleAdsClient } from '../integrations/google-ads.js';
import { AttributionEvidenceEngine } from '../revenue/attribution-evidence.js';
import { RealEconomicsEngine } from '../revenue/real-economics.js';
import { MarketingMemoryEngine } from '../knowledge/marketing-memory.js';
import { CampaignKnowledgeGraph } from '../knowledge/knowledge-graph.js';
import { AgentScorecardEngine } from '../analytics/agent-scorecard.js';
import { AutonomyController } from '../control-plane/autonomy-controller.js';
import { FirstCustomerAutomationPipeline } from '../workflows/first-customer-automation.js';
import { OrganicChannelManager } from '../organic/organic-channel-manager.js';
import { OrganicContentEngine } from '../organic/organic-content-engine.js';
import { LocalLandingPageEngine } from '../organic/local-landing-pages.js';
import { ReviewAndReferralEngine } from '../organic/review-and-referral-engine.js';
import { GoogleBusinessProfileAdapter } from '../organic/gbp-integration.js';
import { TrafficProvenanceEngine } from '../organic/traffic-provenance.js';
import { RazorpayAdapter } from '../integrations/razorpay.js';
import { DPDPComplianceManager } from '../compliance/dpdp-manager.js';

export type AppVariables = {
  organizationId: string;
  userId: string;
};

export const apiRouter = new Hono<{ Variables: AppVariables }>();

// Middleware: Authentication & Tenant Context Boundary
apiRouter.use('*', async (c, next) => {
  const path = c.req.path;

  // 1. Public endpoints
  if (
    path.endsWith('/health') ||
    path.includes('/public/') ||
    path.includes('/webhooks/') ||
    path.includes('/payments/') ||
    path.includes('/compliance/') ||
    path.includes('/landing-pages') ||
    path.includes('/organic/sessions') ||
    path.includes('/organic/leads')
  ) {
    c.set('organizationId', c.req.header('x-organization-id') || 'org_smilekraft_01');
    c.set('userId', 'usr_public_lead');
    return await next();
  }

  const db = getDb();
  const authHeader = c.req.header('authorization') || c.req.header('Authorization');
  const apiKeyHeader = c.req.header('x-api-key');

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : apiKeyHeader?.trim();

  if (isProduction()) {
    // PRODUCTION: Authenticated principal strictly required!
    // Arbitrary client-provided identity headers (x-user-id / x-organization-id) are rejected.
    if (!token) {
      return c.json({
        success: false,
        error: 'Unauthorized: In production, an authenticated principal is required via Bearer token or x-api-key. Client identity headers alone are rejected.'
      }, 401);
    }

    const prodSecret = process.env.AUTH_SECRET || process.env.PRODUCTION_API_KEY;
    let authenticatedUser: any = null;

    if (prodSecret && token === prodSecret) {
      authenticatedUser = db.prepare("SELECT * FROM users WHERE role = 'OWNER' LIMIT 1").get();
    } else {
      try {
        authenticatedUser = db.prepare("SELECT * FROM users WHERE api_token = ?").get(token);
      } catch {}
    }

    if (!authenticatedUser) {
      return c.json({
        success: false,
        error: 'Unauthorized: Invalid authentication credentials.'
      }, 401);
    }

    c.set('userId', authenticatedUser.id);
    c.set('organizationId', authenticatedUser.organization_id);
  } else {
    // DEVELOPMENT & TEST:
    // If Bearer token is provided, authenticate with it
    if (token) {
      const prodSecret = process.env.AUTH_SECRET || process.env.PRODUCTION_API_KEY;
      let authenticatedUser: any = null;
      if (prodSecret && token === prodSecret) {
        authenticatedUser = db.prepare("SELECT * FROM users WHERE role = 'OWNER' LIMIT 1").get();
      } else {
        try {
          authenticatedUser = db.prepare("SELECT * FROM users WHERE api_token = ?").get(token);
        } catch {}
      }
      if (authenticatedUser) {
        c.set('userId', authenticatedUser.id);
        c.set('organizationId', authenticatedUser.organization_id);
        return await next();
      }
    }

    // In dev/test: allow explicit identity headers for testing fixtures, defaulting to dev owner
    c.set('organizationId', c.req.header('x-organization-id') || 'org_smilekraft_01');
    c.set('userId', c.req.header('x-user-id') || 'usr_owner_01');
  }

  await next();
});

// Health check
apiRouter.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'AI Marketing Organization Engine'
  });
});

// Quota & Free Tier Observability
apiRouter.get('/quota', (c) => {
  const status = QuotaManager.getInstance().getStatus();
  return c.json({ success: true, data: status });
});

// 80 Agents Registry
apiRouter.get('/agents', (c) => {
  const db = getDb();
  const dbAgents = db.prepare('SELECT * FROM agents').all() as any[];

  // Merge runtime DB stats with catalog
  const agents = AGENT_REGISTRY.map(catalogAgent => {
    const fromDb = dbAgents.find(d => d.id === catalogAgent.id);
    return {
      ...catalogAgent,
      status: fromDb?.status || catalogAgent.status,
      version: fromDb?.version || catalogAgent.version
    };
  });

  return c.json({ success: true, data: agents, total: agents.length });
});

apiRouter.get('/agents/:id', (c) => {
  const id = c.req.param('id');
  const agent = getAgentById(id);
  if (!agent) return c.json({ success: false, error: 'Agent not found' }, 404);

  const db = getDb();
  const dbAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any;
  return c.json({
    success: true,
    data: { ...agent, ...dbAgent }
  });
});

// Business Profile
apiRouter.get('/business', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT * FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  return c.json({
    success: true,
    data: {
      ...business,
      offerings: JSON.parse(business.offerings_json || '[]'),
      valuePropositions: JSON.parse(business.value_propositions_json || '[]'),
      secondaryLanguages: JSON.parse(business.secondary_languages_json || '[]'),
      constraints: JSON.parse(business.constraints_json || '{}')
    }
  });
});

apiRouter.post('/business', async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json();
  const parsed = CreateBusinessProfileSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, errors: parsed.error.errors }, 400);
  }

  const data = parsed.data;
  const db = getDb();
  const businessId = `biz_${Date.now()}`;

  db.prepare(`
    INSERT INTO businesses (
      id, organization_id, name, vertical_id, vertical_name,
      country, currency, timezone, city, neighborhood,
      website_url, phone, primary_language, secondary_languages_json,
      brand_voice, value_propositions_json, offerings_json, constraints_json,
      autonomy_mode, kill_switch_active
    ) VALUES (?, ?, ?, ?, ?, 'IN', 'INR', 'Asia/Kolkata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    businessId, orgId, data.name, data.verticalId, data.verticalName,
    data.city, data.neighborhood, data.websiteUrl || null, data.phone || null,
    data.primaryLanguage, JSON.stringify(data.secondaryLanguages),
    data.brandVoice, JSON.stringify(data.valuePropositions), JSON.stringify(data.offerings),
    JSON.stringify({ monthlyBudgetINR: data.monthlyBudgetINR }),
    data.autonomyMode
  );

  return c.json({ success: true, data: { id: businessId } });
});

// Goals
apiRouter.get('/goals', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const goals = db.prepare('SELECT * FROM business_goals WHERE organization_id = ?').all(orgId) as any[];

  return c.json({
    success: true,
    data: goals.map(g => ({
      ...g,
      kpis: JSON.parse(g.kpis_json || '[]')
    }))
  });
});

apiRouter.post('/goals', async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json();
  const parsed = CreateGoalSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, errors: parsed.error.errors }, 400);

  const d = parsed.data;
  const db = getDb();
  const goalId = `goal_${Date.now()}`;

  db.prepare(`
    INSERT INTO business_goals (
      id, organization_id, business_id, title, target_metric,
      target_value, current_value, metric_unit, timeframe_days,
      start_date, target_date, budget_allocated_inr, status, kpis_json
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, date('now'), date('now', '+' || ? || ' days'), ?, 'ACTIVE', '[]')
  `).run(goalId, orgId, d.businessId, d.title, d.targetMetric, d.targetValue, d.metricUnit, d.timeframeDays, d.timeframeDays, d.budgetAllocatedINR);

  return c.json({ success: true, data: { id: goalId } });
});

// Closed-Loop Autonomous Marketing Cycle Trigger
apiRouter.post('/workflows/trigger-cycle', async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';
  const goalId = body.goalId || 'goal_100_leads_hyd';

  const cycle = new ClosedLoopMarketingCycle();
  const result = await cycle.executeCompleteCycle({
    organizationId: orgId,
    businessId,
    goalId
  });

  return c.json({
    success: true,
    message: 'Closed loop marketing cycle successfully executed across research, strategy, campaign, content, telemetry, experiments, and evolution.',
    data: result
  });
});

// Campaigns
apiRouter.get('/campaigns', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const campaigns = db.prepare('SELECT * FROM campaigns WHERE organization_id = ? ORDER BY created_at DESC').all(orgId) as any[];

  return c.json({
    success: true,
    data: campaigns.map(cmp => ({
      ...cmp,
      channels: JSON.parse(cmp.channels_json || '[]'),
      geography: JSON.parse(cmp.geography_json || '{}')
    }))
  });
});

// Content Assets
apiRouter.get('/content', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const content = db.prepare('SELECT * FROM content_assets WHERE organization_id = ? ORDER BY created_at DESC').all(orgId) as any[];

  return c.json({
    success: true,
    data: content.map(cnt => ({
      ...cnt,
      complianceFlags: JSON.parse(cnt.compliance_flags_json || '[]'),
      performance: JSON.parse(cnt.performance_json || '{}')
    }))
  });
});

// Research Findings
apiRouter.get('/research', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const findings = db.prepare('SELECT * FROM research_findings WHERE organization_id = ? ORDER BY created_at DESC').all(orgId);
  return c.json({ success: true, data: findings });
});

// Analytics & Dashboard KPIs
apiRouter.get('/analytics/dashboard', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const biz = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = biz?.id || 'biz_smilekraft_hyd';

  const metrics = EventTracker.getDashboardMetrics(businessId);
  const events = db.prepare('SELECT * FROM analytics_events WHERE business_id = ? ORDER BY created_at DESC LIMIT 50').all(businessId);
  const attributions = db.prepare('SELECT * FROM attributions WHERE business_id = ? ORDER BY created_at DESC LIMIT 50').all(businessId);

  return c.json({
    success: true,
    data: {
      metrics,
      events,
      attributions
    }
  });
});

// Experiments
apiRouter.get('/experiments', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const experiments = db.prepare('SELECT * FROM experiments WHERE organization_id = ? ORDER BY created_at DESC').all(orgId) as any[];

  return c.json({
    success: true,
    data: experiments.map(e => ({
      ...e,
      metrics: JSON.parse(e.metrics_json || '{}')
    }))
  });
});

apiRouter.post('/experiments', async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  const id = ExperimentEngine.createExperiment({
    organizationId: orgId,
    businessId,
    campaignId: body.campaignId,
    title: body.title || 'Hyderabad Clear Aligners Acquisition Experiment',
    hypothesis: body.hypothesis || 'Targeted local high-intent clear aligners search in Banjara Hills & Gachibowli drives genuine consultations',
    baseline: body.baseline || 'Standard Dental Clinic Services Page',
    treatment: body.treatment || 'Dedicated Clear Aligners Hyderabad Landing Page with WhatsApp Booking Funnel',
    successMetric: body.successMetric || 'verified_consultations',
    expectedEffect: body.expectedEffect || '+25% consultation bookings with CAC <= ₹2,500',
    minimumEvidenceRequirement: body.minimumEvidenceRequirement || 25
  });

  return c.json({ success: true, data: { experimentId: id, status: 'RUNNING' } }, 201);
});

// Evolution, Learnings & Decision Journal
apiRouter.get('/evolution', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();

  const strategies = db.prepare('SELECT * FROM strategies WHERE organization_id = ? ORDER BY version DESC').all(orgId) as any[];
  const learnings = db.prepare('SELECT * FROM learnings WHERE organization_id = ? ORDER BY created_at DESC').all(orgId);
  const decisions = db.prepare('SELECT * FROM decisions WHERE organization_id = ? ORDER BY created_at DESC').all(orgId);

  return c.json({
    success: true,
    data: {
      strategies: strategies.map(s => ({
        ...s,
        channelStrategy: JSON.parse(s.channel_strategy_json || '[]'),
        contentThemes: JSON.parse(s.content_themes_json || '[]')
      })),
      learnings,
      decisions
    }
  });
});

// Human Approval Requests
apiRouter.get('/approvals', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const requests = db.prepare('SELECT * FROM approval_requests WHERE organization_id = ? ORDER BY created_at DESC').all(orgId) as any[];

  return c.json({
    success: true,
    data: requests.map(r => ({
      ...r,
      riskFactors: JSON.parse(r.risk_factors_json || '[]')
    }))
  });
});

apiRouter.post('/approvals/resolve', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const parsed = ApprovalActionSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, errors: parsed.error.errors }, 400);

  ApprovalManager.resolveApproval(parsed.data.requestId, parsed.data.action, userId, parsed.data.feedbackNotes);
  return c.json({ success: true, message: `Request successfully resolved as ${parsed.data.action}` });
});

// Global Emergency Kill Switch
apiRouter.post('/kill-switch', async (c) => {
  const orgId = c.get('organizationId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const parsed = EmergencyKillSwitchSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, errors: parsed.error.errors }, 400);

  if (parsed.data.active) {
    KillSwitchController.trigger(parsed.data.businessId, orgId, userId, parsed.data.reason);
  } else {
    KillSwitchController.reset(parsed.data.businessId, orgId, userId, parsed.data.reason);
  }

  return c.json({
    success: true,
    message: parsed.data.active ? 'Emergency Kill Switch ENGAGED' : 'Emergency Kill Switch RESET',
    killSwitchActive: parsed.data.active
  });
});

// Integrations
apiRouter.get('/integrations', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const integrations = db.prepare('SELECT * FROM integrations WHERE organization_id = ?').all(orgId) as any[];

  return c.json({
    success: true,
    data: integrations.map(int => ({
      ...int,
      credentialsMeta: JSON.parse(int.credentials_meta_json || '{}')
    }))
  });
});

// Activity Stream & Audit Trail
apiRouter.get('/activity', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const logs = db.prepare('SELECT * FROM audit_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100').all(orgId) as any[];

  return c.json({
    success: true,
    data: logs.map(l => ({
      ...l,
      details: JSON.parse(l.details_json || '{}')
    }))
  });
});

// ==========================================
// REVENUE & ATTRIBUTION RECONCILIATION
// ==========================================
const revenueEngine = new RevenueReconciliationEngine();
const journeyTracker = new CustomerJourneyTracker();
const costAccounting = new CostAccountingEngine();
const attributionEvidence = new AttributionEvidenceEngine();
const realEconomics = new RealEconomicsEngine();
const marketingMemory = new MarketingMemoryEngine();
const campaignKnowledgeGraph = new CampaignKnowledgeGraph();
const agentScorecards = new AgentScorecardEngine();
const autonomyController = new AutonomyController();
const firstCustomerPipeline = new FirstCustomerAutomationPipeline();
const razorpayAdapter = new RazorpayAdapter();
const dpdpManager = new DPDPComplianceManager();
const publicRateLimitMap = new Map<string, number[]>();

apiRouter.get('/revenue/summary', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const summary = revenueEngine.getRevenueSummary(business.id);
  return c.json({ success: true, data: summary });
});

apiRouter.get('/revenue/transactions', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const classification = c.req.query('classification') as any;
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;

  const transactions = revenueEngine.listTransactions(business.id, { classification, limit });
  return c.json({ success: true, data: transactions, total: transactions.length });
});

apiRouter.post('/revenue/transactions', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const body = await c.req.json();
  if (!body.invoiceNumber || !body.amountINR || !body.paymentMethod) {
    return c.json({ success: false, error: 'Missing required transaction fields: invoiceNumber, amountINR, paymentMethod' }, 400);
  }

  try {
    const tx = revenueEngine.recordTransaction({
      businessId: business.id,
      organizationId: orgId,
      journeyId: body.journeyId,
      campaignId: body.campaignId,
      invoiceNumber: body.invoiceNumber,
      amountINR: body.amountINR,
      paymentMethod: body.paymentMethod,
      paymentGateway: body.paymentGateway,
      transactionRef: body.transactionRef,
      status: body.status,
      classification: body.classification || 'TEST',
      serviceRendered: body.serviceRendered,
    });

    return c.json({ success: true, data: tx }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// ==========================================
// CUSTOMER JOURNEY TRACKING & FUNNEL
// ==========================================
apiRouter.get('/customer-journeys', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const classification = c.req.query('classification') as any;
  const stage = c.req.query('stage') as any;
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 50;

  const funnel = journeyTracker.getJourneyFunnel(business.id, classification);
  const journeys = journeyTracker.listJourneys(business.id, { classification, stage, limit });

  return c.json({
    success: true,
    data: {
      funnel,
      journeys,
      total: journeys.length
    }
  });
});

apiRouter.post('/customer-journeys/touchpoint', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const body = await c.req.json();
  if (!body.visitorId || !body.channel || !body.event) {
    return c.json({ success: false, error: 'Missing required touchpoint fields: visitorId, channel, event' }, 400);
  }

  const updatedJourney = journeyTracker.recordTouchpoint({
    businessId: business.id,
    organizationId: orgId,
    visitorId: body.visitorId,
    channel: body.channel,
    event: body.event,
    campaignId: body.campaignId,
    metadata: body.metadata,
    classification: body.classification || 'TEST',
  });

  return c.json({ success: true, data: updatedJourney });
});

apiRouter.post('/customer-journeys/advance', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const body = await c.req.json();
  if (!body.visitorId || !body.targetStage) {
    return c.json({ success: false, error: 'Missing required fields: visitorId, targetStage' }, 400);
  }

  const updatedJourney = journeyTracker.advanceStage({
    businessId: business.id,
    visitorId: body.visitorId,
    targetStage: body.targetStage,
    customerName: body.customerName,
    customerPhone: body.customerPhone,
    customerEmail: body.customerEmail,
    classification: body.classification || 'TEST',
  });

  return c.json({ success: true, data: updatedJourney });
});

// ==========================================
// APPOINTMENTS & IN-CLINIC CONSULTATIONS
// ==========================================
apiRouter.get('/appointments', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const appointments = db.prepare(`
    SELECT * FROM appointments WHERE business_id = ? ORDER BY appointment_date DESC
  `).all(business.id) as any[];

  return c.json({
    success: true,
    data: appointments.map((a) => ({
      id: a.id,
      businessId: a.business_id,
      organizationId: a.organization_id || orgId,
      journeyId: a.journey_id,
      patientName: a.patient_name,
      clinicLocation: a.clinic_location,
      scheduledAt: a.appointment_date,
      appointmentDate: a.appointment_date,
      service: a.service,
      status: a.clinic_confirmation,
      clinicConfirmation: a.clinic_confirmation,
      confirmationTimestamp: a.confirmation_timestamp,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    })),
  });
});

// ==========================================
// GOOGLE ADS ATTRIBUTION & RECONCILIATION
// ==========================================
apiRouter.post('/google-ads/reconcile', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const body = await c.req.json();
  const result = await googleAdsClient.reconcileLeadAttribution({
    gclid: body.gclid,
    campaignId: body.campaignId,
    keyword: body.keyword,
    clickDate: body.clickDate,
  });

  // If journeyId is provided, update the journey's attribution_status
  if (body.journeyId) {
    db.prepare(`
      UPDATE customer_journeys
      SET attribution_status = ?, gclid = COALESCE(?, gclid), updated_at = ?
      WHERE id = ?
    `).run(result.status, result.gclid || null, new Date().toISOString(), body.journeyId);
  }

  return c.json({
    success: true,
    data: result,
  });
});

// ==========================================
// AI COST OBSERVABILITY & TOKEN ACCOUNTING
// ==========================================
apiRouter.get('/ai-costs', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const summary = costAccounting.getCostSummary(business.id);
  const recentLogs = costAccounting.listCostLogs(business.id, 50);

  return c.json({
    success: true,
    data: {
      summary,
      recentLogs
    }
  });
});

apiRouter.post('/ai-costs/log', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const body = await c.req.json();
  const log = costAccounting.logCost({
    organizationId: orgId,
    businessId: business.id,
    agentId: body.agentId,
    division: body.division,
    model: body.model || 'gemini-3.8-flash',
    thinkingLevel: body.thinkingLevel || 'none',
    inputTokens: body.inputTokens || 0,
    outputTokens: body.outputTokens || 0,
    latencyMs: body.latencyMs || 0,
    purpose: body.purpose || 'Agent task execution',
  });

  return c.json({ success: true, data: log }, 201);
});

// ==========================================
// ==========================================
// REAL LEAD CAPTURE & PUBLIC BOOKING API
// ==========================================
apiRouter.post('/public/lead', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';
  const orgId = body.organizationId || 'org_smilekraft_01';

  // 1. Anti-Bot Honeypot Defense: Silently absorb scrapers
  if (body.website_url_hp || body.bot_trap) {
    return c.json({
      success: true,
      message: 'Consultation request received successfully.',
      data: { leadId: 'lead_hp_bot', status: 'FILTERED', clinic: 'SmileKraft Dental Clinic' }
    }, 200);
  }

  // 2. Sliding-Window Rate Limiter (Max 10 requests per 10 mins per IP)
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || '127.0.0.1';
  const nowMs = Date.now();
  const timestamps = (publicRateLimitMap.get(clientIp) || []).filter(t => nowMs - t < 10 * 60 * 1000);
  if (timestamps.length >= 10) {
    return c.json({
      success: false,
      error: 'Rate limit exceeded: Too many consultation requests from this network. Please wait a few minutes or contact the clinic directly via phone.'
    }, 429);
  }
  timestamps.push(nowMs);
  publicRateLimitMap.set(clientIp, timestamps);

  if (!body.customerName || !body.customerPhone) {
    return c.json({ success: false, error: 'Full name and mobile phone number are required' }, 400);
  }

  // Validate Indian Phone format (10+ digits)
  const cleanPhone = body.customerPhone.replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    return c.json({ success: false, error: 'Invalid phone number. Must be a valid 10-digit mobile number' }, 400);
  }

  // Check test mode headers or explicit classification
  const testHeader = c.req.header('x-test-mode');
  const forcedClassification = (testHeader === 'true' || testHeader === '1') ? 'TEST' : body.classification;

  const journey = journeyTracker.recordRealLead({
    businessId,
    organizationId: orgId,
    customerName: body.customerName.trim(),
    customerPhone: body.customerPhone.trim(),
    customerEmail: body.customerEmail ? body.customerEmail.trim() : undefined,
    channel: body.channel || 'WHATSAPP',
    campaignId: body.campaignId || 'camp_seed_aligners_01',
    source: body.source || 'public_landing_page',
    serviceOfInterest: body.serviceOfInterest || 'Invisible Clear Aligners',
    notes: body.notes,
    classification: forcedClassification,
    utmSource: body.utmSource,
    utmMedium: body.utmMedium,
    utmCampaign: body.utmCampaign,
    utmTerm: body.utmTerm,
    utmContent: body.utmContent,
    sessionId: body.sessionId,
    gclid: body.gclid,
  });

  // DPDP Act 2023: Record digital patient consent
  if (body.dpdpConsentGiven || body.consentGiven) {
    dpdpManager.recordConsent({
      businessId,
      journeyId: journey.id,
      customerName: body.customerName.trim(),
      customerPhone: body.customerPhone.trim(),
      ipAddress: clientIp,
      purpose: 'Direct dental consultation coordination and orthodontic treatment assessment at SmileKraft Dental Clinic',
      consentVersion: body.consentVersion || '2026.1',
    });
  }

  const leadId = `lead_${journey.id.replace('journey-', '')}`;
  const resolvedSessionId = body.sessionId || `sess_${journey.visitorId.slice(-8)}`;

  return c.json({
    success: true,
    message: 'Consultation request received successfully. Our clinic team will reach out via WhatsApp.',
    data: {
      campaignId: body.campaignId || 'camp_seed_aligners_01',
      utmSource: body.utmSource || null,
      utmMedium: body.utmMedium || null,
      utmCampaign: body.utmCampaign || null,
      utmTerm: body.utmTerm || null,
      utmContent: body.utmContent || null,
      gclid: journey.gclid || body.gclid || null,
      attributionStatus: journey.attributionStatus || 'UNVERIFIED',
      visitorId: journey.visitorId,
      sessionId: resolvedSessionId,
      leadId,
      journeyId: journey.id,
      stage: journey.stage,
      classification: journey.classification,
      dpdpConsentCaptured: Boolean(body.dpdpConsentGiven || body.consentGiven),
      clinic: 'SmileKraft Dental Clinic Banjara Hills & Gachibowli'
    }
  }, 201);
});

// ==========================================
// AUTOMATED RAZORPAY PAYMENT GATEWAY & WEBHOOKS
// ==========================================

apiRouter.post('/payments/razorpay/create-order', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  if (!body.amountINR || body.amountINR <= 0) {
    return c.json({ success: false, error: 'Valid amount in INR is required' }, 400);
  }

  try {
    const order = await razorpayAdapter.createPaymentOrder({
      businessId,
      journeyId: body.journeyId,
      amountINR: body.amountINR,
      receipt: body.receipt || `rcpt_${Date.now()}`,
      notes: {
        business_id: businessId,
        journey_id: body.journeyId || '',
        service: body.service || 'SmileKraft Dental Procedure',
        invoice_number: body.invoiceNumber || `INV-SK-${Date.now()}`
      }
    });

    return c.json({ success: true, data: order }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

apiRouter.post('/webhooks/razorpay', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-razorpay-signature') || '';

  if (!signature) {
    return c.json({ success: false, error: 'Missing x-razorpay-signature header' }, 400);
  }

  let eventPayload: any;
  try {
    eventPayload = JSON.parse(rawBody);
  } catch {
    return c.json({ success: false, error: 'Invalid JSON payload' }, 400);
  }

  try {
    const result = await razorpayAdapter.processWebhook({
      rawBody,
      signature,
      event: eventPayload
    });

    return c.json({ success: true, data: result }, 200);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// ==========================================
// DPDP ACT 2023 COMPLIANCE & PRIVACY RIGHTS
// ==========================================

apiRouter.post('/compliance/dpdp/consent', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  if (!body.customerName || !body.purpose) {
    return c.json({ success: false, error: 'Customer name and explicit purpose are required' }, 400);
  }

  const clientIp = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || '127.0.0.1';
  const consent = dpdpManager.recordConsent({
    businessId,
    journeyId: body.journeyId,
    customerName: body.customerName,
    customerPhone: body.customerPhone,
    ipAddress: clientIp,
    purpose: body.purpose,
    consentVersion: body.consentVersion || '2026.1'
  });

  return c.json({ success: true, data: consent }, 201);
});

apiRouter.post('/compliance/dpdp/erasure', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  if (!body.phoneOrJourneyId) {
    return c.json({ success: false, error: 'Phone number or Journey ID required for Section 12 erasure request' }, 400);
  }

  const result = dpdpManager.requestErasure({
    businessId,
    phoneOrJourneyId: body.phoneOrJourneyId,
    reason: body.reason || 'Patient consent withdrawal'
  });

  return c.json({ success: true, data: result }, 200);
});

apiRouter.get('/compliance/dpdp/status/:identifier', (c) => {
  const identifier = c.req.param('identifier');
  const consent = dpdpManager.getConsent(identifier);

  if (!consent) {
    return c.json({ success: false, error: 'Consent record not found' }, 404);
  }

  return c.json({ success: true, data: consent });
});

// ==========================================
// VERIFIED MANUAL REVENUE ENTRY (AUDITED)
// ==========================================
apiRouter.post('/revenue/verified-entry', async (c) => {
  const orgId = c.get('organizationId');
  const userId = c.get('userId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  // Single Trusted Authority Enforcement: Caller must be authenticated clinic OWNER
  const user = db.prepare('SELECT id, role FROM users WHERE id = ? AND organization_id = ?').get(userId, orgId) as any;
  if (!user || user.role !== 'OWNER') {
    return c.json({
      success: false,
      error: `Forbidden: Only an authenticated clinic OWNER can certify REAL revenue. Actor '${userId}' is not an OWNER.`
    }, 403);
  }

  const body = await c.req.json();
  if (!body.invoiceNumber || !body.amountINR || !body.paymentMethod || !body.transactionRef || !body.verificationSource) {
    return c.json({
      success: false,
      error: 'Missing required audit fields: invoiceNumber, amountINR, paymentMethod, transactionRef, verificationSource'
    }, 400);
  }

  try {
    const tx = revenueEngine.recordVerifiedManualRevenue({
      businessId: business.id,
      organizationId: orgId,
      verifiedByUserId: userId,
      invoiceNumber: body.invoiceNumber,
      amountINR: body.amountINR,
      paymentMethod: body.paymentMethod,
      transactionRef: body.transactionRef,
      verificationSource: body.verificationSource,
      journeyId: body.journeyId,
      campaignId: body.campaignId,
      serviceRendered: body.serviceRendered || 'Verified In-Clinic Treatment',
    });

    return c.json({ success: true, data: tx }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// ==========================================
// REVENUE REFUND & CANCELLATION HANDLER
// ==========================================
apiRouter.post('/revenue/refund', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  if (!business) return c.json({ success: false, error: 'Business not found' }, 404);

  const body = await c.req.json();
  if (!body.transactionId || !body.reason) {
    return c.json({ success: false, error: 'transactionId and reason are required' }, 400);
  }

  try {
    const refundedTx = revenueEngine.refundTransaction(business.id, body.transactionId, body.reason);
    return c.json({ success: true, data: refundedTx });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// ==========================================
// PAYMENT WEBHOOKS (IDEMPOTENT INGESTION)
// ==========================================
apiRouter.post('/webhooks/payments/:gateway', async (c) => {
  const gateway = c.req.param('gateway').toUpperCase() as any;
  const payload = await c.req.json();

  // Basic validation of webhook body
  const invoiceNumber = payload.invoice_number || payload.order_id || `INV-WH-${Date.now()}`;
  const amountINR = payload.amount || payload.payment?.amount || 0;
  const transactionRef = payload.payment_id || payload.transaction_id || `ref-${Date.now()}`;
  const businessId = payload.business_id || 'biz_smilekraft_hyd';
  const orgId = payload.organization_id || 'org_smilekraft_01';

  try {
    const tx = revenueEngine.recordTransaction({
      businessId,
      organizationId: orgId,
      journeyId: payload.journey_id,
      campaignId: payload.campaign_id,
      invoiceNumber,
      amountINR,
      paymentMethod: payload.payment_method || 'UPI',
      paymentGateway: gateway,
      transactionRef,
      status: 'SUCCESS',
      classification: payload.test_mode ? 'TEST' : 'REAL',
      serviceRendered: payload.notes?.service || 'Online Payment Gateway Checkout',
    });

    return c.json({ success: true, received: true, transactionId: tx.id });
  } catch (err: any) {
    // Return 200 on duplicate to prevent webhook retry storms, but report status
    return c.json({ success: false, duplicate: true, error: err.message }, 200);
  }
});

// ==========================================
// SYSTEM OPERATIONAL READINESS REPORT
// ==========================================
apiRouter.get('/system/readiness', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const report = SystemReadinessEngine.evaluateReadiness(businessId);
  return c.json({ success: true, data: report });
});

// ==========================================
// WORKFLOW TRIGGER: CLOSED LOOP CYCLE
// ==========================================
apiRouter.post('/workflows/trigger-cycle', async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';
  const goalId = body.goalId || 'goal_100_leads_hyd';

  const cycle = new ClosedLoopMarketingCycle();
  try {
    const result = await cycle.executeCompleteCycle({
      organizationId: orgId,
      businessId,
      goalId
    });
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// ATTRIBUTION EVIDENCE & PROVENANCE (GCLID-FIRST)
// ==========================================
apiRouter.get('/attribution/evidence/:journeyId', (c) => {
  const journeyId = c.req.param('journeyId');
  const evidence = attributionEvidence.getEvidenceForJourney(journeyId);
  const evaluation = attributionEvidence.evaluateAttribution(evidence);
  return c.json({ success: true, data: { evidence, evaluation } });
});

// ==========================================
// REAL ECONOMICS ENGINE
// ==========================================
apiRouter.get('/economics/summary', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const summary = realEconomics.calculate(businessId);
  return c.json({ success: true, data: summary });
});

// ==========================================
// AUTONOMY CONTROLLER & GOVERNANCE
// ==========================================
apiRouter.get('/autonomy/status', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const policy = autonomyController.getBudgetPolicy(businessId);
  return c.json({ success: true, data: policy });
});

apiRouter.post('/autonomy/mode', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const body = await c.req.json();
  const result = autonomyController.setOperatingMode(businessId, body.mode);
  if (!result.success) {
    return c.json({ success: false, error: result.rationale }, 403);
  }
  return c.json({ success: true, data: result });
});

apiRouter.get('/autonomy/proposals', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const proposals = autonomyController.generateOptimizationProposals(businessId);
  return c.json({ success: true, data: proposals, total: proposals.length });
});

apiRouter.get('/autonomy/experiments', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const candidates = autonomyController.generateExperimentCandidates(businessId);
  return c.json({ success: true, data: candidates, total: candidates.length });
});

apiRouter.get('/autonomy/stop-conditions', (c) => {
  const events = autonomyController.listStopConditions();
  return c.json({ success: true, data: events, total: events.length });
});

apiRouter.post('/autonomy/stop-conditions', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const body = await c.req.json();
  const event = autonomyController.triggerStopCondition(
    businessId,
    body.condition,
    body.details || 'System or operator triggered stop condition'
  );
  return c.json({ success: true, data: event }, 201);
});

// ==========================================
// AGENT SCORECARDS & PREDICTIONS
// ==========================================
apiRouter.get('/agent-scorecards', (c) => {
  const cards = agentScorecards.listScorecards();
  return c.json({ success: true, data: cards, total: cards.length });
});

// ==========================================
// MARKETING MEMORY
// ==========================================
apiRouter.get('/marketing-memory', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const dimension = c.req.query('dimension') as any;
  const memories = marketingMemory.listMemories(businessId, dimension);
  return c.json({ success: true, data: memories, total: memories.length });
});

apiRouter.post('/marketing-memory', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const body = await c.req.json();
  const mem = marketingMemory.recordMemory({
    businessId,
    dimension: body.dimension,
    key: body.key,
    insight: body.insight,
    evidenceReference: body.evidenceReference,
    sourceType: body.sourceType || 'REAL_INTERNAL_DATA',
    confidence: body.confidence,
  });
  return c.json({ success: true, data: mem }, 201);
});

// ==========================================
// CAMPAIGN KNOWLEDGE GRAPH
// ==========================================
apiRouter.get('/knowledge-graph', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  campaignKnowledgeGraph.syncFromLiveEntities(businessId);
  const graph = campaignKnowledgeGraph.getGraph();
  return c.json({ success: true, data: graph });
});

// ==========================================
// IMMUTABLE TRUTH EVENTS & EVENT SOURCING
// ==========================================
apiRouter.get('/truth/events', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const journeyId = c.req.query('journeyId');
  const events = revenueEngine.listImmutableTruthEvents(businessId, journeyId);
  return c.json({ success: true, data: events, total: events.length });
});

// ==========================================
// TREATMENT PLANS (QUOTES VS PAYMENTS)
// ==========================================
apiRouter.get('/treatment-plans/:journeyId', (c) => {
  const journeyId = c.req.param('journeyId');
  const plans = revenueEngine.getTreatmentPlans(journeyId);
  return c.json({ success: true, data: plans, total: plans.length });
});

apiRouter.post('/treatment-plans', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const body = await c.req.json();

  if (!body.journeyId || !body.service || !body.quotedAmountINR || !body.doctorNotes) {
    return c.json({
      success: false,
      error: 'Missing required treatment plan fields: journeyId, service, quotedAmountINR, doctorNotes',
    }, 400);
  }

  try {
    const plan = revenueEngine.recordTreatmentPlan({
      businessId,
      journeyId: body.journeyId,
      service: body.service,
      quotedAmountINR: body.quotedAmountINR,
      acceptedTreatmentAmountINR: body.acceptedTreatmentAmountINR,
      doctorNotes: body.doctorNotes,
      clinicConfirmation: body.clinicConfirmation || 'CONFIRMED',
      confirmationSource: body.confirmationSource || 'CLINIC_CONSULTATION',
      status: body.status || 'ACCEPTED',
    });
    return c.json({ success: true, data: plan }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// ==========================================
// CAMPAIGN OPTIMIZATION & AUTONOMY
// ==========================================
apiRouter.post('/campaigns/optimize', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const body = await c.req.json();

  if (!body.evidence || body.evidence.trim().length === 0) {
    return c.json({
      success: false,
      error: 'EVIDENCE GATE REJECTION: Cannot execute optimization without verifiable external evidence.',
    }, 400);
  }

  const proposal = {
    id: body.id || `opt-${Date.now()}`,
    businessId,
    agentId: body.agentId || 'agt_paid_search_01',
    actionType: body.actionType || 'INCREASE_KEYWORD',
    targetEntityId: body.targetEntityId || 'kw-invisalign-banjara-hills',
    evidence: body.evidence,
    reason: body.reason || 'Evidence-gated campaign adjustment',
    confidence: body.confidence ?? 0.85,
    expectedImpact: body.expectedImpact || 'Optimized ROI',
    budgetImpactINR: body.budgetImpactINR ?? 1500,
    risk: body.risk || 'LOW',
    approvalStatus: 'PROPOSED' as const,
    createdAt: new Date().toISOString(),
  };

  const result = autonomyController.executeOptimizationProposal(businessId, proposal);
  if (!result.success) {
    return c.json({ success: false, error: result.rationale }, 403);
  }
  return c.json({ success: true, data: result });
});

apiRouter.post('/autonomy/kill-switch', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const body = await c.req.json();
  const reason = body.reason || 'Manual emergency kill switch triggered by operator';
  autonomyController.activateKillSwitch(businessId, reason);
  return c.json({ success: true, message: 'Kill switch activated. All autonomous actions halted.', reason });
});

// ==========================================
// WORKFLOW: FIRST CUSTOMER AUTOMATION
// ==========================================
apiRouter.post('/workflows/first-customer', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const body = await c.req.json();
  const result = await firstCustomerPipeline.executePipeline({
    businessId,
    journeyId: body.journeyId,
    appointmentId: body.appointmentId,
    invoiceNumber: body.invoiceNumber,
    quotedAmountINR: body.quotedAmountINR,
    paidAmountINR: body.paidAmountINR,
    amountINR: body.amountINR,
    paymentMethod: body.paymentMethod,
    transactionRef: body.transactionRef,
    verificationSource: body.verificationSource,
    serviceRendered: body.serviceRendered,
    doctorNotes: body.doctorNotes,
    dryRun: body.dryRun ?? true,
    idempotencyKey: body.idempotencyKey,
  });
  return c.json({ success: true, data: result });
});

// ==========================================
// CLINICAL CONFIRMATION / ACCEPTANCE HELPER
// ==========================================
apiRouter.post('/clinic/confirm-treatment-acceptance', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = business?.id || 'biz_smilekraft_hyd';
  const body = await c.req.json();

  if (!body.journeyId || !body.doctorNotes || !body.serviceRendered) {
    return c.json({ success: false, error: 'Missing required clinical acceptance fields: journeyId, doctorNotes, serviceRendered' }, 400);
  }

  marketingMemory.recordMemory({
    businessId,
    dimension: 'CLINICAL_OUTCOME' as any,
    key: `acceptance-${body.journeyId}`,
    insight: `Patient treatment plan accepted: ${body.serviceRendered}. Notes: ${body.doctorNotes}`,
    evidenceReference: body.journeyId,
    sourceType: 'REAL_INTERNAL_DATA',
    confidence: 0.95,
  });

  return c.json({
    success: true,
    message: 'Treatment acceptance verified and recorded in clinical audit log.',
    data: {
      journeyId: body.journeyId,
      serviceRendered: body.serviceRendered,
      notes: body.doctorNotes,
    }
  });
});

// ==========================================
// GOOGLE ADS 2026 STATUS OBSERVABILITY
// ==========================================
apiRouter.get('/google-ads/status', async (c) => {
  const accessLevel = googleAdsClient.getAccessLevel();
  const authStatus = await googleAdsClient.getAuthStatus();
  const accountStatus = await googleAdsClient.getAccountStatus();
  const isConfigured = googleAdsClient.isConfigured();
  const customerId = googleAdsClient.getCustomerId();

  return c.json({
    success: true,
    data: {
      googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT_ID || process.env.GOOGLE_ADS_PROJECT_ID || 'NONE',
      customerId,
      accessLevel,
      authStatus,
      accountStatus,
      isConfigured,
      modernOAuth2026Model: true,
      developerTokenPreservedAsTransitionHeaderOnly: true,
    }
  });
});

// ==========================================
// ZERO-BUDGET ORGANIC GROWTH ENDPOINTS
// ==========================================
const organicChannels = new OrganicChannelManager();
const organicContent = new OrganicContentEngine();
const landingPages = new LocalLandingPageEngine();
const reviewReferral = new ReviewAndReferralEngine();
const gbpAdapter = new GoogleBusinessProfileAdapter();

// 1. Organic Channels Portfolio
apiRouter.get('/organic/channels', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const channels = organicChannels.listChannels(businessId);
  return c.json({ success: true, count: channels.length, data: channels });
});

// 2. Organic Content Drafts & Assets
apiRouter.get('/organic/content', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const channel = c.req.query('channel') as any;
  const status = c.req.query('status') as any;
  const assets = organicContent.listContent({ businessId, channel, approvalStatus: status });
  return c.json({ success: true, count: assets.length, data: assets });
});

// 3. Create Content Draft (Medical Compliance Check)
apiRouter.post('/organic/content', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';
  const userId = c.get('userId') || 'usr_owner_01';

  try {
    const asset = organicContent.createContentDraft({
      businessId,
      channel: body.channel,
      campaignId: body.campaignId || 'cmp_organic_hyd_01',
      contentType: body.contentType || 'PATIENT_EDUCATION',
      title: body.title,
      body: body.body,
      callToAction: body.callToAction,
      targetKeyword: body.targetKeyword,
      createdByAgent: body.createdByAgent || 'agt_content_01',
      hasMedicalClaim: body.hasMedicalClaim,
      medicalClaimSource: body.medicalClaimSource,
      sourceEvidence: body.sourceEvidence,
    });
    return c.json({ success: true, data: asset }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// 4. Approve & Publish Content (Doctor / Owner Signature Required)
apiRouter.post('/organic/content/:id/approve', async (c) => {
  const contentId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const userId = c.get('userId') || body.approvedByUserId || 'usr_owner_01';

  try {
    const approved = organicContent.approveContent({
      contentId,
      approvedByUserId: userId,
      publishImmediately: body.publishImmediately ?? true,
    });
    return c.json({ success: true, data: approved });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// 5. Local Landing Pages Directory
apiRouter.get('/organic/landing-pages', async (c) => {
  const pages = landingPages.listLandingPages();
  return c.json({ success: true, count: pages.length, data: pages });
});

// 6. Specific Local Landing Page with JSON-LD
apiRouter.get('/organic/landing-pages/:slug', async (c) => {
  const slug = c.req.param('slug');
  const page = landingPages.getLandingPage(slug);
  if (!page) {
    return c.json({ success: false, error: `Landing page '${slug}' not found` }, 404);
  }
  const jsonLd = landingPages.generateJsonLd(page);
  return c.json({ success: true, data: page, structuredData: jsonLd });
});

// 7. Clinical Review Requests (Post-Consultation)
apiRouter.post('/organic/reviews/request', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  try {
    const req = reviewReferral.createReviewRequest({
      businessId,
      customerId: body.customerId,
      journeyId: body.journeyId,
      appointmentId: body.appointmentId,
      channel: body.channel || 'WHATSAPP',
    });
    return c.json({ success: true, data: req }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

apiRouter.get('/organic/reviews', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const reviews = reviewReferral.listReviewRequests(businessId);
  return c.json({ success: true, count: reviews.length, data: reviews });
});

// 8. Referral Partnerships
apiRouter.post('/organic/referrals', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  try {
    const proposal = reviewReferral.createReferralProposal({
      businessId,
      category: body.category || 'LOCAL_COMMUNITY',
      partnerName: body.partnerName,
      contactPerson: body.contactPerson,
      proposalDraft: body.proposalDraft,
      offerTerms: body.offerTerms,
    });
    return c.json({ success: true, data: proposal }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

apiRouter.get('/organic/referrals', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const proposals = reviewReferral.listReferralPartnerships(businessId);
  return c.json({ success: true, count: proposals.length, data: proposals });
});

// 9. Ethical Direct Outreach
apiRouter.post('/organic/outreach', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  try {
    const draft = reviewReferral.createOutreachDraft({
      businessId,
      segment: body.segment || 'Corporate HR HITEC City',
      prospectName: body.prospectName,
      channel: body.channel || 'LINKEDIN',
      messageDraft: body.messageDraft,
    });
    return c.json({ success: true, data: draft }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

apiRouter.post('/organic/outreach/:id/dispatch', async (c) => {
  const outreachId = c.req.param('id');
  const userId = c.get('userId') || 'usr_owner_01';

  try {
    const result = reviewReferral.dispatchOutreach({
      outreachId,
      approvedByUserId: userId,
    });
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

apiRouter.get('/organic/outreach', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const logs = reviewReferral.listOutreachLogs(businessId);
  return c.json({ success: true, count: logs.length, data: logs });
});

// 10. Google Business Profile Insights
apiRouter.get('/organic/gbp', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const insights = gbpAdapter.getLocationInsights(businessId);
  return c.json({ success: true, data: insights });
});

// 11. Organic Economics
apiRouter.get('/organic/economics', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const economics = realEconomics.calculate(businessId);
  return c.json({ success: true, data: economics });
});

// 12. Zero-Budget Organic Experiments
apiRouter.get('/organic/experiments', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const experiments = autonomyController.generateZeroBudgetExperiments(businessId);
  return c.json({ success: true, count: experiments.length, data: experiments });
});

// 13. Public Visitor Session Ingestion (Evaluates Traffic Provenance)
const trafficProvenance = new TrafficProvenanceEngine();

apiRouter.post('/organic/sessions', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ipAddress =
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-real-ip') ||
    '127.0.0.1';
  const userAgent = c.req.header('user-agent') || 'unknown';
  const referrer = body.referrer || c.req.header('referer') || '';

  const session = trafficProvenance.recordSession({
    businessId: body.businessId || 'biz_smilekraft_hyd',
    visitorId: body.visitorId,
    sessionId: body.sessionId,
    landingPage: body.landingPage || '/aligners-hyderabad',
    referrer,
    utmSource: body.utmSource,
    utmMedium: body.utmMedium,
    utmCampaign: body.utmCampaign,
    utmContent: body.utmContent,
    ipAddress,
    userAgent,
    isTestHarness: body.isTestHarness,
  });

  return c.json({ success: true, data: session }, 201);
});

// 14. List Traffic Sessions
apiRouter.get('/organic/sessions', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const status = c.req.query('status') as any;
  const sessions = trafficProvenance.listSessions({ businessId, trafficEvidenceStatus: status });
  return c.json({ success: true, count: sessions.length, data: sessions });
});

// 15. Ingest Real Organic Lead (Tied to Existing Session Provenance)
apiRouter.post('/organic/leads', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  if (!body.customerName || body.customerName.trim().length === 0) {
    return c.json({ success: false, error: 'Customer name is required' }, 400);
  }

  const result = trafficProvenance.recordLead({
    businessId,
    organizationId: c.get('organizationId') || 'org_smilekraft_01',
    customerName: body.customerName,
    customerPhone: body.customerPhone,
    customerEmail: body.customerEmail,
    sessionId: body.sessionId,
    visitorId: body.visitorId,
    notes: body.notes,
  });

  return c.json({ success: true, data: result }, 201);
});

// 16. Traffic Stats & External Organic Distribution Counts
apiRouter.get('/organic/traffic-stats', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const stats = trafficProvenance.getOrganicDistributionStats(businessId);
  return c.json({ success: true, data: stats });
});

// 17. Lead Acquisition Evidence Retrieval
apiRouter.get('/organic/acquisition-evidence/:id', async (c) => {
  const id = c.req.param('id');
  const evidence = trafficProvenance.getAcquisitionEvidence(id);
  if (!evidence) {
    return c.json({ success: false, error: `Acquisition evidence for '${id}' not found` }, 404);
  }
  return c.json({ success: true, data: evidence });
});

// 18. Record External Publication Evidence (Gates DRAFT -> PUBLISHED)
apiRouter.post('/organic/content/:id/publish-evidence', async (c) => {
  const contentId = c.req.param('id');
  const body = await c.req.json();
  const userId = c.get('userId') || 'usr_owner_01';

  try {
    const updated = organicContent.recordPublicationEvidence({
      contentId,
      externalPostId: body.externalPostId,
      externalUrl: body.externalUrl,
      platform: body.platform || 'INSTAGRAM',
      verifiedByUserId: userId,
      rawResponseSnippet: body.rawResponseSnippet,
    });
    return c.json({ success: true, data: updated });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// 19. Google Business Profile OAuth Endpoints
apiRouter.get('/organic/gbp/oauth/status', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const status = gbpAdapter.getOAuthStatus(businessId);
  return c.json({ success: true, data: status });
});

apiRouter.get('/organic/gbp/oauth/authorize', async (c) => {
  const businessId = c.req.query('businessId') || 'biz_smilekraft_hyd';
  const redirectUri = c.req.query('redirectUri') || 'https://smilekraftdental.in/api/v1/organic/gbp/oauth/callback';
  const authUrl = gbpAdapter.getAuthorizationUrl(businessId, redirectUri);
  return c.json({ success: true, data: authUrl });
});

apiRouter.post('/organic/gbp/oauth/callback', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  try {
    const auth = gbpAdapter.handleOAuthCallback({
      businessId,
      code: body.code,
      googleAccountId: body.googleAccountId,
      locationId: body.locationId,
      refreshToken: body.refreshToken,
    });
    return c.json({ success: true, data: auth });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

apiRouter.post('/organic/gbp/posts', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  const result = gbpAdapter.createPostDraft({
    businessId,
    summary: body.summary,
    callToAction: body.callToAction,
    url: body.url,
    postType: body.postType,
  });
  return c.json({ success: true, data: result }, 201);
});

apiRouter.post('/organic/gbp/faqs', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';

  const draft = gbpAdapter.createFaqDraft({
    businessId,
    question: body.question,
    answer: body.answer,
  });
  return c.json({ success: true, data: draft }, 201);
});