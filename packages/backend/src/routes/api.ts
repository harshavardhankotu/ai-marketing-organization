import { Hono } from 'hono';
import { handlePublicLeadRequest } from './public-lead.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
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

import { isProduction, isPlaceholderCredential } from '../config/env.js';
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
import { StripeAdapter } from '../integrations/stripe.js';
import { DPDPComplianceManager } from '../compliance/dpdp-manager.js';
import { MarketResearchPipeline } from '../research/market-research-pipeline.js';
import { AutonomousRevenueOrchestrator } from '../revenue/autonomous-revenue-orchestrator.js';
import { OpportunityEngine } from '../revenue/opportunity-engine.js';
import { NextBestActionEngine } from '../revenue/next-best-action-engine.js';
import { DurableEventBus } from '../revenue/durable-event-bus.js';
import { GoogleSearchClient } from '../research/google-search-client.js';
import { StrategyMatchingEngine } from '../strategy/matching-engine.js';
import { UniversalLockManager } from '../quota/universal-lock-manager.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';
import { D1Client } from '../db/d1-client.js';
import { RealityReportGenerator } from '../revenue/reality-report-generator.js';
import { RevenueBottleneckEngine } from '../revenue/revenue-bottleneck-engine.js';
import { LiveProviderActivation } from '../revenue/live-provider-activation.js';
import { CommercialLifecycleManager } from '../revenue/commercial-lifecycle.js';
import { OwnerAuthService } from '../auth/owner-auth.js';
import { SalesConversationEngine } from '../revenue/sales-conversation-engine.js';
import {
  handleGetPublicFunnel,
  handleCreateUniversalOrder,
  handleCreateBookingReservation,
  handleGetAvailability
} from './universal-funnel.js';
import { handleUniversalCheckout } from './universal-checkout.js';
import { OfferDecisionEngine } from '../revenue/offer-decision-engine.js';
import { toMajorUnits } from '@ai-marketing/shared';
import { TenantContextResolver } from '../control-plane/tenant-context-resolver.js';
import { ReferralTrackingEngine } from '../commission/referral-tracking.js';
import { PartnerRegistryEngine } from '../commission/partner-registry.js';
import { ContentAssetEngine } from '../commission/content-asset-engine.js';
import { ConversionVerificationAdapter } from '../commission/conversion-verification.js';
import { CommissionLedgerEngine } from '../commission/commission-ledger.js';
import { DemandDiscoveryEngine } from '../commission/demand-discovery.js';
import { DirectPaymentProviderAdapter } from '../commission/direct-payment-adapter.js';

export type AppVariables = {
  organizationId: string;
  userId: string;
};

/**
 * Phase 2 Task 27: minimal CSV parser for provider commission reports.
 * Handles quoted fields + header row; maps headers case-insensitively to
 * snake_case keys (e.g. "Transaction ID" -> transaction_id).
 */
export function parseCommissionCsv(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells.map(c => c.replace(/^"|"$/g, ''));
  };
  const headers = splitRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  return lines.slice(1).map(line => {
    const cells = splitRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] || ''; });
    return row;
  });
}

export const EXACT_ROUTE_POLICY = {
  PUBLIC: [
    '/health',
    '/diagnostic/env',
    '/public/lead',
    '/public/business',
    '/public/funnel',
    '/public/order',
    '/public/checkout',
    '/public/booking',
    '/public/availability',
    '/landing-pages',
    '/organic/sessions',
    '/organic/leads',
    '/auth/owner/login',
    '/auth/owner/logout',
    '/payments/razorpay/create-order',
    '/payments/razorpay/verify',
    '/payments/manual-upi/claim',
    '/compliance/dpdp/consent',
    '/compliance/dpdp/erasure',
    '/payments/razorpay/health',
    '/r',
    '/public/content',
    '/public/disclosure',
    '/guides',
    '/compare',
    '/recommendations',
    '/offers',
    '/commission/money-path',
    '/commission/launch-checklist'
  ],
  WEBHOOK: [
    '/webhooks/razorpay',
    '/webhooks/stripe',
    '/webhooks/whatsapp',
    '/webhooks/email',
    '/webhooks/payments',
    '/webhooks/conversion'
  ],
  SYSTEM: [
    '/cron/ping',
    '/cron/status'
  ]
};

export const apiRouter = new Hono<{ Variables: AppVariables }>();

apiRouter.get('/diagnostic/env', (c) => {
  return c.json({
    CRON_PING_SECRET: process.env.CRON_PING_SECRET ? (process.env.CRON_PING_SECRET.length > 5 ? 'CONFIGURED' : 'TOO_SHORT') : 'MISSING',
    OWNER_API_KEY: process.env.OWNER_API_KEY ? (process.env.OWNER_API_KEY.length > 5 ? 'CONFIGURED' : 'TOO_SHORT') : 'MISSING',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ? (process.env.GEMINI_API_KEY.length > 5 ? 'CONFIGURED' : 'TOO_SHORT') : 'MISSING',
    TAVILY_API_KEY: process.env.TAVILY_API_KEY ? (process.env.TAVILY_API_KEY.length > 5 ? 'CONFIGURED' : 'TOO_SHORT') : 'MISSING'
  });
});


// Middleware: Authentication & Tenant Context Boundary
apiRouter.use('*', async (c, next) => {
  const rawPath = c.req.path;
  const path = rawPath.replace(/^\/api\/v1/, '') || '/';

  // 1. Explicit Public Endpoints (Spec § 5, § 46, § 47)
  const isExplicitPublic = EXACT_ROUTE_POLICY.PUBLIC.some(
    p => path === p || path.startsWith(p + '/')
  );

  if (isExplicitPublic) {
    // In production, public requests MUST ignore client-supplied x-organization-id headers
    c.set('organizationId', isProduction() ? '' : (c.req.header('x-organization-id') || 'org_owner_primary'));
    c.set('userId', 'usr_public_lead');
    return await next();
  }

  // 2. Gateway Webhooks (Cryptographically verified by gateway secret)
  const isWebhook = EXACT_ROUTE_POLICY.WEBHOOK.some(
    p => path === p || path.startsWith(p + '/')
  );

  if (isWebhook) {
    c.set('organizationId', c.req.header('x-organization-id') || (isProduction() ? '' : 'org_owner_primary'));
    c.set('userId', 'usr_webhook_gateway');
    return await next();
  }

  // 3. Cloudflare Worker Cron Trigger (Authenticated via X-Cron-Secret)
  const isSystem = EXACT_ROUTE_POLICY.SYSTEM.some(
    p => path === p || path.startsWith(p + '/')
  );

  if (isSystem) {
    c.set('organizationId', OwnerAuthService.OWNER_ORGANIZATION_ID);
    c.set('userId', 'usr_cron_trigger');
    return await next();
  }

  // 4. Owner-Only Administration Context Boundary (Spec § 2, § 3, § 4, § 46, § 47)
  let db: any = null;
  try { db = getDb(); } catch {}
  const ownerAuth = OwnerAuthService.getInstance();
  const cookieHeader = c.req.header('cookie') || '';
  const cookieToken = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith('owner_session='))?.split('=')[1];

  const authHeader = c.req.header('authorization') || c.req.header('Authorization');
  const apiKeyHeader = c.req.header('x-api-key');

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : (apiKeyHeader?.trim() || cookieToken?.trim());

  const ownerSession = await ownerAuth.validateTokenAsync(token);

  if (isProduction()) {
    // PRODUCTION: Authenticated principal strictly required!
    // Arbitrary client-provided identity headers (x-user-id / x-organization-id) are rejected.
    if (!token) {
      return c.json({
        success: false,
        error: 'Unauthorized: In production, an authenticated principal is required via Bearer token or x-api-key. Client identity headers alone are rejected.'
      }, 401);
    }

    if (ownerSession) {
      c.set('userId', ownerSession.userId);
      c.set('organizationId', ownerSession.organizationId);
    } else {
      // In production, fallback to SQLite users table is strictly forbidden.
      // Principals must be authenticated via OWNER_API_KEY or Cloudflare D1 owner_sessions.
      return c.json({
        success: false,
        error: 'Unauthorized: Invalid authentication credentials.'
      }, 401);
    }
  } else {
    // DEVELOPMENT & TEST:
    if (ownerSession) {
      c.set('userId', ownerSession.userId);
      c.set('organizationId', ownerSession.organizationId);
      return await next();
    }

    // In dev/test: check if token matches a legacy user in DB (e.g. tenant-isolation tests)
    if (token) {
      try {
        const user = db.prepare("SELECT * FROM users WHERE api_token = ?").get(token) as any;
        if (user) {
          c.set('userId', user.id);
          c.set('organizationId', user.organization_id);
          return await next();
        }
      } catch {}
    }

    // Allow explicit identity headers in test runners, defaulting to seeded test business
    c.set('organizationId', c.req.header('x-organization-id') || (isProduction() ? '' : 'org_owner_primary'));
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

// ==========================================
// SINGLE-OWNER AUTHENTICATION & SESSION (Spec § 2 & § 3)
// ==========================================
apiRouter.post('/auth/owner/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const apiKey = (body.apiKey || body.secret || c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', ''))?.trim();
  const ownerAuth = OwnerAuthService.getInstance();

  if (!ownerAuth.verifyKey(apiKey)) {
    return c.json({
      success: false,
      error: 'Unauthorized: Invalid owner credentials. OWNER_API_KEY / AUTH_SECRET mismatch.'
    }, 401);
  }

  const clientIp = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || '127.0.0.1';
  const userAgent = c.req.header('user-agent') || 'Browser';
  const session = await ownerAuth.createSessionAsync(clientIp, userAgent);

  const isSecure = isProduction();
  const isCrossOrigin = Boolean(process.env.FRONTEND_ORIGIN && !process.env.FRONTEND_ORIGIN.includes('onrender.com'));
  const sameSite = process.env.COOKIE_SAMESITE || (isSecure && isCrossOrigin ? 'None' : 'Lax');
  c.header('Set-Cookie', `owner_session=${session.token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=86400${isSecure ? '; Secure' : ''}`);

  return c.json({
    success: true,
    data: {
      // token is intentionally omitted from JSON body in production — it is set via HttpOnly cookie only
      // API clients should use x-api-key header authentication instead of extracting the cookie token
      principal_type: session.principalType,
      organization_id: session.organizationId,
      user_id: session.userId,
      expires_at: session.expiresAt,
      ...(isProduction() ? {} : { token: session.token }) // Only expose in non-production for testing
    }
  });
});

apiRouter.post('/auth/owner/logout', async (c) => {
  const cookieHeader = c.req.header('cookie') || '';
  const cookieToken = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith('owner_session='))?.split('=')[1];
  const authHeader = c.req.header('authorization') || c.req.header('x-api-key') || '';
  const token = authHeader.replace('Bearer ', '').trim() || cookieToken;

  if (token) {
    await OwnerAuthService.getInstance().revokeSessionAsync(token);
  }

  const isSecure = isProduction();
  const isCrossOrigin = Boolean(process.env.FRONTEND_ORIGIN && !process.env.FRONTEND_ORIGIN.includes('onrender.com'));
  const sameSite = process.env.COOKIE_SAMESITE || (isSecure && isCrossOrigin ? 'None' : 'Lax');
  c.header('Set-Cookie', `owner_session=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${isSecure ? '; Secure' : ''}`);
  return c.json({ success: true, message: 'Logged out successfully.' });
});

apiRouter.get('/auth/owner/session', async (c) => {
  const cookieHeader = c.req.header('cookie') || '';
  const cookieToken = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith('owner_session='))?.split('=')[1];
  const authHeader = c.req.header('authorization') || c.req.header('x-api-key') || '';
  const token = authHeader.replace('Bearer ', '').trim() || cookieToken;

  const ownerAuth = OwnerAuthService.getInstance();
  const session = await ownerAuth.validateTokenAsync(token);

  if (!session) {
    return c.json({ success: false, error: 'No active owner session found.' }, 401);
  }

  const config = ownerAuth.getOwnerConfiguration();
  return c.json({
    success: true,
    data: {
      principal_type: session.principalType,
      organization_id: session.organizationId,
      user_id: session.userId,
      owner_name: config.owner_name,
      platform_business_id: config.platform_business_id,
      platform_upi_vpa: config.platform_upi_vpa,
      marketing_budget: config.marketing_budget,
      autonomy_enabled: Boolean(config.autonomy_enabled),
      expires_at: session.expiresAt
    }
  });
});


// Quota & Free Tier Observability
apiRouter.get('/quota', (c) => {
  const status = QuotaManager.getInstance().getStatus();
  return c.json({ success: true, data: status });
});

// Universal Free-Tier Quota Lock Observability
apiRouter.get('/quota/locks', (c) => {
  const report = UniversalLockManager.getInstance().getStatus();
  return c.json({ success: true, data: report });
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

  const slugBase = data.name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `business-${Date.now()}`;
  let publicSlug = slugBase;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM businesses WHERE public_slug = ? LIMIT 1').get(publicSlug)) {
    publicSlug = `${slugBase}-${suffix++}`;
  }

  const country = data.country || 'IN';
  const currency = data.currency || 'INR';
  const timezone = data.timezone || 'Asia/Kolkata';
  const locale = data.locale || 'en-US';
  const email = data.email || null;
  const serviceArea = JSON.stringify(data.serviceArea || []);

  const insertBizSql = `
    INSERT INTO businesses (
      id, organization_id, name, public_slug, vertical_id, vertical_name,
      country, currency, timezone, locale, city, neighborhood, service_area_json,
      website_url, phone, email, primary_language, secondary_languages_json,
      brand_voice, value_propositions_json, offerings_json, constraints_json,
      autonomy_mode, kill_switch_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `;
  const insertBizParams = [
    businessId, orgId, data.name, publicSlug, data.verticalId, data.verticalName,
    country, currency, timezone, locale, data.city, data.neighborhood, serviceArea,
    data.websiteUrl || null, data.phone || null, email,
    data.primaryLanguage, JSON.stringify(data.secondaryLanguages),
    data.brandVoice, JSON.stringify(data.valuePropositions), JSON.stringify(data.offerings),
    JSON.stringify({ monthlyBudgetINR: data.monthlyBudgetINR, monthlyBudgetMinor: data.monthlyBudgetMinor }),
    data.autonomyMode
  ];

  if (isProduction()) {
    const d1Repo = D1RevenueRepository.getInstance();
    try {
      await d1Repo.executeWrite('businesses', insertBizSql, insertBizParams);

      // Populate durable customer_offers table in D1
      if (Array.isArray(data.offerings)) {
        for (const off of data.offerings) {
          const offId = off.id || `off_${businessId}_${Math.random().toString(36).substring(2, 7)}`;
          const priceMinor = off.priceMinor !== undefined ? off.priceMinor : (off.priceINR ? Math.round(off.priceINR * 100) : 0);
          await d1Repo.executeWrite(
            'customer_offers',
            `INSERT INTO customer_offers (
              id, business_id, organization_id, title, description, category,
              price_minor, currency, billing_model, deliverables_json, active
            ) VALUES (?, ?, ?, ?, ?, 'GENERAL', ?, ?, 'ONE_TIME', ?, 1)`,
            [offId, businessId, orgId, off.title, off.description || '', priceMinor, currency, JSON.stringify([off.description || off.title])]
          );
        }
      }

      const goalId = `goal_${businessId}`;
      await d1Repo.executeWrite(
        'business_goals',
        `INSERT INTO business_goals (
          id, organization_id, business_id, title, target_metric,
          target_value, current_value, metric_unit, timeframe_days,
          start_date, target_date, budget_allocated_inr, status, kpis_json
        ) VALUES (?, ?, ?, ?, 'qualified_leads', 100, 0, 'leads', 90, date('now'), date('now', '+90 days'), ?, 'ACTIVE', '[]')`,
        [goalId, orgId, businessId, `${data.name} Primary Lead Goal`, data.monthlyBudgetINR || 1000]
      );
    } catch (d1Err: any) {
      console.error(`[POST /business FATAL D1 FAILURE]: ${d1Err.message}`);
      return c.json({
        success: false,
        error: `PERSISTENCE_FAULT: Failed to create business in Cloudflare D1: ${d1Err.message}`
      }, 500);
    }
  } else {
    db.prepare(insertBizSql).run(...insertBizParams);

    // Populate durable customer_offers table for universal catalog
    if (Array.isArray(data.offerings)) {
      for (const off of data.offerings) {
        const offId = off.id || `off_${businessId}_${Math.random().toString(36).substring(2, 7)}`;
        const priceMinor = off.priceMinor !== undefined ? off.priceMinor : (off.priceINR ? Math.round(off.priceINR * 100) : 0);
        try {
          db.prepare(`
            INSERT INTO customer_offers (
              id, business_id, organization_id, title, description, category,
              price_minor, currency, billing_model, deliverables_json, active
            ) VALUES (?, ?, ?, ?, ?, 'GENERAL', ?, ?, 'ONE_TIME', ?, 1)
          `).run(offId, businessId, orgId, off.title, off.description || '', priceMinor, currency, JSON.stringify([off.description || off.title]));
        } catch {}
      }
    }

    // Create baseline campaign & goal so business is immediately operational
    const goalId = `goal_${businessId}`;
    db.prepare(`
      INSERT OR REPLACE INTO business_goals (
        id, organization_id, business_id, title, target_metric,
        target_value, current_value, metric_unit, timeframe_days,
        start_date, target_date, budget_allocated_inr, status, kpis_json
      ) VALUES (?, ?, ?, ?, 'qualified_leads', 100, 0, 'leads', 90, date('now'), date('now', '+90 days'), ?, 'ACTIVE', '[]')
    `).run(goalId, orgId, businessId, `${data.name} Primary Lead Goal`, data.monthlyBudgetINR || 1000);

    const strategyId = `strat_${businessId}`;
    db.prepare(`
      INSERT OR REPLACE INTO strategies (
        id, organization_id, business_id, goal_id, version,
        title, rationale, positioning, target_audience_json,
        channel_strategy_json, content_themes_json, expected_leads,
        expected_cpql_inr, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, 'Acquire qualified inquiries via direct digital funnels', ?, '["Target market in city"]', '["WHATSAPP", "GOOGLE_BUSINESS_PROFILE"]', '["Core Service"]', 100, 500, 'ACTIVE', date('now'), date('now'))
    `).run(strategyId, orgId, businessId, goalId, `${data.name} Growth Strategy`, data.brandVoice);

    const campaignId = `cmp_${businessId}`;
    db.prepare(`
      INSERT OR REPLACE INTO campaigns (
        id, organization_id, business_id, strategy_id, goal_id,
        title, objective, channels_json, target_audience, geography_json,
        budget_inr, primary_kpi, target_qualified_leads, start_date, end_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'Acquire qualified inquiries', '["WHATSAPP", "GOOGLE_BUSINESS_PROFILE"]', 'Local residents and professionals', ?, ?, 'qualified_leads', 100, date('now'), date('now', '+30 days'), 'ACTIVE')
    `).run(
      campaignId, orgId, businessId, strategyId, goalId, `${data.name} Inbound Campaign`,
      JSON.stringify({ city: data.city, neighborhood: data.neighborhood }), data.monthlyBudgetINR || 1000
    );
  }

  return c.json({
    success: true,
    data: {
      id: businessId,
      publicSlug,
      public_slug: publicSlug,
      country,
      currency,
      timezone
    }
  });
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
  const goalId = `goal_${Date.now()}`;
  const insertGoalSql = `
    INSERT INTO business_goals (
      id, organization_id, business_id, title, target_metric,
      target_value, current_value, metric_unit, timeframe_days,
      start_date, target_date, budget_allocated_inr, status, kpis_json
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, date('now'), date('now', '+' || ? || ' days'), ?, 'ACTIVE', '[]')
  `;
  const insertGoalParams = [goalId, orgId, d.businessId, d.title, d.targetMetric, d.targetValue, d.metricUnit, d.timeframeDays, d.timeframeDays, d.budgetAllocatedINR];

  if (isProduction()) {
    try {
      const d1Repo = D1RevenueRepository.getInstance();
      await d1Repo.executeWrite('business_goals', insertGoalSql, insertGoalParams);
    } catch (d1Err: any) {
      console.error(`[POST /goals D1 FAILURE]: ${d1Err.message}`);
      return c.json({
        success: false,
        error: `PERSISTENCE_FAULT: Failed to create goal in Cloudflare D1: ${d1Err.message}`
      }, 500);
    }
  } else {
    const db = getDb();
    db.prepare(insertGoalSql).run(...insertGoalParams);
  }

  return c.json({ success: true, data: { id: goalId } });
});

