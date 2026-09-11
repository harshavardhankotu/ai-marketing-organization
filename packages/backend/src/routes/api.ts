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

export type AppVariables = {
  organizationId: string;
  userId: string;
};

export const apiRouter = new Hono<{ Variables: AppVariables }>();

// Middleware: Extract tenant/org context
apiRouter.use('*', async (c, next) => {
  // Default to SmileKraft tenant for local dev / seed
  c.set('organizationId', c.req.header('x-organization-id') || 'org_smilekraft_01');
  c.set('userId', c.req.header('x-user-id') || 'usr_owner_01');
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
// REAL LEAD CAPTURE & PUBLIC BOOKING API
// ==========================================
apiRouter.post('/public/lead', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId || 'biz_smilekraft_hyd';
  const orgId = body.organizationId || 'org_smilekraft_01';

  if (!body.customerName || !body.customerPhone) {
    return c.json({ success: false, error: 'Full name and mobile phone number are required' }, 400);
  }

  // Validate Indian Phone format (10+ digits)
  const cleanPhone = body.customerPhone.replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    return c.json({ success: false, error: 'Invalid phone number. Must be a valid 10-digit mobile number' }, 400);
  }

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
    notes: body.notes
  });

  return c.json({
    success: true,
    message: 'Consultation request received successfully. Our clinic team will reach out via WhatsApp.',
    data: {
      journeyId: journey.id,
      visitorId: journey.visitorId,
      stage: journey.stage,
      clinic: 'SmileKraft Dental Clinic Banjara Hills & Gachibowli'
    }
  }, 201);
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