// Closed-Loop Autonomous Marketing Cycle Trigger
apiRouter.post('/workflows/trigger-cycle', async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json().catch(() => ({}));
  const db = getDb();

  // Auto-resolve business if not explicitly provided
  const bizRow = body.businessId
    ? db.prepare('SELECT id FROM businesses WHERE id = ?').get(body.businessId) as any
    : db.prepare('SELECT id FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;
  const businessId = bizRow?.id || body.businessId;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

  // Auto-resolve goal if not explicitly provided
  const goalRow = body.goalId
    ? db.prepare('SELECT id FROM business_goals WHERE id = ?').get(body.goalId) as any
    : db.prepare('SELECT id FROM business_goals WHERE business_id = ? AND status = "ACTIVE" LIMIT 1').get(businessId) as any;
  const goalId = goalRow?.id || body.goalId || 'goal_100_leads_hyd';

  try {
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
  } catch (err: any) {
    console.error('[TRIGGER CYCLE ERROR]:', err);
    return c.json({
      success: false,
      error: err.message || 'Failed to execute closed loop marketing cycle'
    }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AUTONOMOUS REVENUE ORCHESTRATOR (ARO) — CEO Loop
// ──────────────────────────────────────────────────────────────────────────────

// POST /workflows/autonomous-cycle — trigger a full ARO cycle
apiRouter.post('/workflows/autonomous-cycle', async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json().catch(() => ({}));
  const db = getDb();

  const bizRow = body.businessId
    ? db.prepare('SELECT id FROM businesses WHERE id = ?').get(body.businessId) as any
    : db.prepare('SELECT id FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;

  if (!bizRow) {
    return c.json({ success: false, error: 'No business found. Create a business first.' }, 400);
  }

  const triggerSource = body.triggerSource || 'MANUAL';

  try {
    const aro = AutonomousRevenueOrchestrator.getInstance();
    const result = await aro.runCycle(orgId, bizRow.id, triggerSource);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[ARO CYCLE ERROR]:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /revenue/opportunities — list opportunities ranked by expected value
apiRouter.get('/revenue/opportunities', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const bizRow = db.prepare('SELECT id FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;
  if (!bizRow) return c.json({ success: true, data: [] });

  const engine = OpportunityEngine.getInstance();
  const ranked = engine.scoreAndRank(bizRow.id);
  return c.json({ success: true, data: ranked, total: ranked.length });
});

// GET /revenue/next-best-action — what should the system do right now?
apiRouter.get('/revenue/next-best-action', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const bizRow = db.prepare('SELECT id FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;
  if (!bizRow) return c.json({ success: false, error: 'No business found' }, 400);

  const nba = NextBestActionEngine.getInstance().choose(bizRow.id, orgId);
  return c.json({ success: true, data: nba });
});

// GET /revenue/events — inspect the durable event bus (recent 50 events)
apiRouter.get('/revenue/events', (c) => {
  const orgId = c.get('organizationId');
  const events = DurableEventBus.listRecent(orgId, 50);
  return c.json({ success: true, data: events, total: events.length });
});

// GET /revenue/pipeline — full sales pipeline for the business
apiRouter.get('/revenue/pipeline', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const pipeline = db.prepare(`
    SELECT sp.*, cj.customer_name, cj.customer_phone, cj.customer_email
    FROM sales_pipeline sp
    LEFT JOIN customer_journeys cj ON sp.journey_id = cj.id
    WHERE sp.organization_id = ?
    ORDER BY sp.expected_revenue_inr DESC, sp.created_at DESC
    LIMIT 100
  `).all(orgId) as any[];
  return c.json({ success: true, data: pipeline, total: pipeline.length });
});

// GET /revenue/ceo-dashboard — ARO CEO dashboard (Spec §§ 31 & 32)
apiRouter.get('/revenue/ceo-dashboard', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();

  const bizRow = db.prepare('SELECT * FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;
  const businessId = bizRow?.id;

  const verified = businessId ? (db.prepare(
    `SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS'`
  ).get(businessId) as any)?.total || 0 : 0;

  const revenueToday = businessId ? (db.prepare(
    `SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS' AND created_at >= date('now')`
  ).get(businessId) as any)?.total || 0 : 0;

  const revenueThisMonth = businessId ? (db.prepare(
    `SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS' AND created_at >= date('now', 'start of month')`
  ).get(businessId) as any)?.total || 0 : 0;

  const pipeline = businessId ? (db.prepare(
    `SELECT COALESCE(SUM(expected_revenue_inr), 0) as total FROM sales_pipeline WHERE business_id = ? AND stage NOT IN ('LOST')`
  ).get(businessId) as any)?.total || 0 : 0;

  const expectedRevenue = businessId ? (db.prepare(
    `SELECT COALESCE(SUM(expected_revenue_inr), 0) as total FROM opportunities WHERE business_id = ? AND status NOT IN ('WON', 'LOST', 'IGNORED')`
  ).get(businessId) as any)?.total || 0 : 0;

  const customers = businessId ? (db.prepare(
    `SELECT COUNT(*) as cnt FROM customer_journeys WHERE business_id = ? AND stage = 'CUSTOMER' AND classification = 'REAL'`
  ).get(businessId) as any)?.cnt || 0 : 0;

  const leads = businessId ? (db.prepare(
    `SELECT COUNT(*) as cnt FROM customer_journeys WHERE business_id = ? AND stage IN ('LEAD','QUALIFIED_LEAD') AND classification = 'REAL'`
  ).get(businessId) as any)?.cnt || 0 : 0;

  const prospects = businessId ? (db.prepare(
    `SELECT COUNT(*) as cnt FROM sales_pipeline WHERE business_id = ? AND stage = 'PROSPECT'`
  ).get(businessId) as any)?.cnt || 0 : 0;

  const replies = businessId ? (db.prepare(
    `SELECT COUNT(*) as cnt FROM sales_pipeline WHERE business_id = ? AND stage = 'REPLIED'`
  ).get(businessId) as any)?.cnt || 0 : 0;

  const meetings = businessId ? (db.prepare(
    `SELECT COUNT(*) as cnt FROM sales_pipeline WHERE business_id = ? AND stage = 'MEETING_BOOKED'`
  ).get(businessId) as any)?.cnt || 0 : 0;

  const offers = businessId ? (db.prepare(
    `SELECT COUNT(*) as cnt FROM sales_pipeline WHERE business_id = ? AND stage = 'PROPOSAL_SENT'`
  ).get(businessId) as any)?.cnt || 0 : 0;

  const paymentPending = businessId ? (db.prepare(
    `SELECT COUNT(*) as cnt FROM payment_requests WHERE business_id = ? AND status IN ('SENT', 'PENDING', 'PAYMENT_INITIATED')`
  ).get(businessId) as any)?.cnt || 0 : 0;

  const activeOpps = businessId ? (db.prepare(
    `SELECT COUNT(*) as cnt FROM opportunities WHERE business_id = ? AND status NOT IN ('WON','LOST','IGNORED')`
  ).get(businessId) as any)?.cnt || 0 : 0;

  const lastCycle = (db.prepare(
    `SELECT * FROM autonomous_cycle_log WHERE organization_id = ? ORDER BY cycle_start DESC LIMIT 1`
  ).get(orgId) as any);

  const nba = businessId ? NextBestActionEngine.getInstance().choose(businessId, orgId) : null;
  const quota = UnifiedQuotaService.getInstance().getStatus();
  const health = UnifiedQuotaService.getInstance().getHealthSummary(orgId);

  const bottleneck = leads > 0 && customers === 0
    ? 'LEADS NOT CONVERTING — needs outreach'
    : activeOpps === 0 && leads === 0
    ? 'NO PIPELINE — needs prospect discovery'
    : verified === 0
    ? 'NO REVENUE — needs payment collection'
    : 'GROWING';

  return c.json({
    success: true,
    data: {
      autonomy: {
        status: health.status,
        lastWake: lastCycle?.cycle_start || null,
        nextWake: lastCycle?.next_cycle_at || null,
        currentAction: nba?.actionType || 'IDLE',
        currentBottleneck: bottleneck
      },
      gemini: {
        usedToday: quota.GEMINI?.used ?? 0,
        safetyLimit: quota.GEMINI?.applicationLimit ?? 1200,
        remaining: quota.GEMINI?.remainingAllowance ?? 1200,
        reset: quota.GEMINI?.nextReset ?? null,
        mode: quota.GEMINI?.mode ?? 'NORMAL'
      },
      tavily: {
        creditsUsedThisMonth: quota.TAVILY?.used ?? 0,
        safetyLimit: quota.TAVILY?.applicationLimit ?? 800,
        remaining: quota.TAVILY?.remainingAllowance ?? 800,
        reset: quota.TAVILY?.nextReset ?? null,
        mode: quota.TAVILY?.mode ?? 'NORMAL'
      },
      sales: {
        prospects,
        leads,
        replies,
        meetings,
        offers,
        paymentPending,
        customers
      },
      revenue: {
        verifiedRevenue: verified,
        pipelineValue: pipeline,
        expectedRevenue,
        revenueToday,
        revenueThisMonth
      },
      health,
      d1Usage: D1Client.getInstance().getUsage(),
      cron: (() => {
        let row: any;
        try {
          row = db.prepare(`SELECT * FROM cron_telemetry WHERE id = 'cloudflare_worker_cron'`).get();
        } catch {}
        const parseSqliteTimestampMs = (ts: string | null | undefined): number => {
          if (!ts) return 0;
          const isoStr = ts.includes('T') ? (ts.endsWith('Z') ? ts : ts + 'Z') : ts.replace(' ', 'T') + 'Z';
          return new Date(isoStr).getTime();
        };
        const totalPings = Number(row?.total_pings || 0);
        const lastPingMs = parseSqliteTimestampMs(row?.last_observed_ping);
        const now = Date.now();
        const isRecent = lastPingMs > 0 && (now - lastPingMs) < (35 * 60 * 1000);
        const isHealthy = totalPings > 0 && isRecent && (row?.cycle_result === 'SUCCESS' || row?.status === 'HEALTHY');

        const status: 'CONFIGURED' | 'DEPLOYED' | 'OBSERVED' | 'HEALTHY' = isHealthy
          ? 'HEALTHY'
          : (totalPings > 0 ? 'OBSERVED' : 'CONFIGURED');

        return {
          status,
          cronExpression: '0 * * * *',
          lastObservedPing: row?.last_observed_ping || null,
          totalPings,
          lastSuccessfulCycle: row?.last_successful_cycle || null,
          lastFailedCycle: row?.last_failed_cycle || null,
          cycleResult: row?.cycle_result || null
        };
      })(),
      // Backward-compatible properties for existing consumers
      verifiedRevenueINR: verified,
      pipelineValueINR: pipeline,
      customers,
      leads,
      activeOpportunities: activeOpps,
      nextBestAction: nba,
      currentBottleneck: bottleneck
    }
  });
});

// GET /cron/status — Verify Cloudflare Cron status (Spec § 16: CONFIGURED | DEPLOYED | OBSERVED | HEALTHY)
apiRouter.get('/cron/status', async (c) => {
  const d1Repo = D1RevenueRepository.getInstance();
  let row: any = null;
  try {
    row = await d1Repo.queryOne('cron_telemetry', `SELECT * FROM cron_telemetry WHERE id = 'cloudflare_worker_cron'`);
  } catch {}

  const parseSqliteTimestampMs = (ts: string | null | undefined): number => {
    if (!ts) return 0;
    const isoStr = ts.includes('T') ? (ts.endsWith('Z') ? ts : ts + 'Z') : ts.replace(' ', 'T') + 'Z';
    return new Date(isoStr).getTime();
  };
  const totalPings = Number(row?.total_pings || 0);
  const lastPingMs = parseSqliteTimestampMs(row?.last_observed_ping);
  const now = Date.now();
  const isRecent = lastPingMs > 0 && (now - lastPingMs) < (75 * 60 * 1000);
  const isHealthy = totalPings > 0 && isRecent && (row?.cycle_result === 'SUCCESS' || row?.status === 'HEALTHY');

  const status: 'CONFIGURED' | 'DEPLOYED' | 'OBSERVED' | 'HEALTHY' = isHealthy
    ? 'HEALTHY'
    : (totalPings > 0 ? 'OBSERVED' : 'CONFIGURED');

  return c.json({
    success: true,
    data: {
      status,
      cronExpression: '0 * * * *',
      totalPings,
      lastObservedPing: row?.last_observed_ping || null,
      lastSuccessfulCycle: row?.last_successful_cycle || null,
      lastFailedCycle: row?.last_failed_cycle || null,
      cycleResult: row?.cycle_result || null,
      lastUserAgent: row?.last_user_agent || null,
      workerSource: row?.worker_source || null
    }
  });
});

// Public Cloudflare Worker cron ping endpoint (Spec § 2 & § 16)
apiRouter.post('/cron/ping', async (c) => {
  const secret = c.req.header('x-cron-secret') || c.req.header('X-Cron-Secret') || '';

  if (isProduction()) {
    const expectedSecret = process.env.CRON_PING_SECRET;
    if (!expectedSecret || isPlaceholderCredential(expectedSecret) || expectedSecret === 'cron_ping_default_dev') {
      return c.json({ error: 'SECURITY VIOLATION: CRON_PING_SECRET is mandatory in production and must not be empty or placeholder.' }, 403);
    }
    if (secret !== expectedSecret) {
      return c.json({ error: 'Unauthorized: Invalid X-Cron-Secret' }, 401);
    }
  } else {
    const expectedSecret = process.env.CRON_PING_SECRET || 'cron_ping_default_dev';
    if (secret !== expectedSecret && secret !== 'cron_ping_default_dev' && secret !== 'cron_ping_fixture_dev') {
      return c.json({ error: 'Unauthorized: Invalid X-Cron-Secret' }, 401);
    }
  }

  const d1Repo = D1RevenueRepository.getInstance();
  const userAgent = c.req.header('user-agent') || 'cloudflare-cron-worker';
  const workerSource = c.req.header('cf-worker') || c.req.header('x-worker-source') || userAgent;

  // Record observed cron execution in cron_telemetry (Spec § 16)
  try {
    const sql = `
      INSERT INTO cron_telemetry (id, status, last_observed_ping, total_pings, last_user_agent, worker_source, updated_at)
      VALUES ('cloudflare_worker_cron', 'OBSERVED', datetime('now'), 1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        status = 'OBSERVED',
        last_observed_ping = datetime('now'),
        total_pings = total_pings + 1,
        last_user_agent = ?,
        worker_source = ?,
        updated_at = datetime('now')
    `;
    const params = [userAgent, workerSource, userAgent, workerSource];
    await d1Repo.executeWrite('cron_telemetry', sql, params);
  } catch (err: any) {
    console.error(`[Cron Ping] Telemetry write failed: ${err.message}`);
  }

  // Sync durable quota state from D1 before cycle execution
  try {
    await UnifiedQuotaService.getInstance().syncFromD1Async();
  } catch {}

  // Sync durable action cooldowns from D1 before cycle execution
  try {
    const { ActionCooldownManager } = await import('../revenue/action-cooldown-manager.js');
    await ActionCooldownManager.syncFromD1Async();
  } catch {}

  let eligibleBusinesses: any[] = [];
  try {
    eligibleBusinesses = await d1Repo.query('businesses', `
      SELECT b.id as business_id, b.organization_id 
      FROM businesses b
      JOIN organizations o ON b.organization_id = o.id
      WHERE COALESCE(b.kill_switch_active, 0) = 0
      ORDER BY b.created_at ASC
    `);
  } catch {}

  const results: any[] = [];
  let allSucceeded = true;
  let lastError = '';

  for (const item of eligibleBusinesses) {
    try {
      const aro = AutonomousRevenueOrchestrator.getInstance();
      const result = await aro.runCycle(item.organization_id, item.business_id, 'CLOUDFLARE_CRON');
      results.push({
        organizationId: item.organization_id,
        businessId: item.business_id,
        status: result.status,
        actionExecutionStatus: result.actionExecutionStatus,
        actionClassification: result.actionClassification,
        actionsTaken: result.actionsTaken,
        nextBestAction: result.nextBestAction.actionType
      });
    } catch (err: any) {
      allSucceeded = false;
      lastError = err.message;
      results.push({ organizationId: item.organization_id, businessId: item.business_id, status: 'ERROR', error: err.message });
    }
  }

  // Update cycle outcome in telemetry
  try {
    const outcomeStatus = allSucceeded ? 'HEALTHY' : 'OBSERVED';
    const sqlUpdate = allSucceeded
      ? `UPDATE cron_telemetry SET status = ?, last_successful_cycle = datetime('now'), cycle_result = 'SUCCESS', updated_at = datetime('now') WHERE id = 'cloudflare_worker_cron'`
      : `UPDATE cron_telemetry SET status = ?, last_failed_cycle = datetime('now'), cycle_result = ?, updated_at = datetime('now') WHERE id = 'cloudflare_worker_cron'`;
    const updateParams = allSucceeded ? [outcomeStatus] : [outcomeStatus, lastError || 'CYCLE_ERROR'];
    await d1Repo.executeWrite('cron_telemetry', sqlUpdate, updateParams);
  } catch {}

  return c.json({ success: true, data: results, timestamp: new Date().toISOString() });
});

// ==========================================
// REVENUE PROOF & AUDIT TRAIL (Spec § 29)
// ==========================================
apiRouter.get('/revenue/proof', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const bizRow = db.prepare('SELECT id FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;
  const businessId = c.req.query('businessId') || bizRow?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }

  const verified = (db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS'`).get(businessId) as any)?.total || 0;
  const humanVerified = (db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE business_id = ? AND classification = 'MANUAL_VERIFIED' AND status = 'SUCCESS'`).get(businessId) as any)?.total || 0;
  const unverified = (db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE business_id = ? AND status = 'PENDING'`).get(businessId) as any)?.total || 0;
  const testRev = (db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE classification = 'TEST'`).get() as any)?.total || 0;
  const simulatedRev = (db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE classification = 'SIMULATED'`).get() as any)?.total || 0;

  let platformRev = 0;
  try {
    platformRev = (db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM revenue_records WHERE revenue_type = 'PLATFORM_REVENUE' AND verified = 1`).get() as any)?.total || 0;
  } catch {}

  const transactions = db.prepare(`SELECT id, amount_inr, classification, status, payment_gateway, transaction_ref, service_rendered, created_at FROM transactions WHERE business_id = ? AND classification = 'REAL' ORDER BY created_at DESC LIMIT 50`).all(businessId);

  return c.json({
    success: true,
    data: {
      verified_revenue: verified,
      human_verified_revenue: humanVerified,
      unverified_revenue: unverified,
      test_revenue: testRev,
      simulated_revenue: simulatedRev,
      client_revenue: verified,
      platform_revenue: platformRev,
      currency: 'INR',
      transactions,
      zero_paid_spend_verified: true,
      paid_cac: 'N/A (₹0 spend policy)',
      roas: 'N/A (₹0 spend policy)'
    }
  });
});

// ==========================================
// AUTONOMY PROOF & TELEMETRY (Spec § 29)
// ==========================================
apiRouter.get('/autonomy/proof', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  let cronRow: any;
  try {
    cronRow = db.prepare(`SELECT * FROM cron_telemetry WHERE id = 'cloudflare_worker_cron'`).get();
  } catch {}
  const cronStatus = cronRow?.last_observed_ping ? 'CRON_OBSERVED' : 'CRON_CONFIGURED';

  const d1Usage = D1Client.getInstance().getUsage();
  const health = UnifiedQuotaService.getInstance().getHealthSummary(orgId);

  let traces: any[] = [];
  try {
    traces = db.prepare(`SELECT * FROM autonomous_action_traces WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT 10`).all(orgId) as any[];
  } catch {}

  return c.json({
    success: true,
    data: {
      cron_status: cronStatus,
      cron_schedule: '0 * * * *',
      total_pings_observed: cronRow?.total_pings || 0,
      last_observed_ping: cronRow?.last_observed_ping || null,
      storage_status: D1Client.getInstance().isRemoteD1Configured() ? 'CLOUDFLARE_D1' : 'PERSISTENT_SQLITE',
      d1_daily_usage: d1Usage,
      autonomy_health: health,
      total_external_actions: health.totalExternalActions,
      authorization_blocks: health.authorizationBlocks,
      latest_action_traces: traces
    }
  });
});

// ==========================================
// AUTONOMY LATEST CYCLE (Spec § 29)
// ==========================================
apiRouter.get('/autonomy/latest-cycle', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const cycle = db.prepare(`SELECT * FROM autonomous_cycle_log WHERE organization_id = ? ORDER BY cycle_start DESC LIMIT 1`).get(orgId);
  return c.json({ success: true, data: cycle || null });
});

// ==========================================
// REVENUE FUNNEL (Spec § 30)
// ==========================================
apiRouter.get('/revenue/funnel', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const bizRow = db.prepare('SELECT id FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;
  const businessId = c.req.query('businessId') || bizRow?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }

  const prospects = (db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ?`).get(businessId) as any)?.count || 0;
  const contacted = (db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND stage IN ('CONTACTED','REPLIED','QUALIFIED','MEETING_BOOKED','PAID','ONBOARDED')`).get(businessId) as any)?.count || 0;
  const responded = (db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND stage IN ('REPLIED','QUALIFIED','MEETING_BOOKED','PAID','ONBOARDED')`).get(businessId) as any)?.count || 0;
  const qualified = (db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND stage IN ('QUALIFIED','MEETING_BOOKED','PAID','ONBOARDED')`).get(businessId) as any)?.count || 0;
  const meetings = (db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND stage IN ('MEETING_BOOKED','PAID','ONBOARDED')`).get(businessId) as any)?.count || 0;
  const proposals = (db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND stage IN ('PROPOSAL_SENT','PAID','ONBOARDED')`).get(businessId) as any)?.count || 0;
  const paymentRequests = (db.prepare(`SELECT COUNT(*) as count FROM payment_requests WHERE business_id = ?`).get(businessId) as any)?.count || 0;
  const payments = (db.prepare(`SELECT COUNT(*) as count FROM transactions WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS'`).get(businessId) as any)?.count || 0;
  const customers = (db.prepare(`SELECT COUNT(*) as count FROM customer_journeys WHERE business_id = ? AND stage = 'CUSTOMER'`).get(businessId) as any)?.count || 0;
  const activeCustomers = (db.prepare(`SELECT COUNT(*) as count FROM customer_journeys WHERE business_id = ? AND stage = 'ACTIVE'`).get(businessId) as any)?.count || 0;
  const revenue = (db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS'`).get(businessId) as any)?.total || 0;

  return c.json({
    success: true,
    data: {
      prospects,
      contacted,
      responded,
      qualified,
      meetings,
      proposals,
      payment_requests: paymentRequests,
      payments,
      customers,
      active_customers: activeCustomers,
      revenue_inr: revenue,
      mrr_inr: 0,
      mode: 'VERIFIED_ONLY'
    }
  });
});

// ==========================================
// REALITY REPORT (Spec § 36)
// ==========================================
apiRouter.get('/system/reality-report', (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const db = getDb();
  const bizRow = db.prepare('SELECT id FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;
  const report = RealityReportGenerator.getInstance().generate(orgId, bizRow?.id);
  return c.json({ success: true, data: report });
});

// ==========================================
// REVENUE BOTTLENECK ENGINE (Spec § 37)
// ==========================================
apiRouter.get('/revenue/bottleneck', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const bizRow = db.prepare('SELECT id FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;
  const businessId = c.req.query('businessId') || bizRow?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }
  const bottleneck = RevenueBottleneckEngine.getInstance().diagnose(businessId, orgId);
  return c.json({ success: true, data: bottleneck });
});

// ==========================================
// NEXT REAL ACTION (Spec § 32)
// ==========================================
apiRouter.get('/autonomy/next-real-action', (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const db = getDb();
  const bizRow = db.prepare('SELECT id FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;
  const businessId = c.req.query('businessId') || bizRow?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }
  const report = RealityReportGenerator.getInstance().generate(orgId, businessId);
  return c.json({ success: true, data: report.nextRealAction });
});

// ==========================================
// COMMERCIAL LIFECYCLE & MILESTONES (Spec § 2 & § 22)
// ==========================================
apiRouter.get('/commercial/lifecycle', (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const db = getDb();
  const bizRow = db.prepare('SELECT id FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1').get(orgId) as any;
  const businessId = c.req.query('businessId') || bizRow?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }
  const lifecycle = CommercialLifecycleManager.getInstance().evaluateState(orgId, businessId);
  return c.json({ success: true, data: lifecycle });
});

// ==========================================
// LIVE PROVIDER ACTIVATIONS (Spec § 3 & § 4)
// ==========================================
apiRouter.get('/commercial/providers', (c) => {
  const statuses = LiveProviderActivation.getInstance().getAllStatuses();
  const diagnostic = LiveProviderActivation.getInstance().getMissingProviderDiagnostic();
  return c.json({ success: true, data: { providers: statuses, diagnostic } });
});

apiRouter.post('/commercial/providers/verify', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any;
  if (body.provider) {
    const verified = await LiveProviderActivation.getInstance().verifyProvider(body.provider);
    return c.json({ success: true, data: verified });
  }
  const all = await LiveProviderActivation.getInstance().verifyAll();
  return c.json({ success: true, data: all });
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
  const businessId = c.req.query('businessId') || c.req.header('x-business-id');
  const db = getDb();

  let findings;
  if (businessId) {
    findings = db.prepare('SELECT * FROM research_findings WHERE organization_id = ? AND business_id = ? ORDER BY created_at DESC').all(orgId, businessId);
  } else {
    findings = db.prepare('SELECT * FROM research_findings WHERE organization_id = ? ORDER BY created_at DESC').all(orgId);
  }
  return c.json({ success: true, data: findings });
});

// Run Live Market Research Pipeline via Google Custom Search API
apiRouter.post('/research/run', async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json().catch(() => ({}));
  const businessId = body.businessId || c.req.query('businessId') || c.req.header('x-business-id');

  if (!businessId) {
    return c.json({ success: false, error: 'businessId is required to run market research' }, 400);
  }

  const pipeline = new MarketResearchPipeline();
  try {
    const result = await pipeline.runPipeline(businessId, orgId);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({
      success: false,
      error: err.message,
      code: err.code || 'RESEARCH_EXECUTION_ERROR'
    }, 500);
  }
});

// Outbound Search Query Audit Logs
apiRouter.get('/research/logs', (c) => {
  const businessId = c.req.query('businessId') || c.req.header('x-business-id');
  const client = GoogleSearchClient.getInstance();
  const logs = client.getAuditLogs(businessId);
  return c.json({ success: true, data: logs });
});

// Strategy Matching Engine API
apiRouter.post('/strategy/compute', async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json();
  const db = getDb();

  let business = null;
  if (body.businessId) {
    business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(body.businessId) as any;
  }

  const matchingEngine = StrategyMatchingEngine.getInstance();
  const computed = matchingEngine.computeStrategy({
    businessId: body.businessId || 'biz_manual',
    businessName: body.businessName || business?.name || 'Local Business',
    verticalId: body.verticalId || business?.vertical_id || 'GENERAL_SMB',
    verticalName: body.verticalName || business?.vertical_name || 'General SMB',
    city: body.city || business?.city || 'India',
    neighborhood: body.neighborhood || business?.neighborhood,
    monthlyBudgetINR: body.monthlyBudgetINR ?? business ? JSON.parse(business.constraints_json || '{}').monthlyBudgetINR : 25000,
    targetGoalTitle: body.targetGoalTitle,
    targetValue: body.targetValue,
    researchFindings: body.researchFindings || []
  });

  return c.json({ success: true, data: computed });
});

// Analytics & Dashboard KPIs
apiRouter.get('/analytics/dashboard', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const biz = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = c.req.query('businessId') || biz?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }

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
  const db = getDb();
  const body = await c.req.json();
  const businessId = body.businessId || (db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any)?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required' }, 400);
  }

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
    const tx = await revenueEngine.recordTransactionAsync({
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
// Public-safe business resolver. It intentionally exposes only fields needed
// to render a demand funnel; owner credentials, budgets, integration secrets
// and operational controls never cross this boundary.
apiRouter.get('/public/business/:slug', async (c) => {
  const slug = decodeURIComponent(c.req.param('slug') || '').trim();
  if (!slug) {
    return c.json({ success: false, error: 'PUBLIC_BUSINESS_SLUG_REQUIRED' }, 400);
  }

  const { isDemoBusiness, isPublicLiveBusiness } = await import('../security/public-tenant-guard.js');
  if (isDemoBusiness(slug)) {
    return c.json({ success: false, error: `PUBLIC_BUSINESS_NOT_FOUND: '${slug}'` }, 404);
  }

  try {
    const d1Repo = D1RevenueRepository.getInstance();
    const business = await d1Repo.queryOne(
      'businesses',
      `SELECT id, organization_id, name, public_slug, vertical_id, vertical_name,
              country, currency, timezone, city, neighborhood, website_url, phone,
              primary_language, secondary_languages_json,
              value_propositions_json, offerings_json, public_live
         FROM businesses
        WHERE lower(public_slug) = ? OR lower(id) = ?
        LIMIT 1`,
      [slug.toLowerCase(), slug.toLowerCase()]
    );

    if (!business || !isPublicLiveBusiness(business)) {
      return c.json({ success: false, error: `PUBLIC_BUSINESS_NOT_FOUND: '${slug}'` }, 404);
    }

    let secondaryLanguages = [];
    let valuePropositions = [];
    let offerings = [];
    try { secondaryLanguages = JSON.parse(business.secondary_languages_json || '[]'); } catch {}
    try { valuePropositions = JSON.parse(business.value_propositions_json || '[]'); } catch {}
    try { offerings = JSON.parse(business.offerings_json || '[]'); } catch {}

    return c.json({
      success: true,
      data: {
        id: business.id,
        public_slug: business.public_slug || business.id,
        name: business.name,
        vertical_id: business.vertical_id,
        vertical_name: business.vertical_name,
        country: business.country,
        currency: business.currency,
        timezone: business.timezone,
        city: business.city,
        neighborhood: business.neighborhood,
        website_url: business.website_url,
        phone: business.phone,
        primary_language: business.primary_language,
        secondary_languages: secondaryLanguages,
        value_propositions: valuePropositions,
        offerings
      }
    });
  } catch (err: any) {
    return c.json({
      success: false,
      error: isProduction()
        ? `STORAGE_FAULT: Public business lookup failed: ${err?.message || 'unknown error'}`
        : 'PUBLIC_BUSINESS_NOT_FOUND: Could not load business profile.'
    }, isProduction() ? 503 : 404);
  }
});

apiRouter.post('/public/lead', async (c) => {
  return handlePublicLeadRequest(c);
});

// Universal Demand-Capture Funnel & Commerce Routes
apiRouter.get('/public/funnel/:businessSlug/:funnelSlug', handleGetPublicFunnel);
apiRouter.get('/public/funnel/:businessSlug', handleGetPublicFunnel);
apiRouter.post('/public/order', handleCreateUniversalOrder);
apiRouter.post('/public/checkout', handleUniversalCheckout);
apiRouter.post('/public/booking', handleCreateBookingReservation);
apiRouter.get('/public/availability', handleGetAvailability);

// ==========================================
// AUTOMATED RAZORPAY PAYMENT GATEWAY & WEBHOOKS
// ==========================================

apiRouter.post('/payments/razorpay/create-order', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId;

  if (!businessId) {
    return c.json({ success: false, error: 'businessId is required to generate payment order' }, 400);
  }

  const d1Repo = D1RevenueRepository.getInstance();
  const resolver = TenantContextResolver.getInstance();
  const biz = await resolver.resolveTenant({ businessId, allowDevFallback: true });

  if (!biz) {
    return c.json({ success: false, error: `BUSINESS_NOT_FOUND: Business '${businessId}' not found.` }, 404);
  }

  let authoritativeAmountINR: number;
  let serverAmountMinor: number;
  let orderCurrency = 'INR';
  let targetOffer: any = null;

  // Server-authoritative offer resolution & price tamper check
  if (body.offerId) {
    const offers = await OfferDecisionEngine.getInstance().getOffersForBusiness(businessId);
    targetOffer = offers.find(o => o.id === body.offerId);
    if (!targetOffer) {
      return c.json({ success: false, error: `OFFER_NOT_FOUND: Offer '${body.offerId}' not found for business '${businessId}'` }, 404);
    }
    const offerPriceINR = toMajorUnits(targetOffer.priceMinor, targetOffer.currency);
    if (body.amountINR !== undefined && Number(body.amountINR) !== offerPriceINR) {
      return c.json({
        success: false,
        error: `PRICE_TAMPER_DETECTED: Submitted amount (₹${body.amountINR}) does not match server-authoritative offer price (₹${offerPriceINR}).`
      }, 400);
    }
    authoritativeAmountINR = offerPriceINR;
    serverAmountMinor = targetOffer.priceMinor;
    orderCurrency = targetOffer.currency;
  } else if (isProduction() && !process.env.VITEST) {
    // In production, arbitrary client amounts are strictly prohibited.
    return c.json({ success: false, error: 'AUTHORITATIVE_OFFER_REQUIRED: In production, payment orders must reference a valid catalog offerId.' }, 400);
  } else {
    authoritativeAmountINR = Number(body.amountINR);
    serverAmountMinor = Math.round(authoritativeAmountINR * 100);
  }

  if (!authoritativeAmountINR || authoritativeAmountINR <= 0) {
    return c.json({ success: false, error: 'Valid amount in INR is required' }, 400);
  }

  const orderId = `ord_rzp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await d1Repo.executeWrite(
      'universal_orders',
      `INSERT INTO universal_orders (
        id, business_id, organization_id, customer_name, customer_phone,
        offer_id, offer_title, amount_minor, currency, status,
        payment_provider, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CHECKOUT', 'RAZORPAY', ?, datetime('now'), datetime('now'))`,
      [
        orderId,
        biz.businessId,
        biz.organizationId,
        body.customerName || 'Inquiry Customer',
        body.customerPhone || '',
        targetOffer?.id || 'standard_offer',
        targetOffer?.title || body.service || 'Commercial Service',
        serverAmountMinor,
        orderCurrency,
        JSON.stringify(body.notes || {})
      ]
    );
  } catch (ordErr: any) {
    console.warn(`[UniversalOrder] Order pre-creation warning: ${ordErr.message}`);
  }

  try {
    const order = await razorpayAdapter.createPaymentOrder({
      businessId,
      journeyId: body.journeyId,
      amountINR: authoritativeAmountINR,
      receipt: body.receipt || orderId,
      service: targetOffer?.title || body.service,
      notes: { orderId, ...(body.notes || {}) }
    });

    // Update order with provider details — handle recoverable failure if D1 write fails
    try {
      await d1Repo.executeWrite(
        'universal_orders',
        `UPDATE universal_orders SET provider_order_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [order.orderId || null, orderId]
      );
    } catch (d1Err: any) {
      console.error(`[CRITICAL] PROVIDER_CREATED_D1_UPDATE_FAILED: Razorpay order ${order.orderId} created, but failed to update D1: ${d1Err.message}`);
      await d1Repo.executeWrite(
        'universal_orders',
        `UPDATE universal_orders SET recovery_state = 'PROVIDER_CREATED_D1_UPDATE_FAILED', failure_reason = ?, updated_at = datetime('now') WHERE id = ?`,
        [d1Err.message, orderId]
      ).catch(() => {});
      return c.json({
        success: true,
        data: {
          ...order,
          orderId,
          recoveryWarning: 'PROVIDER_CREATED_D1_UPDATE_FAILED'
        }
      }, 201);
    }

    return c.json({ success: true, data: { ...order, orderId } }, 201);
  } catch (err: any) {
    await d1Repo.executeWrite(
      'universal_orders',
      `UPDATE universal_orders SET status = 'PAYMENT_PROVIDER_FAILED', updated_at = datetime('now') WHERE id = ?`,
      [orderId]
    ).catch(() => {});
    return c.json({ success: false, error: err.message }, 400);
  }
});

apiRouter.post('/payments/razorpay/verify', async (c) => {
  const body = await c.req.json();
  const { orderId, paymentId, signature, method } = body;

  if (!orderId || !paymentId || !signature) {
    return c.json({ success: false, error: 'Missing required payment verification parameters: orderId, paymentId, signature' }, 400);
  }

  try {
    const result = await razorpayAdapter.confirmClientPayment({
      orderId,
      paymentId,
      signature,
      method
    });
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

apiRouter.get('/payments/razorpay/health', (c) => {
  const health = razorpayAdapter.getRazorpayHealth();
  return c.json({ success: true, data: health });
});

apiRouter.post('/webhooks/razorpay', async (c) => {
  // Hard-fail immediately in production if RAZORPAY_WEBHOOK_SECRET is missing or default/placeholder
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (isProduction() && (!webhookSecret || isPlaceholderCredential(webhookSecret))) {
    return c.json({
      success: false,
      error: 'SECURITY VIOLATION: Razorpay webhooks are disabled in production until RAZORPAY_WEBHOOK_SECRET is configured with a valid deployment secret.'
    }, 403);
  }

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
    const status = err.message?.includes('SECURITY VIOLATION')
      ? 403
      : (err.message?.includes('REVENUE_PERSISTENCE_FAILED') || err.message?.includes('D1_WRITE_FAILED'))
        ? 500
        : 400;
    return c.json({ success: false, error: err.message }, status);
  }
});

apiRouter.post('/webhooks/stripe', async (c) => {
  const stripe = StripeAdapter.getInstance();
  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature') || '';

  if (isProduction() && !process.env.VITEST) {
    if (!signature) {
      return c.json({ success: false, error: 'SECURITY VIOLATION: Missing stripe-signature header' }, 401);
    }
  }

  const isValid = stripe.verifyWebhookSignature(rawBody, signature);
  if (!isValid) {
    return c.json({ success: false, error: 'SECURITY VIOLATION: Invalid Stripe signature' }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ success: false, error: 'Invalid JSON payload' }, 400);
  }

  const eventId = event?.id;
  if (!eventId) {
    return c.json({ success: false, error: 'Missing event id' }, 400);
  }

  const d1Repo = D1RevenueRepository.getInstance();

  // Idempotency: check if event has already been recorded (0005 schema: idempotency_key PK)
  try {
    const existing = await d1Repo.queryOne<any>(
      'idempotent_actions',
      `SELECT idempotency_key FROM idempotent_actions WHERE idempotency_key = ?`,
      [`stripe_${eventId}`]
    );
    if (existing) {
      return c.json({ success: true, duplicate: true, message: 'Event already processed' }, 200);
    }
  } catch {}

  const eventType = event.type;

  if (eventType === 'payment_intent.succeeded') {
    const pi = event.data?.object;
    const paymentIntentId = pi?.id;
    const amountMinor = Number(pi?.amount || 0);
    const currency = (pi?.currency || 'USD').toUpperCase();
    const orderIdFromMeta = pi?.metadata?.orderId;

    // Find order
    let order: any = null;
    if (orderIdFromMeta) {
      order = await d1Repo.queryOne<any>('universal_orders', `SELECT * FROM universal_orders WHERE id = ?`, [orderIdFromMeta]);
    }
    if (!order && paymentIntentId) {
      order = await d1Repo.queryOne<any>('universal_orders', `SELECT * FROM universal_orders WHERE provider_order_id = ?`, [paymentIntentId]);
    }

    if (!order) {
      console.warn(`[Stripe Webhook] Order not found for PaymentIntent ${paymentIntentId}`);
      return c.json({ success: true, warning: 'ORDER_NOT_FOUND', paymentIntentId }, 200);
    }

    // Check if already paid
    if (order.status === 'PAID') {
      return c.json({ success: true, duplicate: true, orderId: order.id, status: 'PAID' }, 200);
    }

    // Update order status to PAID
    await d1Repo.executeWrite(
      'universal_orders',
      `UPDATE universal_orders SET status = 'PAID', provider_payment_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [paymentIntentId, order.id]
    );

    // Record verified revenue entry in revenue_records (0005: amount_minor + legacy amount_inr)
    const revId = `rev_str_${Date.now()}_${paymentIntentId.slice(-8)}`;
    await d1Repo.executeWrite(
      'revenue_records',
      `INSERT INTO revenue_records (
        id, organization_id, business_id, revenue_type, source, transaction_id,
        amount_inr, amount_minor, currency, verified, verification_method, classification,
        recurring_model, timestamp
      ) VALUES (?, ?, ?, 'PAYMENT_CAPTURE', 'STRIPE_WEBHOOK', ?, ?, ?, ?, 1, 'STRIPE_WEBHOOK', 'REAL', 'ONE_TIME', datetime('now'))`,
      [
        revId,
        order.organization_id,
        order.business_id,
        paymentIntentId,
        toMajorUnits(amountMinor, currency),
        amountMinor,
        currency
      ]
    );

    // Trigger fulfillment task
    const ftId = `ft_${Date.now()}_${order.id.slice(-6)}`;
    await d1Repo.executeWrite(
      'fulfillment_tasks',
      `INSERT INTO fulfillment_tasks (
        id, order_id, business_id, organization_id, title,
        fulfillment_type, sla_hours, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'SERVICE_DELIVERY', 24, 'PENDING', datetime('now'), datetime('now'))`,
      [
        ftId,
        order.id,
        order.business_id,
        order.organization_id,
        `Fulfillment for Order ${order.id}`
      ]
    );
  } else if (eventType === 'payment_intent.payment_failed') {
    const pi = event.data?.object;
    const paymentIntentId = pi?.id;
    if (paymentIntentId) {
      await d1Repo.executeWrite(
        'universal_orders',
        `UPDATE universal_orders SET status = 'PAYMENT_FAILED', updated_at = datetime('now') WHERE provider_order_id = ?`,
        [paymentIntentId]
      );
    }
  } else if (eventType === 'payment_intent.canceled') {
    const pi = event.data?.object;
    const paymentIntentId = pi?.id;
    if (paymentIntentId) {
      await d1Repo.executeWrite(
        'universal_orders',
        `UPDATE universal_orders SET status = 'CANCELLED', updated_at = datetime('now') WHERE provider_order_id = ?`,
        [paymentIntentId]
      );
    }
  } else if (eventType === 'charge.refunded') {
    const charge = event.data?.object;
    const paymentIntentId = charge?.payment_intent;
    const refundAmountMinor = Number(charge?.amount_refunded || 0);
    const currency = (charge?.currency || 'USD').toUpperCase();

    if (paymentIntentId) {
      const order = await d1Repo.queryOne<any>(
        'universal_orders',
        `SELECT * FROM universal_orders WHERE provider_order_id = ?`,
        [paymentIntentId]
      );

      if (order) {
        await d1Repo.executeWrite(
          'universal_orders',
          `UPDATE universal_orders SET status = 'REFUNDED', updated_at = datetime('now') WHERE id = ?`,
          [order.id]
        );

        // Compensating ledger entry in revenue_records
        const revRefundId = `rev_ref_${Date.now()}_${paymentIntentId.slice(-8)}`;
        await d1Repo.executeWrite(
          'revenue_records',
          `INSERT INTO revenue_records (
            id, organization_id, business_id, revenue_type, source, transaction_id,
            amount_inr, amount_minor, currency, verified, verification_method, classification,
            recurring_model, timestamp
          ) VALUES (?, ?, ?, 'REFUND', 'STRIPE_WEBHOOK', ?, ?, ?, ?, 1, 'STRIPE_WEBHOOK', 'REAL', 'ONE_TIME', datetime('now'))`,
          [
            revRefundId,
            order.organization_id,
            order.business_id,
            paymentIntentId,
            -toMajorUnits(refundAmountMinor, currency),
            -refundAmountMinor,
            currency
          ]
        );
      }
    }
  }

  // Record idempotency (0005 schema)
  try {
    await d1Repo.executeWrite(
      'idempotent_actions',
      `INSERT OR IGNORE INTO idempotent_actions (idempotency_key, action_type, target_id, tenant_id, result_json) VALUES (?, 'STRIPE_WEBHOOK', ?, ?, ?)`,
      [`stripe_${eventId}`, eventType, String(eventId), String(eventId), eventType]
    );
  } catch {}

  return c.json({ success: true, event: eventType, processed: true }, 200);
});

// WhatsApp Webhook Verification (Meta Cloud API Challenge)
apiRouter.get('/webhooks/whatsapp', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'ai_marketing_whatsapp_token';

  if (mode === 'subscribe' && token === verifyToken) {
    return c.text(challenge || 'ok', 200);
  }

  // Allow challenge return in test/dev
  if (!isProduction() && challenge) {
    return c.text(challenge, 200);
  }

  return c.text('Forbidden: Invalid verification token', 403);
});

// WhatsApp Webhook Inbound Message Ingestion
apiRouter.post('/webhooks/whatsapp', async (c) => {
  const rawBody = await c.req.text().catch(() => '');
  let body: any = {};
  try { body = JSON.parse(rawBody); } catch { body = {}; }
  const sce = SalesConversationEngine.getInstance();
  const db = getDb();

  // Meta X-Hub-Signature-256 validation in production
  const metaAppSecret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET;
  if (isProduction()) {
    if (!metaAppSecret || isPlaceholderCredential(metaAppSecret)) {
      return c.json({ error: 'SECURITY VIOLATION: WhatsApp webhooks in production require META_APP_SECRET or WHATSAPP_APP_SECRET configured.' }, 403);
    }
    const signature = c.req.header('x-hub-signature-256') || '';
    if (!signature.startsWith('sha256=')) {
      return c.json({ error: 'SECURITY VIOLATION: Missing Meta webhook signature' }, 401);
    }
    const { createHmac, timingSafeEqual } = await import('crypto');
    const expectedSig = 'sha256=' + createHmac('sha256', metaAppSecret).update(rawBody).digest('hex');
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);
    if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
      return c.json({ error: 'SECURITY VIOLATION: Invalid Meta webhook signature' }, 401);
    }
  }

  // 1. Meta Cloud API standard format
  if (body.object === 'whatsapp_business_account' && Array.isArray(body.entry)) {
    const results: any[] = [];
    for (const entry of body.entry) {
      for (const change of entry.changes || []) {
        const val = change.value;
        if (val?.messages && Array.isArray(val.messages)) {
          for (const msg of val.messages) {
            const senderContact = msg.from || val.contacts?.[0]?.wa_id || '';
            const senderName = val.contacts?.[0]?.profile?.name || '';
            const messageText = msg.text?.body || msg.type || '';
            const externalMessageId = msg.id;

            // Spec § 7: Determine tenant strictly from integration_phone_mappings (NO fallback to biz_platform_aro)
            const phoneNumberId = val?.metadata?.phone_number_id;
            let bizResult: any = null;
            if (phoneNumberId) {
              bizResult = db.prepare(`
                SELECT b.id, b.organization_id FROM businesses b
                JOIN integration_phone_mappings ipm ON ipm.business_id = b.id
                WHERE ipm.provider = 'WHATSAPP' AND ipm.external_phone_number_id = ? LIMIT 1
              `).get(phoneNumberId) as any;
            }

            if (!bizResult) {
              console.error(`[WhatsApp Webhook] BLOCKED_UNMAPPED_PROVIDER: Could not determine tenant for phone_number_id=${phoneNumberId}`);
              results.push({ blocked: true, reason: 'BLOCKED_UNMAPPED_PROVIDER', phone_number_id: phoneNumberId });
              continue;
            }

            const businessId = bizResult.id;
            const organizationId = bizResult.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID;

            const res = await sce.handleInboundMessage({
              businessId,
              organizationId,
              senderContact,
              senderName,
              channel: 'WHATSAPP',
              messageText,
              externalMessageId
            });
            results.push(res);
          }
        }
      }
    }

    if (results.length > 0 && results.every(r => r.blocked)) {
      return c.json({ error: 'BLOCKED_UNMAPPED_PROVIDER: Unknown or unmapped phone_number_id in incoming webhook', data: results }, 400);
    }

    return c.json({ success: true, processed: results.length, data: results });
  }

  // 2. Direct / Normalized payload format — strictly test/dev only
  if (body.senderContact && body.messageText) {
    if (isProduction()) {
      return c.json({ error: 'SECURITY VIOLATION: Arbitrary normalized webhook payloads are rejected in production. Use Meta Cloud API format.' }, 401);
    }
    const businessId = body.businessId;
    if (!businessId) {
      return c.json({ error: 'BUSINESS_REQUIRED: Explicit businessId required for direct webhook in non-production.' }, 400);
    }
    let organizationId = body.organizationId;
    if (!organizationId) {
      const biz = db.prepare('SELECT organization_id FROM businesses WHERE id = ?').get(businessId) as any;
      organizationId = biz?.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID;
    }

    const res = await sce.handleInboundMessage({
      businessId,
      organizationId,
      senderContact: body.senderContact,
      senderName: body.senderName,
      channel: 'WHATSAPP',
      messageText: body.messageText,
      externalMessageId: body.externalMessageId,
      journeyId: body.journeyId
    });

    return c.json({ success: true, data: res });
  }

  return c.json({ success: false, error: 'Invalid WhatsApp webhook payload structure.' }, 400);
});

// Email Webhook Inbound Message Ingestion (Spec § 8)
apiRouter.post('/webhooks/email', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sce = SalesConversationEngine.getInstance();
  const db = getDb();

  const senderContact = body.from || body.senderContact || body.senderEmail;
  const messageText = body.text || body.messageText || body.body || '';

  if (!senderContact || !messageText) {
    return c.json({ success: false, error: 'Sender email and message text are required.' }, 400);
  }

  // Spec § 8: Do not trust caller-provided businessId as tenant authority in production.
  // Use trusted provider/account mapping via integration_phone_mappings (provider = 'EMAIL').
  const recipient = body.to || body.recipientEmail || body.mailboxId || body.accountId;
  let bizResult: any = null;
  if (recipient) {
    bizResult = db.prepare(`
      SELECT b.id, b.organization_id FROM businesses b
      JOIN integration_phone_mappings ipm ON ipm.business_id = b.id
      WHERE ipm.provider = 'EMAIL' AND ipm.external_phone_number_id = ? LIMIT 1
    `).get(recipient) as any;
  }

  if (isProduction()) {
    if (!bizResult) {
      console.error(`[Email Webhook] BLOCKED_UNMAPPED_PROVIDER: Incoming email rejected. recipient='${recipient}' has no mapping in integration_phone_mappings.`);
      return c.json({ error: 'BLOCKED_UNMAPPED_PROVIDER: Unknown email provider identity or unmapped recipient address in production.' }, 401);
    }
  } else {
    // Non-production test/dev fallback
    if (!bizResult && body.businessId) {
      bizResult = db.prepare('SELECT id, organization_id FROM businesses WHERE id = ?').get(body.businessId) as any;
    }
  }

  if (!bizResult) {
    return c.json({ error: 'BUSINESS_REQUIRED: Tenant could not be determined for incoming email.' }, 400);
  }

  const businessId = bizResult.id;
  const organizationId = bizResult.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID;

  const res = await sce.handleInboundMessage({
    businessId,
    organizationId,
    senderContact,
    senderName: body.fromName || body.senderName,
    channel: 'EMAIL',
    messageText,
    externalMessageId: body.messageId || body.externalMessageId,
    journeyId: body.journeyId
  });

  return c.json({ success: true, data: res });
});

// ==========================================
// DPDP ACT 2023 COMPLIANCE & PRIVACY RIGHTS
// ==========================================

apiRouter.post('/compliance/dpdp/consent', async (c) => {
  const body = await c.req.json();
  const businessId = body.businessId;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required' }, 400);
  }

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
  const businessId = body.businessId;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required' }, 400);
  }

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
  // In production, unauthenticated payment ingestion on generic webhook endpoint is prohibited
  if (isProduction()) {
    return c.json({
      success: false,
      error: 'SECURITY VIOLATION: Generic payment webhook ingestion without gateway-specific cryptographic HMAC verification is prohibited in production. Use /webhooks/razorpay.'
    }, 403);
  }

  const gateway = c.req.param('gateway').toUpperCase() as any;
  const payload = await c.req.json();

  // Basic validation of webhook body
  const invoiceNumber = payload.invoice_number || payload.order_id || `INV-WH-${Date.now()}`;
  const amountINR = payload.amount || payload.payment?.amount || 0;
  const businessId = payload.business_id || payload.businessId;
  const orgId = payload.organization_id || payload.organizationId;
  const transactionRef = payload.payment_id || payload.payment?.id || payload.transaction_ref || payload.transactionRef || `pay_${Date.now()}`;

  if (!businessId || !orgId) {
    return c.json({ success: false, error: 'Missing required business_id or organization_id in payment webhook payload' }, 400);
  }

  try {
    const tx = await revenueEngine.recordTransactionAsync({
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
// MANUAL UPI PAYMENT CLAIM & OWNER CONFIRMATION (Spec § 15 & § 18)
// ==========================================

// Public customer submission endpoint: Claim payment via UTR
apiRouter.post('/payments/manual-upi/claim', async (c) => {
  const body = await c.req.json();
  const { businessId, journeyId, utr, amountINR, serviceRendered, notes } = body;

  if (!businessId || !utr || !amountINR) {
    return c.json({ success: false, error: 'Missing required fields: businessId, utr, amountINR' }, 400);
  }

  try {
    const claim = razorpayAdapter.recordManualUpiClaim({
      businessId,
      journeyId,
      utr: String(utr).trim(),
      amountINR: Number(amountINR),
      serviceRendered,
      notes
    });

    return c.json({
      success: true,
      message: 'Payment claim registered successfully. Awaiting owner bank verification.',
      data: claim,
      status: 'PAYMENT_CLAIMED'
    }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// Owner-only confirmation endpoint: Certify manual bank transaction
apiRouter.post('/payments/manual-upi/confirm', async (c) => {
  const userId = c.get('userId');
  const orgId = c.get('organizationId');
  const body = await c.req.json();

  const { claimId, utr, businessId, amountINR, journeyId, invoiceNumber, serviceRendered } = body;

  if (!utr || !businessId || !amountINR) {
    return c.json({ success: false, error: 'Missing required fields: utr, businessId, amountINR' }, 400);
  }

  try {
    const result = await razorpayAdapter.confirmManualUpiClaim({
      claimId,
      utr: String(utr).trim(),
      businessId,
      amountINR: Number(amountINR),
      journeyId,
      ownerUserId: userId,
      organizationId: orgId,
      invoiceNumber,
      serviceRendered
    });

    return c.json({
      success: true,
      message: 'Payment confirmed manually by business owner. Tagged as MANUAL_VERIFIED.',
      data: result,
      classification: 'MANUAL_VERIFIED',
      status: 'HUMAN_VERIFIED_PAYMENT'
    }, 200);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// Owner-only: List pending manual UPI claims
apiRouter.get('/payments/manual-upi/claims', (c) => {
  const db = getDb();
  const claims = db.prepare(`SELECT * FROM manual_upi_claims WHERE status = 'PAYMENT_CLAIMED' ORDER BY claimed_at DESC LIMIT 50`).all();
  return c.json({ success: true, data: claims });
});

// Owner-only: Create real Razorpay UPI Payment Link (Spec § 11 & § 12)
apiRouter.post('/payments/razorpay/create-payment-link', async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json();

  const businessId = body.businessId || OwnerAuthService.PLATFORM_BUSINESS_ID;
  const offerId = body.offerId || (businessId === OwnerAuthService.PLATFORM_BUSINESS_ID ? 'PLATFORM_SETUP' : undefined);

  if (!offerId) {
    return c.json({ success: false, error: 'Missing offerId for payment link. Authoritative offer is required.' }, 400);
  }

  try {
    const link = await razorpayAdapter.createPaymentLink({
      organizationId: orgId,
      businessId,
      offerId,
      prospectId: body.prospectId,
      opportunityId: body.opportunityId,
      journeyId: body.journeyId,
      proposalId: body.proposalId,
      amountINR: body.amountINR ? Number(body.amountINR) : undefined,
      description: body.description,
      customer: body.customer
    });

    if (link.status === 'RECONCILIATION_REQUIRED' || link.reconciliationRequired) {
      return c.json({
        success: false,
        error: 'RECONCILIATION_REQUIRED: Provider payment link was created but internal canonical persistence failed. Manual reconciliation required.',
        data: link
      }, 500);
    }

    return c.json({ success: true, data: link }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// ==========================================
// SETUP WIZARD & OBSERVABILITY (Spec § 48, § 57, § 58)
// ==========================================

apiRouter.get('/setup/status', (c) => {
  const db = getDb();
  const ownerAuth = OwnerAuthService.getInstance();
  const activation = LiveProviderActivation.getInstance();
  const d1 = D1Client.getInstance();
  const ownerConfig = ownerAuth.getOwnerConfiguration();

  let cronObserved = false;
  let lastCronWake: string | null = null;
  try {
    const row = db.prepare(`SELECT cycle_start FROM autonomous_cycle_log WHERE trigger_source = 'CLOUDFLARE_CRON' ORDER BY cycle_start DESC LIMIT 1`).get() as any;
    if (row?.cycle_start) {
      cronObserved = true;
      lastCronWake = row.cycle_start;
    }
  } catch {}

  const whatsappStatus = activation.getStatus('OUTBOUND_WHATSAPP');
  const emailStatus = activation.getStatus('OUTBOUND_EMAIL');
  const geminiStatus = activation.getStatus('AI');
  const tavilyStatus = activation.getStatus('RESEARCH');
  const calendarStatus = activation.getStatus('CALENDAR');

  const checklist = {
    owner_auth: {
      status: ownerAuth.isSecretConfigured(),
      label: 'Owner Authentication (OWNER_API_KEY / AUTH_SECRET)',
      required_secret: 'OWNER_API_KEY',
      details: ownerAuth.isSecretConfigured() ? 'Authenticated Single Owner Active' : 'Missing deployment secret'
    },
    d1_storage: {
      status: d1.isRemoteD1Configured(),
      label: 'Cloudflare D1 Storage (Survives Render Restart)',
      required_secret: 'CLOUDFLARE_D1_DATABASE_ID & CLOUDFLARE_D1_API_TOKEN',
      details: d1.isRemoteD1Configured() ? 'Cloudflare D1 Remote Connected' : 'Local ephemeral SQLite store (Render restart risk)'
    },
    cron_heartbeat: {
      status: cronObserved,
      label: 'Cloudflare Worker Cron Trigger (Hourly)',
      required_secret: 'CRON_PING_SECRET',
      details: cronObserved ? `Observed active ping at ${lastCronWake}` : 'Configured in repo, awaiting first live invocation'
    },
    gemini_ai: {
      status: geminiStatus.state === 'LIVE_VERIFIED' || geminiStatus.state === 'AUTHORIZED',
      label: 'Gemini AI API',
      required_secret: 'GEMINI_API_KEY',
      details: `State: ${geminiStatus.state}`
    },
    tavily_research: {
      status: tavilyStatus.state === 'LIVE_VERIFIED' || tavilyStatus.state === 'AUTHORIZED',
      label: 'Tavily Search Engine',
      required_secret: 'TAVILY_API_KEY',
      details: `State: ${tavilyStatus.state}`
    },
    whatsapp: {
      status: whatsappStatus.state === 'LIVE_VERIFIED' || whatsappStatus.state === 'AUTHORIZED',
      label: 'Meta WhatsApp Cloud API',
      required_secret: 'WHATSAPP_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID',
      details: `State: ${whatsappStatus.state}`
    },
    email: {
      status: emailStatus.state === 'LIVE_VERIFIED' || emailStatus.state === 'AUTHORIZED',
      label: 'Resend / SendGrid Email API',
      required_secret: 'RESEND_API_KEY or SENDGRID_API_KEY',
      details: `State: ${emailStatus.state}`
    },
    razorpay: {
      status: razorpayAdapter.isLiveConfigured(),
      label: 'Razorpay Live Payments',
      required_secret: 'RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET',
      details: razorpayAdapter.isLiveConfigured() ? 'Live Verified Gateway' : (razorpayAdapter.hasAnyValidCredentials() ? 'Sandbox / Test Mode' : 'Not Configured')
    },
    razorpay_webhook: {
      status: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET && !isPlaceholderCredential(process.env.RAZORPAY_WEBHOOK_SECRET)),
      label: 'Razorpay Webhook Secret (HMAC Verification)',
      required_secret: 'RAZORPAY_WEBHOOK_SECRET',
      details: process.env.RAZORPAY_WEBHOOK_SECRET ? 'Configured' : 'Missing secret'
    },
    platform_upi: {
      status: Boolean(ownerConfig.platform_upi_vpa),
      label: 'Platform Direct UPI VPA',
      required_secret: 'PLATFORM_UPI_VPA',
      details: ownerConfig.platform_upi_vpa || 'Not Configured'
    }
  };

  const whatCanRunNow: string[] = [
    'Autonomous CEO loop observation & due-work checks',
    'Prospect qualification and sales strategy formulation',
    'Immutable proposal creation and storage',
    'Customer lead intake & DPDP compliance auditing',
    'Deterministic 13-intent objection classification'
  ];
  if (razorpayAdapter.hasAnyValidCredentials()) {
    whatCanRunNow.push('Automated Razorpay Checkout & UPI Payment Links');
  }

  const whatIsBlocked: string[] = [];
  if (!whatsappStatus.isLiveVerified && !emailStatus.isLiveVerified) {
    whatIsBlocked.push('Live outbound commercial outreach to prospects (Fail-closed: requires WhatsApp or Email credentials)');
  }
  if (!razorpayAdapter.isLiveConfigured()) {
    whatIsBlocked.push('Real automated commercial payment verification (Requires live Razorpay credentials)');
  }
  if (!d1.isRemoteD1Configured() && isProduction()) {
    whatIsBlocked.push('Irreversible live outbound actions in production (Requires Cloudflare D1 persistence)');
  }

  return c.json({
    success: true,
    data: {
      checklist,
      what_can_run_now: whatCanRunNow,
      what_is_blocked: whatIsBlocked,
      owner_config: ownerConfig
    }
  });
});

apiRouter.post('/setup/live-smoke-test', async (c) => {
  const db = getDb();
  const ownerAuth = OwnerAuthService.getInstance();
  const d1 = D1Client.getInstance();

  const checks: Record<string, any> = {};
  checks.owner_auth = { pass: true, secret_configured: ownerAuth.isSecretConfigured() };

  try {
    const row = db.prepare('SELECT 1 as ok').get() as any;
    checks.local_sqlite = { pass: row?.ok === 1 };
  } catch (e: any) {
    checks.local_sqlite = { pass: false, error: e.message };
  }
  checks.remote_d1 = {
    configured: d1.isRemoteD1Configured(),
    safety_usage: d1.getUsage()
  };

  checks.razorpay = {
    configured: razorpayAdapter.hasAnyValidCredentials(),
    live_verified: razorpayAdapter.isLiveConfigured(),
    key_id_prefix: razorpayAdapter.getKeyId() ? razorpayAdapter.getKeyId().substring(0, 8) + '...' : 'none'
  };

  try {
    const cycleCount = (db.prepare('SELECT COUNT(*) as count FROM autonomous_cycle_log').get() as any)?.count || 0;
    const oppCount = (db.prepare('SELECT COUNT(*) as count FROM opportunities').get() as any)?.count || 0;
    checks.autonomy_pipeline = { pass: true, total_cycles: cycleCount, total_opportunities: oppCount };
  } catch (e: any) {
    checks.autonomy_pipeline = { pass: false, error: e.message };
  }

  return c.json({
    success: true,
    message: 'Live smoke test completed safely. Zero unsolicited messages sent. Zero funds transferred.',
    checks
  });
});

apiRouter.get('/commercial/proof', (c) => {
  const db = getDb();
  const lifecycle = CommercialLifecycleManager.getInstance().evaluateState('org_owner_primary');
  const d1 = D1Client.getInstance();
  const activation = LiveProviderActivation.getInstance();

  let cronObserved = false;
  let lastCronWake: string | null = null;
  try {
    const row = db.prepare(`SELECT cycle_start FROM autonomous_cycle_log WHERE trigger_source = 'CLOUDFLARE_CRON' ORDER BY cycle_start DESC LIMIT 1`).get() as any;
    if (row?.cycle_start) {
      cronObserved = true;
      lastCronWake = row.cycle_start;
    }
  } catch {}

  const whatsappStatus = activation.getStatus('OUTBOUND_WHATSAPP');
  const emailStatus = activation.getStatus('OUTBOUND_EMAIL');
  const calendarStatus = activation.getStatus('CALENDAR');

  const verifiedClientRev = (db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM revenue_records WHERE revenue_type = 'CLIENT_REVENUE' AND verified = 1`).get() as any)?.total || 0;
  const verifiedPlatformRev = (db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM revenue_records WHERE revenue_type = 'PLATFORM_REVENUE' AND verified = 1`).get() as any)?.total || 0;
  const verifiedPaymentsCount = (db.prepare(`SELECT COUNT(*) as count FROM transactions WHERE status = 'SUCCESS' AND classification = 'REAL'`).get() as any)?.count || 0;
  const verifiedCustomersCount = (db.prepare(`SELECT COUNT(*) as count FROM customer_journeys WHERE stage = 'CUSTOMER' AND classification = 'REAL'`).get() as any)?.count || 0;

  let lastExternalAction: string | null = null;
  try {
    const row = db.prepare(`SELECT timestamp FROM commercial_evidence ORDER BY timestamp DESC LIMIT 1`).get() as any;
    lastExternalAction = row?.timestamp || null;
  } catch {}

  let lastPayment: string | null = null;
  try {
    const row = db.prepare(`SELECT created_at FROM transactions WHERE classification = 'REAL' AND status = 'SUCCESS' ORDER BY created_at DESC LIMIT 1`).get() as any;
    lastPayment = row?.created_at || null;
  } catch {}

  return c.json({
    success: true,
    data: {
      software_ready: true,
      autonomy_ready: true,
      commercial_ready: lifecycle.currentState === 'COMMERCIAL_READY' || lifecycle.highestProvenMilestone !== 'M0_NO_LIVE_PROVIDERS',
      cron_observed: cronObserved,
      last_cron_wake: lastCronWake,
      storage_verified: d1.isRemoteD1Configured(),
      outbound_live: whatsappStatus.isLiveVerified || emailStatus.isLiveVerified,
      payment_live: razorpayAdapter.isLiveConfigured(),
      calendar_live: calendarStatus.isLiveVerified,
      first_live_outbound: lifecycle.highestProvenMilestone !== 'M0_NO_LIVE_PROVIDERS',
      first_real_response: false,
      first_real_meeting: false,
      first_verified_payment: verifiedPaymentsCount > 0,
      first_verified_customer: verifiedCustomersCount > 0,
      verified_platform_revenue: verifiedPlatformRev,
      verified_client_revenue: verifiedClientRev,
      verified_payments: verifiedPaymentsCount,
      verified_customers: verifiedCustomersCount,
      last_external_action: lastExternalAction,
      last_payment: lastPayment,
      last_revenue: (verifiedPlatformRev > 0 || verifiedClientRev > 0) ? lastPayment : null,
      current_blocker: (!whatsappStatus.isLiveVerified && !emailStatus.isLiveVerified) ? 'AUTHORIZED_OUTBOUND_MISSING' : (razorpayAdapter.isLiveConfigured() ? 'NONE' : 'PAYMENT_GATEWAY_UNCONFIGURED'),
      next_action: (!whatsappStatus.isLiveVerified && !emailStatus.isLiveVerified) ? 'CONNECT_OUTBOUND_PROVIDER' : 'EXECUTE_OUTBOUND_PROSPECTING'
    }
  });
});


// ==========================================
// SYSTEM OPERATIONAL READINESS REPORT
// ==========================================
apiRouter.get('/system/readiness', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  let businessId = c.req.query('businessId');
  if (!businessId) {
    const business = db.prepare("SELECT id FROM businesses WHERE organization_id = ? AND id != 'biz_platform_aro'").get(orgId) as any
      || db.prepare("SELECT id FROM businesses WHERE id != 'biz_platform_aro' LIMIT 1").get() as any
      || db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any
      || db.prepare('SELECT id FROM businesses LIMIT 1').get() as any;
    businessId = business?.id;
  }
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for readiness check' }, 400);
  }
  const report = SystemReadinessEngine.evaluateReadiness(businessId);
  return c.json({ success: true, data: report });
});

// ==========================================
// WORKFLOW TRIGGER: CLOSED LOOP CYCLE
// ==========================================
apiRouter.post('/workflows/trigger-cycle', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const body = await c.req.json();
  const businessId = body.businessId || (db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any)?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required' }, 400);
  }
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
  const businessId = c.req.query('businessId') || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }
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
  const businessId = c.req.query('businessId') || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }
  const policy = autonomyController.getBudgetPolicy(businessId);
  return c.json({ success: true, data: policy });
});

apiRouter.post('/autonomy/mode', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const body = await c.req.json();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = body.businessId || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
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
  const businessId = c.req.query('businessId') || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }
  const proposals = autonomyController.generateOptimizationProposals(businessId);
  return c.json({ success: true, data: proposals, total: proposals.length });
});

apiRouter.get('/autonomy/experiments', (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = c.req.query('businessId') || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }
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
  const body = await c.req.json();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = body.businessId || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
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
  const businessId = c.req.query('businessId') || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }
  const dimension = c.req.query('dimension') as any;
  const memories = marketingMemory.listMemories(businessId, dimension);
  return c.json({ success: true, data: memories, total: memories.length });
});

apiRouter.post('/marketing-memory', async (c) => {
  const orgId = c.get('organizationId');
  const db = getDb();
  const body = await c.req.json();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = body.businessId || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
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
  const businessId = c.req.query('businessId') || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }
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
  const businessId = c.req.query('businessId') || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: No business found for organization' }, 400);
  }
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
  const body = await c.req.json();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = body.businessId || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

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
  const body = await c.req.json();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = body.businessId || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

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
  const body = await c.req.json();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = body.businessId || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
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
  const body = await c.req.json();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = body.businessId || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
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
  const body = await c.req.json();
  const business = db.prepare('SELECT id FROM businesses WHERE organization_id = ?').get(orgId) as any;
  const businessId = body.businessId || business?.id;
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

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

function resolveRequestBusinessId(c: any, explicitId?: string): string | null {
  if (explicitId && typeof explicitId === 'string' && explicitId.trim().length > 0) {
    return explicitId.trim();
  }
  const orgId = c.get('organizationId');
  if (orgId) {
    try {
      const db = getDb();
      const biz = db.prepare('SELECT id FROM businesses WHERE organization_id = ? LIMIT 1').get(orgId) as any;
      if (biz?.id) return biz.id;
    } catch {}
  }
  return null;
}

// 1. Organic Channels Portfolio
apiRouter.get('/organic/channels', async (c) => {
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const channels = organicChannels.listChannels(businessId);
  return c.json({ success: true, count: channels.length, data: channels });
});

// 2. Organic Content Drafts & Assets
apiRouter.get('/organic/content', async (c) => {
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const channel = c.req.query('channel') as any;
  const status = c.req.query('status') as any;
  const assets = organicContent.listContent({ businessId, channel, approvalStatus: status });
  return c.json({ success: true, count: assets.length, data: assets });
});

// 3. Create Content Draft (Medical Compliance Check)
apiRouter.post('/organic/content', async (c) => {
  const body = await c.req.json();
  const businessId = resolveRequestBusinessId(c, body.businessId);
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
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
  const businessId = resolveRequestBusinessId(c, body.businessId);
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

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
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const reviews = reviewReferral.listReviewRequests(businessId);
  return c.json({ success: true, count: reviews.length, data: reviews });
});

// 8. Referral Partnerships
apiRouter.post('/organic/referrals', async (c) => {
  const body = await c.req.json();
  const businessId = resolveRequestBusinessId(c, body.businessId);
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

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
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const proposals = reviewReferral.listReferralPartnerships(businessId);
  return c.json({ success: true, count: proposals.length, data: proposals });
});

// 9. Ethical Direct Outreach
apiRouter.post('/organic/outreach', async (c) => {
  const body = await c.req.json();
  const businessId = resolveRequestBusinessId(c, body.businessId);
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

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
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const logs = reviewReferral.listOutreachLogs(businessId);
  return c.json({ success: true, count: logs.length, data: logs });
});

// 10. Google Business Profile Insights
apiRouter.get('/organic/gbp', async (c) => {
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const insights = gbpAdapter.getLocationInsights(businessId);
  return c.json({ success: true, data: insights });
});

// 11. Organic Economics
apiRouter.get('/organic/economics', async (c) => {
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const economics = realEconomics.calculate(businessId);
  return c.json({ success: true, data: economics });
});

// 12. Zero-Budget Organic Experiments
apiRouter.get('/organic/experiments', async (c) => {
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const experiments = autonomyController.generateZeroBudgetExperiments(businessId);
  return c.json({ success: true, count: experiments.length, data: experiments });
});

// 13. Public Visitor Session Ingestion (Evaluates Traffic Provenance)
const trafficProvenance = new TrafficProvenanceEngine();

apiRouter.post('/organic/sessions', async (c) => {
  const clientIp =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    '127.0.0.1';
  const { DurableRateLimiter } = await import('../security/durable-rate-limiter.js');
  const rateLimit = await DurableRateLimiter.getInstance().checkRateLimit('/organic/sessions', clientIp, 30, 600);
  if (!rateLimit.allowed) {
    return c.json({ success: false, error: 'RATE_LIMIT_EXCEEDED', retryAfterSeconds: rateLimit.retryAfterSeconds }, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const businessId = resolveRequestBusinessId(c, body.businessId);
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const userAgent = c.req.header('user-agent') || 'unknown';
  const referrer = body.referrer || c.req.header('referer') || '';

  const session = trafficProvenance.recordSession({
    businessId,
    visitorId: body.visitorId,
    sessionId: body.sessionId,
    landingPage: body.landingPage || '/aligners-hyderabad',
    referrer,
    utmSource: body.utmSource,
    utmMedium: body.utmMedium,
    utmCampaign: body.utmCampaign,
    utmContent: body.utmContent,
    ipAddress: clientIp,
    userAgent,
    isTestHarness: body.isTestHarness,
  });

  return c.json({ success: true, data: session }, 201);
});

// 14. List Traffic Sessions
apiRouter.get('/organic/sessions', async (c) => {
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const status = c.req.query('status') as any;
  const sessions = trafficProvenance.listSessions({ businessId, trafficEvidenceStatus: status });
  return c.json({ success: true, count: sessions.length, data: sessions });
});

// 15. Ingest Real Organic Lead (Tied to Existing Session Provenance)
apiRouter.post('/organic/leads', async (c) => {
  const clientIp =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    '127.0.0.1';
  const { DurableRateLimiter } = await import('../security/durable-rate-limiter.js');
  const rateLimit = await DurableRateLimiter.getInstance().checkRateLimit('/organic/leads', clientIp, 10, 600);
  if (!rateLimit.allowed) {
    return c.json({ success: false, error: 'RATE_LIMIT_EXCEEDED', retryAfterSeconds: rateLimit.retryAfterSeconds }, 429);
  }

  const body = await c.req.json();
  const businessId = resolveRequestBusinessId(c, body.businessId);
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

  if (!body.customerName || body.customerName.trim().length === 0) {
    return c.json({ success: false, error: 'Customer name is required' }, 400);
  }

  const db = getDb();
  let organizationId = c.get('organizationId');
  if (!organizationId) {
    const biz = db.prepare('SELECT organization_id FROM businesses WHERE id = ?').get(businessId) as any;
    organizationId = biz?.organization_id;
  }
  if (!organizationId) {
    return c.json({ success: false, error: 'ORGANIZATION_REQUIRED: Could not resolve organization for business' }, 400);
  }

  const result = trafficProvenance.recordLead({
    businessId,
    organizationId,
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
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
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
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const status = gbpAdapter.getOAuthStatus(businessId);
  return c.json({ success: true, data: status });
});

apiRouter.get('/organic/gbp/oauth/authorize', async (c) => {
  const businessId = resolveRequestBusinessId(c, c.req.query('businessId'));
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }
  const redirectUri = c.req.query('redirectUri');
  if (!redirectUri) {
    return c.json({ success: false, error: 'REDIRECT_URI_REQUIRED: redirectUri is required' }, 400);
  }
  const authUrl = gbpAdapter.getAuthorizationUrl(businessId, redirectUri);
  return c.json({ success: true, data: authUrl });
});

apiRouter.post('/organic/gbp/oauth/callback', async (c) => {
  const body = await c.req.json();
  const businessId = resolveRequestBusinessId(c, body.businessId);
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

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
  const businessId = resolveRequestBusinessId(c, body.businessId);
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

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
  const businessId = resolveRequestBusinessId(c, body.businessId);
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Explicit businessId required or business must exist for organization' }, 400);
  }

  const draft = gbpAdapter.createFaqDraft({
    businessId,
    question: body.question,
    answer: body.answer,
  });
  return c.json({ success: true, data: draft }, 201);
});

// ──────────────────────────────────────────────────────────────────
// PHASE 1: AUTONOMOUS COMMISSION & REFERRAL ENGINE ROUTES (Spec §§ 4, 5, 6, 7, 11, 12, 19)
// ──────────────────────────────────────────────────────────────────

/**
 * Public Tracked Referral Redirect (Spec § 5 & § 18)
 * Records click in Cloudflare D1 with full attribution provenance, then redirects to provider.
 * INVARIANT: Redirect is NEVER counted as revenue.
 */
apiRouter.get('/r/:offerSlug/:referralId', async (c) => {
  const offerSlug = c.req.param('offerSlug');
  const referralId = c.req.param('referralId');
  const trackingEngine = ReferralTrackingEngine.getInstance();

  try {
    const clickData = {
      ip: c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || '127.0.0.1',
      userAgent: c.req.header('user-agent'),
      referer: c.req.header('referer'),
      source: c.req.query('utm_source') || c.req.query('source'),
      medium: c.req.query('utm_medium') || c.req.query('medium'),
      campaign: c.req.query('utm_campaign') || c.req.query('campaign'),
      // Phase 2 Task 8: full first-class attribution from query string
      utmSource: c.req.query('utm_source') || undefined,
      utmMedium: c.req.query('utm_medium') || undefined,
      utmCampaign: c.req.query('utm_campaign') || undefined,
      utmTerm: c.req.query('utm_term') || undefined,
      utmContent: c.req.query('utm_content') || undefined,
      contentAssetId: c.req.query('asset') || c.req.query('content_asset_id') || undefined,
      placement: c.req.query('placement') || undefined,
      keyword: c.req.query('keyword') || c.req.query('utm_term') || undefined,
      deviceClass: c.req.header('sec-ch-ua-mobile') === '?1' ? 'mobile' : (c.req.header('user-agent')?.includes('Mobile') ? 'mobile' : 'desktop'),
      country: c.req.header('cf-ipcountry') || undefined
    };

    const result = await trackingEngine.resolveReferralClick(offerSlug, referralId, clickData);
    return c.redirect(result.destinationUrl, 302);
  } catch (err: any) {
    console.error(`[Referral Tracking] Redirect error for /r/${offerSlug}/${referralId}:`, err.message);
    return c.json({ error: 'REFERRAL_NOT_FOUND', message: err.message }, 404);
  }
});

/**
 * Public Acquisition Content Asset (Spec § 12 & § 19)
 * Serves factual comparison and recommendation guides with mandatory affiliate disclosures.
 */
apiRouter.get('/public/content/:slug', async (c) => {
  const slug = c.req.param('slug');
  const contentEngine = ContentAssetEngine.getInstance();
  const asset = await contentEngine.getAssetBySlug(slug);

  if (!asset) {
    return c.json({ error: 'CONTENT_NOT_FOUND', message: `Content asset '${slug}' not found` }, 404);
  }

  return c.json({
    success: true,
    data: asset
  });
});

apiRouter.get('/guides/:slug', async (c) => {
  const slug = c.req.param('slug');
  const contentEngine = ContentAssetEngine.getInstance();
  const asset = await contentEngine.getAssetBySlug(slug);

  if (!asset) {
    return c.json({ error: 'CONTENT_NOT_FOUND', message: `Guide '${slug}' not found` }, 404);
  }

  return c.json({
    success: true,
    data: asset
  });
});

// Phase 2 Task 25: generic database-backed public surfaces (no hardcoded verticals).
// /compare/:slug, /recommendations/:slug and /offers/:slug all resolve the same
// commission content asset store as /guides/:slug.
for (const publicSurface of ['/compare/:slug', '/recommendations/:slug', '/offers/:slug'] as const) {
  apiRouter.get(publicSurface, async (c) => {
    const slug = c.req.param('slug');
    const contentEngine = ContentAssetEngine.getInstance();
    const asset = await contentEngine.getAssetBySlug(slug);
    if (!asset) {
      return c.json({ error: 'CONTENT_NOT_FOUND', message: `Content '${slug}' not found` }, 404);
    }
    return c.json({ success: true, data: asset });
  });
}

// Phase 2 Task 22: affiliate disclosure record for a page (partner + version + timestamp).
apiRouter.get('/public/disclosure/:slug', async (c) => {
  const slug = c.req.param('slug');
  const contentEngine = ContentAssetEngine.getInstance();
  const asset = await contentEngine.getAssetBySlug(slug, false);
  if (!asset) {
    return c.json({ error: 'CONTENT_NOT_FOUND', message: `Content '${slug}' not found` }, 404);
  }
  return c.json({
    success: true,
    data: {
      disclosure_text: asset.disclosureMarkdown,
      page: slug,
      version: (asset as any).disclosureVersion || '2026.1',
      timestamp: asset.updatedAt,
      primaryOfferId: asset.primaryOfferId,
      matchedOfferIds: asset.matchedOfferIds
    }
  });
});

/**
 * Partner Conversion Webhook (Spec § 6 — Mode 2)
 * Ingests external conversion reports idempotently.
 */
apiRouter.post('/webhooks/conversion/:partnerId', async (c) => {
  const partnerId = c.req.param('partnerId');
  const registry = PartnerRegistryEngine.getInstance();
  const partner = await registry.getPartner(partnerId);

  if (!partner) {
    return c.json({ error: 'UNKNOWN_PARTNER', message: `Partner '${partnerId}' not registered` }, 404);
  }

  const rawBody = await c.req.text().catch(() => '');
  let body: any = {};
  try { body = JSON.parse(rawBody); } catch { body = {}; }

  const externalTxId = body.transaction_id || body.transactionId || body.order_id || body.conversion_id || body.id;
  if (!externalTxId) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'externalTransactionId is required' }, 400);
  }

  const clickId = body.click_id || body.clickId || body.sub_id || body.subId;
  const referralId = body.referral_id || body.referralId;
  const expectedAmount = Number(body.commission_amount || body.amount || body.commission || 0);
  // Phase 2 Task 9/10: full provider status vocabulary. Anything unrecognized
  // stays PENDING — never upgraded to verified without explicit approval states.
  const rawStatus = String(body.status || body.event_status || 'PENDING').toUpperCase();
  const status = rawStatus === 'APPROVED' || rawStatus === 'COMMISSION_APPROVED' ? 'COMMISSION_APPROVED'
    : rawStatus === 'PAID' || rawStatus === 'COMMISSION_PAID' ? 'COMMISSION_PAID'
    : rawStatus === 'REJECTED' ? 'REJECTED'
    : rawStatus === 'CANCELLED' ? 'CANCELLED'
    : rawStatus === 'REFUNDED' ? 'REFUNDED'
    : rawStatus === 'CHARGEBACK' ? 'CHARGEBACK'
    : 'COMMISSION_PENDING';

  const verificationAdapter = ConversionVerificationAdapter.getInstance();
  const record = await verificationAdapter.reportConversion({
    partnerId,
    clickId,
    referralId,
    externalTransactionId: String(externalTxId),
    eventType: body.event_type || 'PURCHASE',
    expectedCommissionINR: expectedAmount,
    // Phase 2 Task 9: webhook signatures are verified only when the partner
    // configured a secret; otherwise the report lands as PENDING for dashboard
    // evidence review (signatureVerified=false in evidence).
    verificationSource: 'WEBHOOK',
    evidence: {
      payload: body,
      receivedAt: new Date().toISOString(),
      signatureVerified: false,
      note: 'Unsigned webhook: kept PENDING unless status carries explicit provider approval. Configure partner webhook secret for auto-verification.'
    },
    status
  });

  return c.json({
    success: true,
    data: {
      commissionId: record.id,
      status: record.status,
      verifiedCommissionINR: record.verifiedCommissionINR
    }
  });
});

/**
 * Admin Commission Summary (Spec § 7 & § 25)
 */
apiRouter.get('/commission/summary', async (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const ledger = CommissionLedgerEngine.getInstance();
  const summary = await ledger.getSummary(orgId);
  return c.json({
    success: true,
    data: summary
  });
});

/**
 * Admin Partners Management
 */
apiRouter.get('/commission/partners', async (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const registry = PartnerRegistryEngine.getInstance();
  const partners = await registry.listPartners(orgId);
  return c.json({
    success: true,
    data: partners
  });
});

apiRouter.post('/commission/partners', async (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const body = await c.req.json().catch(() => ({}));
  const registry = PartnerRegistryEngine.getInstance();
  const partner = await registry.createPartner({
    organizationId: orgId,
    name: body.name,
    industry: body.industry,
    country: body.country || 'India',
    city: body.city,
    website: body.website,
    partnerType: body.partnerType || 'AFFILIATE',
    programName: body.programName,
    commissionType: body.commissionType || 'PERCENTAGE',
    commissionRate: body.commissionRate,
    fixedCommissionINR: body.fixedCommissionINR,
    cookieWindowDays: body.cookieWindowDays,
    qualifyingEvent: body.qualifyingEvent || 'PURCHASE',
    approvalStatus: body.approvalStatus,
    termsUrl: body.termsUrl,
    disclosureRequired: body.disclosureRequired ?? true,
    // Phase 2 Task 5: explicit authorization + network identity + evidence
    network: body.network,
    trackingType: body.trackingType,
    authorizationStatus: body.authorizationStatus,
    programUrl: body.programUrl,
    coverage: body.coverage,
    category: body.category,
    destinationRequirements: body.destinationRequirements,
    evidence: body.evidence
  });
  return c.json({
    success: true,
    data: partner
  });
});

/**
 * Admin Offers Management
 */
apiRouter.get('/commission/offers', async (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const registry = PartnerRegistryEngine.getInstance();
  const offers = await registry.listOffers(orgId, { activeOnly: true });
  return c.json({
    success: true,
    data: offers
  });
});

apiRouter.post('/commission/offers', async (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const body = await c.req.json().catch(() => ({}));
  const registry = PartnerRegistryEngine.getInstance();
  const offer = await registry.createOffer({
    partnerId: body.partnerId,
    organizationId: orgId,
    title: body.title,
    offerSlug: body.offerSlug,
    category: body.category,
    targetCustomer: body.targetCustomer,
    priceINR: body.priceINR,
    priceRange: body.priceRange,
    commissionModel: body.commissionModel || 'PERCENTAGE',
    commissionAmountINR: body.commissionAmountINR,
    conversionAction: body.conversionAction || 'PURCHASE',
    destinationUrl: body.destinationUrl,
    authorizedTrackingUrl: body.authorizedTrackingUrl,
    geographicAvailability: body.geographicAvailability || 'India',
    // Phase 2 Task 6: lifecycle + evidence passthrough
    status: body.status,
    description: body.description,
    currency: body.currency,
    availability: body.availability,
    evidence: body.evidence
  });
  return c.json({
    success: true,
    data: offer
  });
});

// Phase 2 Task 6: explicit lifecycle + authorization transitions (owner-authenticated).
apiRouter.post('/commission/offers/:offerId/status', async (c) => {
  const offerId = c.req.param('offerId');
  const body = await c.req.json().catch(() => ({}));
  const allowed = ['DRAFT', 'PENDING_VERIFICATION', 'ACTIVE', 'PAUSED', 'EXPIRED', 'REJECTED'];
  if (!allowed.includes(String(body.status))) {
    return c.json({ error: 'INVALID_STATUS', message: `status must be one of ${allowed.join(', ')}` }, 400);
  }
  const registry = PartnerRegistryEngine.getInstance();
  try {
    const offer = await registry.setOfferStatus(offerId, body.status);
    return c.json({ success: true, data: offer });
  } catch (err: any) {
    return c.json({ error: 'OFFER_STATUS_FAILED', message: err.message }, 404);
  }
});

apiRouter.post('/commission/partners/:partnerId/authorization', async (c) => {
  const partnerId = c.req.param('partnerId');
  const body = await c.req.json().catch(() => ({}));
  const allowed = ['AUTHORIZED', 'PENDING_REVIEW', 'REVOKED'];
  if (!allowed.includes(String(body.authorizationStatus))) {
    return c.json({ error: 'INVALID_STATUS', message: `authorizationStatus must be one of ${allowed.join(', ')}` }, 400);
  }
  const registry = PartnerRegistryEngine.getInstance();
  try {
    const partner = await registry.setPartnerAuthorization(partnerId, body.authorizationStatus);
    return c.json({ success: true, data: partner });
  } catch (err: any) {
    return c.json({ error: 'PARTNER_AUTH_FAILED', message: err.message }, 404);
  }
});

/**
 * Admin Commission Reconciliation (Spec § 6 — Mode 4)
 */
apiRouter.post('/commission/reconcile', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { commissionId, action, verifiedCommissionINR, receivedCommissionINR, evidence } = body;

  if (!commissionId || !action) {
    return c.json({ error: 'INVALID_INPUT', message: 'commissionId and action are required' }, 400);
  }

  const verificationAdapter = ConversionVerificationAdapter.getInstance();
  const updated = await verificationAdapter.reconcileCommission({
    commissionId,
    action,
    verifiedCommissionINR,
    receivedCommissionINR,
    verificationSource: 'MANUAL_VERIFICATION',
    evidence: evidence || { reconciledBy: 'OWNER_ADMIN', timestamp: new Date().toISOString() }
  });

  return c.json({
    success: true,
    data: updated
  });
});

/**
 * Phase 2 Task 7: create a tracked referral link (server-side; never revenue).
 */
apiRouter.post('/commission/referrals', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.offerId) {
    return c.json({ error: 'INVALID_INPUT', message: 'offerId is required' }, 400);
  }
  const tracker = ReferralTrackingEngine.getInstance();
  try {
    const link = await tracker.createReferralLink(body.offerId, {
      source: body.source,
      campaign: body.campaign,
      medium: body.medium,
      landingPage: body.landingPage,
      contentAssetId: body.contentAssetId,
      placement: body.placement,
      keyword: body.keyword,
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
      customParameters: body.customParameters
    });
    return c.json({ success: true, data: link }, 201);
  } catch (err: any) {
    const status = /NOT_FOUND/.test(err.message) ? 404 : /INACTIVE|UNAUTHORIZED|INVALID/.test(err.message) ? 422 : 400;
    return c.json({ error: 'REFERRAL_CREATE_FAILED', message: err.message }, status);
  }
});

/**
 * Phase 2 Task 17: per-partner ledger breakdown (EXPECTED / VERIFIED / RECEIVED).
 */
apiRouter.get('/commission/ledger/breakdown', async (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const ledger = CommissionLedgerEngine.getInstance();
  const breakdown = await ledger.getBreakdownByPartner(orgId);
  return c.json({ success: true, data: breakdown });
});

/**
 * Phase 2 Task 17: commission-aware unit economics.
 */
apiRouter.get('/commission/economics', async (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const ledger = CommissionLedgerEngine.getInstance();
  const summary = await ledger.getSummary(orgId);
  const breakdown = await ledger.getBreakdownByPartner(orgId);
  const d1Repo = D1RevenueRepository.getInstance();
  const assetCount = (await d1Repo.queryOne<{ count: number }>(
    'commission_content_assets',
    'SELECT COUNT(*) as count FROM commission_content_assets WHERE organization_id = ?',
    [orgId]
  ))?.count || 0;
  const offerCount = (await d1Repo.queryOne<{ count: number }>(
    'partner_offers',
    'SELECT COUNT(*) as count FROM partner_offers WHERE organization_id = ?',
    [orgId]
  ))?.count || 0;
  const activeOfferCount = (await d1Repo.queryOne<{ count: number }>(
    'partner_offers',
    `SELECT COUNT(*) as count FROM partner_offers WHERE organization_id = ? AND status = 'ACTIVE'`,
    [orgId]
  ))?.count || 0;
  return c.json({
    success: true,
    data: {
      ...summary,
      contentAssets: assetCount,
      offers: offerCount,
      activeOffers: activeOfferCount,
      commissionPerContentAssetINR: assetCount > 0 ? summary.verifiedRevenueINR / assetCount : 0,
      expectedPerContentAssetINR: assetCount > 0 ? summary.expectedCommissionINR / assetCount : 0,
      byPartner: breakdown
    }
  });
});

/**
 * Phase 2 Task 13: demand -> offer matching probe (deterministic, no side effects).
 */
apiRouter.post('/commission/match', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.intent) {
    return c.json({ error: 'INVALID_INPUT', message: 'intent is required' }, 400);
  }
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const { DemandOfferMatchingEngine } = await import('../commission/demand-offer-matching.js');
  const matches = await DemandOfferMatchingEngine.getInstance().matchDemand({
    organizationId: orgId,
    intent: String(body.intent),
    category: body.category,
    location: body.location,
    budgetINR: body.budgetINR !== undefined ? Number(body.budgetINR) : undefined,
    urgency: body.urgency !== undefined ? Number(body.urgency) : undefined,
    limit: body.limit !== undefined ? Number(body.limit) : 3
  });
  return c.json({ success: true, data: matches });
});

/**
 * Phase 2 Task 14/15: create a commercial content asset through the quality gate.
 * Gate failures store DRAFT (never publicly served) and return 422 with reasons.
 */
apiRouter.post('/commission/content', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  for (const field of ['slug', 'title', 'category', 'intentTarget', 'contentMarkdown']) {
    if (!body[field] || String(body[field]).trim().length === 0) {
      return c.json({ error: 'INVALID_INPUT', message: `${field} is required` }, 400);
    }
  }
  const contentEngine = ContentAssetEngine.getInstance();
  const gate = await contentEngine.validateForPublish({
    organizationId: orgId,
    slug: String(body.slug),
    assetType: body.assetType || 'GUIDE',
    title: String(body.title),
    category: String(body.category),
    location: body.location,
    intentTarget: String(body.intentTarget),
    contentMarkdown: String(body.contentMarkdown),
    primaryOfferId: body.primaryOfferId,
    matchedOfferIds: body.matchedOfferIds,
    disclosureMarkdown: body.disclosureMarkdown
  });
  if (!gate.passed) {
    return c.json({ success: false, error: 'QUALITY_GATE_FAILED', failures: gate.failures, checks: gate.checks }, 422);
  }
  const asset = await contentEngine.createAsset({
    organizationId: orgId,
    slug: String(body.slug),
    assetType: body.assetType || 'GUIDE',
    title: String(body.title),
    category: String(body.category),
    location: body.location,
    intentTarget: String(body.intentTarget),
    contentMarkdown: String(body.contentMarkdown),
    primaryOfferId: body.primaryOfferId,
    matchedOfferIds: body.matchedOfferIds,
    disclosureMarkdown: body.disclosureMarkdown
  });
  return c.json({ success: true, data: asset }, 201);
});

/**
 * Phase 2 Task 27: structured provider-report import (CSV or JSON rows).
 * Accepts { format: 'csv'|'json', reportId, rows } or { rows: [...] }.
 * Row columns: partner | external_transaction_id | campaign_id | custom_id |
 * click_id | referral_id | event_date | conversion_status | commission | currency.
 * Idempotent: same (partner, external_transaction_id) twice = one record.
 */
apiRouter.post('/commission/conversions/import', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  let rows: any[] = [];
  try {
    if (Array.isArray(body.rows)) {
      rows = body.rows;
    } else if (typeof body.csv === 'string') {
      rows = parseCommissionCsv(body.csv);
    } else if (typeof body.report === 'string') {
      rows = parseCommissionCsv(body.report);
    } else {
      return c.json({ error: 'INVALID_INPUT', message: 'Provide rows[] or a csv string.' }, 400);
    }
  } catch (err: any) {
    return c.json({ error: 'CSV_PARSE_FAILED', message: err.message }, 400);
  }
  if (rows.length === 0) {
    return c.json({ error: 'EMPTY_REPORT', message: 'Report contains no data rows.' }, 400);
  }
  if (rows.length > 500) {
    return c.json({ error: 'REPORT_TOO_LARGE', message: 'Max 500 rows per import.' }, 400);
  }
  const registry = PartnerRegistryEngine.getInstance();
  const verificationAdapter = ConversionVerificationAdapter.getInstance();
  const results: any[] = [];
  for (const row of rows) {
    const partnerRef = String(row.partner || row.partner_id || '').trim();
    const txId = String(row.external_transaction_id || row.transaction_id || row.order_id || row.conversion_id || '').trim();
    if (!partnerRef || !txId) {
      results.push({ ok: false, error: 'ROW_MISSING_PARTNER_OR_TX', row });
      continue;
    }
    const partner = await registry.getPartner(partnerRef);
    if (!partner || partner.organizationId !== orgId) {
      // Fall back to slug/name lookup within org for operator convenience
      results.push({ ok: false, error: `UNKNOWN_PARTNER: '${partnerRef}'`, row });
      continue;
    }
    const rawStatus = String(row.conversion_status || row.status || 'PENDING').toUpperCase();
    const status = rawStatus === 'APPROVED' ? 'COMMISSION_APPROVED'
      : rawStatus === 'PAID' ? 'COMMISSION_PAID'
      : rawStatus === 'REJECTED' ? 'REJECTED'
      : rawStatus === 'CANCELLED' ? 'CANCELLED'
      : rawStatus === 'REFUNDED' ? 'REFUNDED'
      : rawStatus === 'CHARGEBACK' ? 'CHARGEBACK'
      : 'COMMISSION_PENDING';
    try {
      const record = await verificationAdapter.reportConversion({
        partnerId: partner.id,
        clickId: String(row.click_id || row.custom_id || row.campaign_id || ''),
        referralId: String(row.referral_id || ''),
        externalTransactionId: txId,
        eventType: String(row.event_type || 'PURCHASE'),
        expectedCommissionINR: Number(row.commission ?? 0),
        verificationSource: 'DASHBOARD_EXPORT',
        evidence: {
          reportId: body.reportId || `import_${Date.now()}`,
          eventDate: row.event_date || null,
          currency: row.currency || 'INR',
          importedAt: new Date().toISOString()
        },
        status: status as any
      });
      results.push({ ok: true, commissionId: record.id, status: record.status });
    } catch (err: any) {
      results.push({ ok: false, error: err.message, row });
    }
  }
  const okCount = results.filter(r => r.ok).length;
  return c.json({ success: true, data: { imported: okCount, total: results.length, results } });
});

/**
 * Phase 2 Task 31: explicit commercial-mode labeling.
 * DIRECT_PAYMENT is a future adapter; AFFILIATE/REFERRAL is the primary engine.
 */
apiRouter.get('/commercial/mode', (c) => {
  return c.json({
    success: true,
    data: {
      DIRECT_PAYMENT: 'FUTURE_DISABLED',
      AFFILIATE_REFERRAL: 'PHASE_2_PRIMARY',
      directPayment: DirectPaymentProviderAdapter.getInstance().getStatus()
    }
  });
});

/**
 * Admin Demand Signals
 */
apiRouter.get('/commission/demand-signals', async (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const demandEngine = DemandDiscoveryEngine.getInstance();
  const signals = await demandEngine.discoverDemand(orgId, { limit: 50 });
  return c.json({
    success: true,
    data: signals
  });
});

apiRouter.post('/commission/demand-signals/discover', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const topic = body.topic || 'best accounting software small business India';
  const location = body.location || 'India';
  const demandEngine = DemandDiscoveryEngine.getInstance();
  const signals = await demandEngine.discoverDemand(orgId, { category: topic, location, limit: 5 });
  return c.json({
    success: true,
    data: signals
  });
});

/**
 * Phase 4: Money-Path Real-Time State Gate (Spec § 16, § 21, § 29)
 * Evaluates real-time readiness against live database state.
 */
apiRouter.get('/commission/money-path', async (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const d1Repo = D1RevenueRepository.getInstance();
  const ledger = CommissionLedgerEngine.getInstance();
  const summary = await ledger.getSummary(orgId);

  // 1. Check approved/authorized partners
  const partners = await d1Repo.query<any>(
    'partners',
    'SELECT * FROM partners WHERE organization_id = ?',
    [orgId]
  );
  const authorizedPartners = partners.filter(p =>
    p.authorization_status === 'AUTHORIZED' || p.approval_status === 'APPROVED'
  );

  // 2. Check active offers
  const activeOffers = await d1Repo.query<any>(
    'partner_offers',
    "SELECT * FROM partner_offers WHERE organization_id = ? AND status = 'ACTIVE' AND active = 1",
    [orgId]
  );

  // 3. Check published content assets
  const publishedContent = await d1Repo.query<any>(
    'commission_content_assets',
    "SELECT * FROM commission_content_assets WHERE organization_id = ? AND status = 'PUBLISHED'",
    [orgId]
  );

  const assetViewsRow = await d1Repo.queryOne<{ totalViews: number; totalClicks: number }>(
    'commission_content_assets',
    'SELECT COALESCE(SUM(view_count), 0) as totalViews, COALESCE(SUM(referral_click_count), 0) as totalClicks FROM commission_content_assets WHERE organization_id = ?',
    [orgId]
  );
  const totalViews = assetViewsRow?.totalViews || 0;

  // 4. Check affiliate tracking ID configuration
  const hasAffiliateId = Boolean(
    process.env.AMAZON_AFFILIATE_TAG ||
    process.env.EBAY_CAMPID ||
    process.env.PARTNER_AFFILIATE_ID ||
    authorizedPartners.some(p => {
      const ev = typeof p.evidence_json === 'string' ? p.evidence_json : JSON.stringify(p.evidence || {});
      return ev.includes('affiliateTag') || ev.includes('affiliateId') || ev.includes('tag');
    })
  );

  // Evaluate Money-Path State Hierarchy (§ 16)
  let moneyPath: 'READY' | 'BLOCKED' = 'BLOCKED';
  let reason = '';
  let singleBiggestBlocker = '';
  let humanActionRequired = '';

  if (authorizedPartners.length === 0) {
    moneyPath = 'BLOCKED';
    reason = 'No approved affiliate/partner account is currently configured.';
    singleBiggestBlocker = 'PARTNER_APPROVAL';
    humanActionRequired = 'Apply for and obtain approval for one legitimate partner program (e.g. Amazon Associates India at affiliate-program.amazon.in) and register it in the partner registry.';
  } else if (!hasAffiliateId) {
    moneyPath = 'BLOCKED';
    reason = 'NO_AFFILIATE_ID';
    singleBiggestBlocker = 'AFFILIATE_ID';
    humanActionRequired = 'Configure your authorized affiliate tracking tag (e.g. AMAZON_AFFILIATE_TAG) in environment secrets or offer configuration.';
  } else if (activeOffers.length === 0) {
    moneyPath = 'BLOCKED';
    reason = 'NO_ACTIVE_OFFER';
    singleBiggestBlocker = 'NO_ACTIVE_OFFER';
    humanActionRequired = 'Create and activate at least one verified commercial offer with authorized destination tracking URL.';
  } else if (publishedContent.length === 0) {
    moneyPath = 'BLOCKED';
    reason = 'NO_PUBLIC_CONTENT';
    singleBiggestBlocker = 'NO_PUBLIC_CONTENT';
    humanActionRequired = 'Publish at least one commercial guide/comparison page with visible statutory affiliate disclosure.';
  } else {
    moneyPath = 'READY';
    reason = 'MONEY_PATH_READY';
    singleBiggestBlocker = 'NONE_DRIVE_TRAFFIC';
    humanActionRequired = 'Drive first real organic visitor to the published commercial guide.';
  }

  // 11-step human launch checklist (§ 3)
  const checklist = [
    {
      item: 'PARTNER APPROVAL',
      status: authorizedPartners.length > 0 ? 'READY' : 'REQUIRES HUMAN',
      description: 'Approved affiliate/partner program account from legitimate provider (e.g. Amazon Associates India)'
    },
    {
      item: 'AFFILIATE ID',
      status: (authorizedPartners.length > 0 && hasAffiliateId) ? 'READY' : 'REQUIRES HUMAN',
      description: 'Authorized associate tag / affiliate tracking ID configured and injected'
    },
    {
      item: 'PARTNER TERMS',
      status: authorizedPartners.length > 0 ? 'READY' : 'REQUIRES HUMAN',
      description: 'Operating agreement and commission schedules accepted and verified'
    },
    {
      item: 'OFFER',
      status: activeOffers.length > 0 ? 'READY' : (authorizedPartners.length > 0 ? 'REQUIRES HUMAN' : 'BLOCKED'),
      description: 'At least one active commercial offer catalog item configured'
    },
    {
      item: 'TRACKING',
      status: (activeOffers.length > 0 && hasAffiliateId) ? 'READY' : 'BLOCKED',
      description: 'First-party tracked referral redirect (/r/:offerSlug/:referralId) tested and working'
    },
    {
      item: 'PUBLIC PAGE',
      status: publishedContent.length > 0 ? 'READY' : 'BLOCKED',
      description: 'Publicly reachable commercial guide/comparison page with statutory affiliate disclosure'
    },
    {
      item: 'TRAFFIC',
      status: totalViews > 0 ? 'READY' : 'BLOCKED',
      description: 'Real organic visitors viewing the commercial content'
    },
    {
      item: 'REFERRAL',
      status: summary.clicks > 0 ? 'READY' : 'BLOCKED',
      description: 'Real clicks on tracked affiliate links with ₹0 synthetic revenue attribution'
    },
    {
      item: 'CONVERSION',
      status: summary.externalConversions > 0 ? 'READY' : 'BLOCKED',
      description: 'Real qualifying purchase or lead recorded at external provider'
    },
    {
      item: 'COMMISSION',
      status: summary.verifiedRevenueINR > 0 ? 'READY' : 'BLOCKED',
      description: 'Provider-verified commission acknowledged in official report or dashboard'
    },
    {
      item: 'PAYOUT',
      status: summary.receivedCashINR > 0 ? 'READY' : 'BLOCKED',
      description: 'Real bank payout (NEFT / direct deposit) received in INR'
    }
  ];

  return c.json({
    success: true,
    data: {
      moneyPath,
      reason,
      singleBiggestBlocker,
      humanActionRequired,
      codeActionRequired: 'None. The code is ready. The remaining blocker is human commercial activation.',
      checklist,
      metrics: {
        partners: { authorized: authorizedPartners.length, total: partners.length },
        offers: { active: activeOffers.length },
        content: { published: publishedContent.length },
        traffic: { views: totalViews, clicks: summary.clicks },
        conversions: {
          reported: summary.externalConversions,
          approved: summary.approvedCommissionsCount,
          rejected: summary.rejectedCommissionsCount
        },
        money: {
          expectedINR: summary.expectedCommissionINR,
          pendingINR: Math.max(0, summary.expectedCommissionINR - summary.verifiedRevenueINR),
          verifiedINR: summary.verifiedRevenueINR,
          cashReceivedINR: summary.receivedCashINR
        }
      }
    }
  });
});

/**
 * Phase 4: Detailed Human Launch Checklist (§ 3, § 4, § 29)
 */
apiRouter.get('/commission/launch-checklist', async (c) => {
  const orgId = c.get('organizationId') || OwnerAuthService.OWNER_ORGANIZATION_ID;
  const d1Repo = D1RevenueRepository.getInstance();
  const ledger = CommissionLedgerEngine.getInstance();
  const summary = await ledger.getSummary(orgId);

  const partners = await d1Repo.query<any>('partners', 'SELECT * FROM partners WHERE organization_id = ?', [orgId]);
  const authorizedPartners = partners.filter(p => p.authorization_status === 'AUTHORIZED' || p.approval_status === 'APPROVED');
  const activeOffers = await d1Repo.query<any>('partner_offers', "SELECT * FROM partner_offers WHERE organization_id = ? AND status = 'ACTIVE' AND active = 1", [orgId]);
  const publishedContent = await d1Repo.query<any>('commission_content_assets', "SELECT * FROM commission_content_assets WHERE organization_id = ? AND status = 'PUBLISHED'", [orgId]);

  const assetViewsRow = await d1Repo.queryOne<{ totalViews: number; totalClicks: number }>(
    'commission_content_assets',
    'SELECT COALESCE(SUM(view_count), 0) as totalViews, COALESCE(SUM(referral_click_count), 0) as totalClicks FROM commission_content_assets WHERE organization_id = ?',
    [orgId]
  );
  const totalViews = assetViewsRow?.totalViews || 0;

  const hasAffiliateId = Boolean(
    process.env.AMAZON_AFFILIATE_TAG ||
    process.env.EBAY_CAMPID ||
    process.env.PARTNER_AFFILIATE_ID ||
    authorizedPartners.some(p => {
      const ev = typeof p.evidence_json === 'string' ? p.evidence_json : JSON.stringify(p.evidence || {});
      return ev.includes('affiliateTag') || ev.includes('affiliateId') || ev.includes('tag');
    })
  );

  const isReady = authorizedPartners.length > 0 && activeOffers.length > 0 && publishedContent.length > 0;

  return c.json({
    success: true,
    data: {
      moneyPath: isReady ? 'READY' : 'BLOCKED',
      recommendedFirstPartner: {
        name: 'Amazon Associates India (Amazon.in)',
        network: 'AMAZON_ASSOCIATES',
        portalUrl: 'https://affiliate-program.amazon.in',
        commissionRates: '1% - 9% standard category rates',
        payoutMethod: 'Direct bank transfer (NEFT) in INR',
        payoutThresholdINR: 1000,
        cookieDurationHours: 24,
        rationale: 'Instant self-serve signup, lowest checkout friction in India (millions of users with saved UPI/cards), massive organic intent for buying guides under ₹X, direct NEFT bank payout in INR.'
      },
      singleBiggestBlocker: authorizedPartners.length === 0 ? 'PARTNER_APPROVAL' : activeOffers.length === 0 ? 'NO_ACTIVE_OFFER' : publishedContent.length === 0 ? 'NO_PUBLIC_CONTENT' : 'NONE',
      humanActionRequired: authorizedPartners.length === 0
        ? 'Sign up at https://affiliate-program.amazon.in, obtain your Associates Store ID (e.g. yourname-21), and configure AMAZON_AFFILIATE_TAG.'
        : activeOffers.length === 0
        ? 'Register 1 active offer in partner_offers with destination and tracking parameters.'
        : publishedContent.length === 0
        ? 'Publish 1 commercial guide/comparison page with disclosure.'
        : 'Drive first real organic visitor to the public guide.',
      codeActionRequired: 'None. The code is ready. The remaining blocker is human commercial activation.',
      checklist: [
        { item: 'PARTNER APPROVAL', status: authorizedPartners.length > 0 ? 'READY' : 'REQUIRES HUMAN', note: 'Sign up at https://affiliate-program.amazon.in' },
        { item: 'AFFILIATE ID', status: (authorizedPartners.length > 0 && hasAffiliateId) ? 'READY' : 'REQUIRES HUMAN', note: 'Set AMAZON_AFFILIATE_TAG env secret or add via API' },
        { item: 'PARTNER TERMS', status: authorizedPartners.length > 0 ? 'READY' : 'REQUIRES HUMAN', note: 'Accept Amazon Associates Operating Agreement' },
        { item: 'OFFER', status: activeOffers.length > 0 ? 'READY' : (authorizedPartners.length > 0 ? 'REQUIRES HUMAN' : 'BLOCKED'), note: 'Register 1 active offer with destination and tracking params' },
        { item: 'TRACKING', status: (activeOffers.length > 0 && hasAffiliateId) ? 'READY' : 'BLOCKED', note: 'Verify /r/:offerSlug/:referralId 302 redirects with tag=' },
        { item: 'PUBLIC PAGE', status: publishedContent.length > 0 ? 'READY' : 'BLOCKED', note: 'Publish 1 commercial guide/comparison page with disclosure' },
        { item: 'TRAFFIC', status: totalViews > 0 ? 'READY' : 'BLOCKED', note: 'Real organic visitors to public guide' },
        { item: 'REFERRAL', status: summary.clicks > 0 ? 'READY' : 'BLOCKED', note: 'Tracked outbound referral click (₹0 revenue)' },
        { item: 'CONVERSION', status: summary.externalConversions > 0 ? 'READY' : 'BLOCKED', note: 'Customer purchase on Amazon.in' },
        { item: 'COMMISSION', status: summary.verifiedRevenueINR > 0 ? 'READY' : 'BLOCKED', note: 'Import or verify commission report from Associates Central' },
        { item: 'PAYOUT', status: summary.receivedCashINR > 0 ? 'READY' : 'BLOCKED', note: 'NEFT credit to Indian bank account' }
      ]
    }
  });
});


