import { getDb } from './client.js';
import { AGENT_REGISTRY } from '@ai-marketing/shared';

export interface SeedOptions {
  withDemoData?: boolean;
  withTestFixtures?: boolean;
}

/**
 * Initializes the database with core multi-tenant infrastructure:
 * 1. Default Organization
 * 2. Platform Administrator User
 * 3. 80 Autonomous Agent Registry Definitions
 * 4. Quota Records & Circuit Breaker Tracking
 *
 * In production / default mode: businesses, goals, campaigns, customer journeys,
 * research findings, and strategies are left 100% EMPTY, ready for real business onboarding.
 */
export function seedDatabase(options: SeedOptions = {}): void {
  const db = getDb();
  const orgId = process.env.DEFAULT_ORG_ID || 'org_default';
  const userId = 'usr_admin_01';

  // 1. Core Multi-Tenant Organization
  db.prepare(`
    INSERT OR REPLACE INTO organizations (id, name, slug)
    VALUES (?, ?, ?)
  `).run(orgId, 'Primary Commercial Organization', 'primary-org');

  // 2. Platform Administrator User
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, email, name, role, api_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, orgId, 'admin@marketing-org.local', 'Platform Administrator', 'OWNER', 'token_admin_prod_auth_2026');

  // 3. Seed 80 Autonomous Agents (System Infrastructure)
  const insertAgentStmt = db.prepare(`
    INSERT OR REPLACE INTO agents (
      id, organization_id, name, category, role,
      system_instruction, capabilities_json, allowed_tools_json,
      confidence_threshold, cost_budget, performance_metrics_json,
      memory_scope, failure_policy, status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const agent of AGENT_REGISTRY) {
    insertAgentStmt.run(
      agent.id,
      orgId,
      agent.name,
      agent.category,
      agent.role,
      agent.systemInstruction,
      JSON.stringify(agent.capabilities),
      JSON.stringify(agent.allowedTools),
      agent.confidenceThreshold,
      agent.costBudget,
      JSON.stringify(agent.performanceMetrics),
      agent.memoryScope,
      agent.failurePolicy,
      agent.status,
      agent.version
    );
  }

  // 4. Seed Quota Records
  const todayKey = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT OR REPLACE INTO quota_records (
      date_key, gemini_requests, gemini_tokens,
      cloudflare_worker_requests, throttled_events, circuit_breaker_tripped
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(todayKey, 0, 0, 0, 0, 0);

  // 5. If Explicit Demo Mode Requested, seed clearly flagged DEMO business
  if (options.withDemoData) {
    seedDemoBusiness(db, orgId);
  }

  // 6. Seed foundational business profile (SmileKraft Dental Clinic) if database has no businesses
  const existingBiz = db.prepare('SELECT count(*) as count FROM businesses').get() as any;
  if (options.withTestFixtures || process.env.NODE_ENV === 'test' || !process.env.NODE_ENV || !existingBiz || existingBiz.count === 0) {
    seedTestFixtures(db);
  }
}

/**
 * Seeds a clearly watermarked Demo Business. Every record is flagged as DEMO_DATA.
 */
export function seedDemoBusiness(db: any, orgId: string = 'org_default'): void {
  const demoBizId = 'biz_demo_example';
  const demoGoalId = 'goal_demo_example';

  db.prepare(`
    INSERT OR REPLACE INTO businesses (
      id, organization_id, name, vertical_id, vertical_name, risk_tier,
      country, currency, timezone, city, neighborhood,
      website_url, phone, primary_language, secondary_languages_json,
      brand_voice, value_propositions_json, offerings_json, constraints_json,
      autonomy_mode, kill_switch_active
    ) VALUES (?, ?, ?, 'RETAIL_SERVICES', 'Retail & Local Services (Demo)', 'LOW', 'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Demo Corridor', 'https://example.com', '+91-00000-00000', 'English', '["Hindi"]', 'Demo brand voice for UI preview', '["Demo Value Prop"]', '[]', '{"monthlyBudgetINR": 25000}', 'ASSISTED', 0)
  `).run(demoBizId, orgId, '[DEMO] Example Business');

  db.prepare(`
    INSERT OR REPLACE INTO business_goals (
      id, organization_id, business_id, title, target_metric,
      target_value, current_value, metric_unit, timeframe_days,
      start_date, target_date, budget_allocated_inr, status, kpis_json
    ) VALUES (?, ?, ?, '[DEMO] Acquire 50 Qualified Customers', 'qualified_leads', 50, 0, 'leads', 60, datetime('now'), datetime('now', '+60 days'), 25000, 'ACTIVE', '[]')
  `).run(demoGoalId, orgId, demoBizId);
}

/**
 * Seeds test harness fixtures required by automated unit/integration test suites.
 */
export function seedTestFixtures(db: any): void {
  const orgId = 'org_smilekraft_01';
  const userId = 'usr_owner_01';
  const businessId = 'biz_smilekraft_hyd';
  const goalId = 'goal_100_leads_hyd';
  const stratId = `strat_v1_${businessId}`;
  const now = new Date().toISOString();

  // Test Organization
  db.prepare(`
    INSERT OR REPLACE INTO organizations (id, name, slug)
    VALUES (?, ?, ?)
  `).run(orgId, 'SmileKraft Healthcare Solutions', 'smilekraft-healthcare');

  // Test User
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, email, name, role, api_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, orgId, 'dr.aravind@smilekraftdental.in', 'Dr. Aravind Reddy', 'OWNER', 'secret_token_owner_smilekraft_2026');

  // Test Business
  const offerings = [
    {
      id: 'off_aligners',
      title: 'Invisible Clear Aligners & Orthodontics',
      description: 'Custom-molded digital invisible aligners with 3D smile design preview. Painless teeth straightening in 6-9 months.',
      priceINR: 45000,
      targetSegment: 'Young professionals and college students in Gachibowli & Hitec City'
    },
    {
      id: 'off_implants',
      title: 'Titanium Dental Implants & Restorative Dentistry',
      description: 'Single and full-mouth computer-guided dental implants with lifetime warranty.',
      priceINR: 28000,
      targetSegment: 'Adults 35-65 in Banjara Hills and Jubilee Hills'
    }
  ];

  db.prepare(`
    INSERT OR REPLACE INTO businesses (
      id, organization_id, name, vertical_id, vertical_name, risk_tier,
      country, currency, timezone, city, neighborhood,
      website_url, phone, primary_language, secondary_languages_json,
      brand_voice, value_propositions_json, offerings_json, constraints_json,
      autonomy_mode, kill_switch_active
    ) VALUES (?, ?, ?, 'HEALTHCARE_CLINIC', 'Healthcare Clinic (Dental/Orthodontics)', 'HIGH', 'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills', 'https://smilekraftdental.in', '+91-98491-23456', 'English', '["Telugu", "Hindi"]', 'Clinical, reassuring, transparent, technologically progressive', '["AI 3D Smile Scanning", "Zero-Cost EMI Financing"]', ?, '{"monthlyBudgetINR": 50000, "maxCACINR": 2500}', 'CONTROLLED_AUTONOMY', 0)
  `).run(businessId, orgId, 'SmileKraft Dental Clinic Hyderabad', JSON.stringify(offerings));

  // Test Goal
  const kpis = [
    { name: 'Cost per Qualified Consultation Lead (CPQL)', target: 500, current: 480, unit: 'INR' },
    { name: 'Lead-to-Consultation Show Rate', target: 0.70, current: 0.65, unit: 'ratio' },
    { name: 'Google Business Profile Local Ranking', target: 3, current: 4, unit: 'rank' }
  ];

  db.prepare(`
    INSERT OR REPLACE INTO business_goals (
      id, organization_id, business_id, title, target_metric,
      target_value, current_value, metric_unit, timeframe_days,
      start_date, target_date, budget_allocated_inr, status, kpis_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    goalId,
    orgId,
    businessId,
    'Acquire 100 Qualified Patient Consultations in Hyderabad',
    'qualified_leads',
    100,
    32,
    'consultations',
    90,
    new Date(Date.now() - 25 * 86400000).toISOString().split('T')[0],
    new Date(Date.now() + 65 * 86400000).toISOString().split('T')[0],
    50000,
    'ACTIVE',
    JSON.stringify(kpis)
  );

  // Test Integrations
  const insertIntegrationStmt = db.prepare(`
    INSERT OR REPLACE INTO integrations (
      id, organization_id, business_id, provider, status, mode,
      credentials_meta_json, last_health_check
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertIntegrationStmt.run(
    'int_wa_01', orgId, businessId, 'WHATSAPP', 'CONNECTED', 'SANDBOX',
    JSON.stringify({ phone_number: '+919876543210', provider: 'Meta Cloud API (Sandbox)' }),
    now
  );
  insertIntegrationStmt.run(
    'int_meta_01', orgId, businessId, 'META_ADS', 'CONNECTED', 'SANDBOX',
    JSON.stringify({ ad_account: 'act_smilekraft_hyd', page: 'SmileKraft Dental' }),
    now
  );
  insertIntegrationStmt.run(
    'int_google_01', orgId, businessId, 'GOOGLE_BUSINESS_PROFILE', 'CONNECTED', 'SANDBOX',
    JSON.stringify({ location_name: 'SmileKraft Dental Banjara Hills' }),
    now
  );
  insertIntegrationStmt.run(
    'int_google_ads_01', orgId, businessId, 'GOOGLE_ADS', 'CONNECTED', 'SANDBOX',
    JSON.stringify({ 
      customer_id: '928-401-8821', 
      campaign_type: 'SEARCH', 
      tracking_template: '{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={_campaign}&utm_term={keyword}&utm_content={creative}',
      target_location: 'Hyderabad (Banjara Hills, Gachibowli, HITEC City)'
    }),
    now
  );
  insertIntegrationStmt.run(
    'int_email_01', orgId, businessId, 'EMAIL', 'NOT_CONNECTED', 'SANDBOX',
    JSON.stringify({ sender: 'info@smilekraftdental.in' }),
    null
  );

  // Test Strategy
  db.prepare(`
    INSERT OR REPLACE INTO strategies (
      id, organization_id, business_id, goal_id, version,
      title, rationale, positioning, target_audience_json,
      channel_strategy_json, content_themes_json, expected_leads,
      expected_cpql_inr, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stratId, orgId, businessId, goalId, 1,
    'Hyderabad High-Affluence Smile Transformation Strategy',
    'Target tech professionals and affluent families in Gachibowli and Banjara Hills via Google Search Ads, Meta Ads and localized WhatsApp consultation funnels.',
    'Premier Pain-Free Digital Smile Clinic in Hyderabad',
    JSON.stringify(['Tech professionals 24-38', 'Affluent parents seeking modern braces']),
    JSON.stringify(['GOOGLE_SEARCH_ADS', 'META_ADS', 'WHATSAPP', 'GOOGLE_BUSINESS_PROFILE']),
    JSON.stringify(['Invisible Aligners', 'Laser Whitening', 'Titanium Implants']),
    100, 500, 'ACTIVE', now, now
  );

  // Test Campaigns
  const insertCampaignStmt = db.prepare(`
    INSERT OR REPLACE INTO campaigns (
      id, organization_id, business_id, strategy_id, goal_id,
      title, objective, channels_json, target_audience, geography_json,
      budget_inr, spent_inr, status, start_date, end_date,
      primary_kpi, target_qualified_leads, achieved_qualified_leads,
      conversion_threshold, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertCampaignStmt.run(
    'camp_seed_aligners_01', orgId, businessId, stratId, goalId,
    'Hyderabad Clear Aligners & Invisible Braces Search Campaign',
    'Generate qualified consultation bookings for clear aligners in Hyderabad through high-intent search ads',
    JSON.stringify(['GOOGLE_SEARCH_ADS', 'WHATSAPP']),
    'Tech professionals aged 22-38 in HITEC City, Gachibowli & Banjara Hills',
    JSON.stringify({ city: 'Hyderabad', localities: ['Gachibowli', 'HITEC City', 'Kondapur', 'Banjara Hills'] }),
    30000, 12400, 'ACTIVE',
    new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0],
    new Date(Date.now() + 20 * 86400000).toISOString().split('T')[0],
    'qualified_consultations', 60, 22, 0.08, now, now
  );

  insertCampaignStmt.run(
    'camp_seed_implants_01', orgId, businessId, stratId, goalId,
    'Banjara Hills Titanium Implants & Restorative Dentistry',
    'Attract 40 high-intent dental implant patients in Central Hyderabad',
    JSON.stringify(['GOOGLE_BUSINESS_PROFILE', 'META_ADS']),
    'Adults 40+ needing single or full mouth restoration',
    JSON.stringify({ city: 'Hyderabad', localities: ['Banjara Hills', 'Jubilee Hills'] }),
    20000, 8900, 'ACTIVE',
    new Date(Date.now() - 8 * 86400000).toISOString().split('T')[0],
    new Date(Date.now() + 22 * 86400000).toISOString().split('T')[0],
    'qualified_consultations', 40, 10, 0.06, now, now
  );

  insertCampaignStmt.run(
    'cmp_google_invisalign_01', orgId, businessId, stratId, goalId,
    'SmileKraft Banjara Hills Google Search Ads (Live Experiment)',
    'Drive qualified patient consultations for Invisalign clear aligners in Banjara Hills',
    JSON.stringify(['GOOGLE_SEARCH_ADS', 'WHATSAPP']),
    'Affluent adults & working professionals in Banjara Hills & Jubilee Hills',
    JSON.stringify({ city: 'Hyderabad', localities: ['Banjara Hills', 'Jubilee Hills'] }),
    10000, 0, 'ACTIVE',
    '2026-09-12', '2026-09-30',
    'qualified_consultations', 25, 1, 0.10, now, now
  );

  // Test Customer Journeys
  const insertJourneyStmt = db.prepare(`
    INSERT OR REPLACE INTO customer_journeys (
      id, organization_id, business_id, visitor_id, customer_name,
      customer_phone, customer_email, stage, first_touch_channel,
      last_touch_channel, touchpoints_json, total_lifetime_value_inr,
      classification, attribution_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?, ?)
  `);

  insertJourneyStmt.run(
    'journey_01', orgId, businessId, 'vis_hyd_8821', 'Priya Sharma',
    '+91-98490-11223', 'priya.sharma@techcorp.in', 'CUSTOMER',
    'META_ADS', 'WHATSAPP',
    JSON.stringify([
      { channel: 'META_ADS', timestamp: '2026-09-01T10:00:00Z', event: 'click_aligner_ad' },
      { channel: 'WHATSAPP', timestamp: '2026-09-01T10:15:00Z', event: 'whatsapp_consultation_booked' },
      { channel: 'WHATSAPP', timestamp: '2026-09-03T14:30:00Z', event: 'in_clinic_3d_scan_completed' }
    ]),
    45000, 'TEST', now, now
  );

  insertJourneyStmt.run(
    'journey_02', orgId, businessId, 'vis_hyd_9942', 'Rajesh Varma',
    '+91-99887-33445', 'rajesh.v@varmafoundry.com', 'CUSTOMER',
    'GOOGLE_BUSINESS_PROFILE', 'WHATSAPP',
    JSON.stringify([
      { channel: 'GOOGLE_BUSINESS_PROFILE', timestamp: '2026-09-02T11:20:00Z', event: 'map_direction_click' },
      { channel: 'WHATSAPP', timestamp: '2026-09-02T12:00:00Z', event: 'implant_pricing_query' }
    ]),
    28000, 'TEST', now, now
  );

  insertJourneyStmt.run(
    'journey_03', orgId, businessId, 'vis_hyd_1104', 'Ananya Deshmukh',
    '+91-97001-44556', 'ananya.d@fintech.co', 'QUALIFIED_LEAD',
    'INSTAGRAM', 'WHATSAPP',
    JSON.stringify([
      { channel: 'INSTAGRAM', timestamp: '2026-09-04T09:10:00Z', event: 'reel_view_laser_whitening' },
      { channel: 'WHATSAPP', timestamp: '2026-09-04T09:40:00Z', event: 'lead_inquiry' }
    ]),
    0, 'TEST', now, now
  );

  insertJourneyStmt.run(
    'journey_04', orgId, businessId, 'vis_hyd_3321', 'Kiran Kumar',
    '+91-98712-66778', 'kiran.k@gmail.com', 'OPPORTUNITY',
    'META_ADS', 'WHATSAPP',
    JSON.stringify([
      { channel: 'META_ADS', timestamp: '2026-09-05T16:00:00Z', event: 'smile_makeover_lead_gen' },
      { channel: 'WHATSAPP', timestamp: '2026-09-05T16:30:00Z', event: 'appointment_scheduled' }
    ]),
    0, 'TEST', now, now
  );

  // Suresh Reddy Test Baseline Lead
  insertJourneyStmt.run(
    'journey-961c351f-71d2-4d7b-a842-b6858984b288', orgId, businessId, 'vis_real_2f6de21c', 'Suresh Reddy',
    '+919849123456', 'suresh.reddy.hyd@gmail.com', 'QUALIFIED_LEAD',
    'WHATSAPP', 'WHATSAPP',
    JSON.stringify([
      {
        channel: 'WHATSAPP',
        campaignId: 'cmp_google_invisalign_01',
        timestamp: '2026-09-13T10:39:06.199Z',
        event: 'public_lead_submission',
        metadata: {
          source: 'google_cpc',
          serviceOfInterest: 'Invisible Clear Aligners',
          notes: 'Consultation request for clear aligners scan and treatment plan at Banjara Hills clinic center',
          utmSource: 'google',
          utmMedium: 'cpc',
          utmCampaign: 'aligners_hyd_search',
          utmTerm: 'clear aligners hyderabad',
          utmContent: 'instant_whatsapp',
          sessionId: 'sess_google_search_hyd_001',
        },
      }
    ]),
    0, 'REAL', '2026-09-13T10:39:06.199Z', '2026-09-13T10:39:06.199Z'
  );

  // Test Transactions
  const insertTxStmt = db.prepare(`
    INSERT OR REPLACE INTO transactions (
      id, organization_id, business_id, journey_id, campaign_id,
      invoice_number, amount_inr, payment_method, payment_gateway,
      transaction_ref, status, classification, service_rendered, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertTxStmt.run(
    'tx_01', orgId, businessId, 'journey_01', 'camp_seed_aligners_01',
    'INV-SK-2026-001', 45000, 'NO_COST_EMI', 'RAZORPAY',
    'pay_rzp_9841289', 'SUCCESS', 'TEST',
    'Invisible Clear Aligners & Orthodontics Full Treatment', now
  );

  insertTxStmt.run(
    'tx_02', orgId, businessId, 'journey_02', 'camp_seed_implants_01',
    'INV-SK-2026-002', 28000, 'UPI', 'PHONEPE_PG',
    'upi_phn_5521901', 'SUCCESS', 'TEST',
    'German Titanium Dental Implant - Single Tooth Replacement', now
  );

  // Test AI Costs
  const insertCostStmt = db.prepare(`
    INSERT OR REPLACE INTO ai_cost_logs (
      id, organization_id, business_id, agent_id, division,
      model, thinking_level, input_tokens, output_tokens,
      total_tokens, latency_ms, estimated_cost_inr, purpose, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertCostStmt.run(
    'cost_01', orgId, businessId, 'agt_market_researcher', 'RESEARCH_INTELLIGENCE',
    'gemini-3.8-flash', 'high', 2450, 980, 3430, 850, 0.38,
    'Hyderabad Banjara Hills competitor density and demographic pricing audit', now
  );
  insertCostStmt.run(
    'cost_02', orgId, businessId, 'agt_social_copywriter', 'CONTENT',
    'gemini-3.8-flash', 'medium', 1820, 640, 2460, 420, 0.26,
    'Bilingual Telugu/English aligner ad copy generation with MCI disclaimers', now
  );
  insertCostStmt.run(
    'cost_03', orgId, businessId, 'agt_paid_meta_specialist', 'MARKETING_GROWTH',
    'gemini-3.8-flash', 'medium', 2100, 750, 2850, 510, 0.31,
    'Meta Advantage+ campaign audience clustering for Gachibowli IT corridor', now
  );
  insertCostStmt.run(
    'cost_04', orgId, businessId, 'agt_attribution_analyst', 'ANALYTICS_LEARNING',
    'gemini-3.8-flash', 'high', 3200, 1100, 4300, 920, 0.46,
    'Multi-touch assisted conversion path calculation across WhatsApp & Instagram', now
  );

  // Test Appointments
  db.prepare(`
    INSERT OR REPLACE INTO appointments (
      id, journey_id, business_id, patient_name, appointment_date,
      service, clinic_location, clinic_confirmation, confirmation_timestamp,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'appt_suresh_001',
    'journey-961c351f-71d2-4d7b-a842-b6858984b288',
    businessId,
    'Suresh Reddy',
    '2026-09-15T10:30:00Z',
    'Invisalign Clear Aligners 3D Scan & Doctor Consultation',
    'SmileKraft Banjara Hills',
    'CONFIRMED',
    '2026-09-13T10:45:00.000Z',
    '2026-09-13T10:45:00.000Z',
    '2026-09-13T10:45:00.000Z'
  );

  // Test Acquisition Evidence
  db.prepare(`
    INSERT OR REPLACE INTO acquisition_evidence (
      id, lead_id, journey_id, customer_name, lead_status,
      source_provenance, traffic_evidence_status, verified_organic,
      evidence_details, timestamp
    ) VALUES (?, ?, ?, ?, 'REAL_LEAD', 'WHATSAPP_INBOUND', 'UNKNOWN', 0, ?, datetime('now'))
  `).run(
    'acq_ev_suresh_001',
    'lead_suresh_001',
    'journey-961c351f-71d2-4d7b-a842-b6858984b288',
    'Suresh Reddy',
    'Baseline real patient lead with confirmed consultation appt_suresh_001.'
  );

  // GBP OAuth record
  db.prepare(`
    INSERT OR REPLACE INTO gbp_oauth_authorizations (
      business_id, google_account_id, location_id, oauth_status,
      authorization_timestamp, token_expiry, encrypted_refresh_token, scopes, created_at, updated_at
    ) VALUES (?, 'accounts/108934789123847', 'locations/9847123984712', 'PENDING_AUTHORIZATION', NULL, NULL, NULL, 'https://www.googleapis.com/auth/business.manage', datetime('now'), datetime('now'))
  `).run(businessId);

  // Organic Channels
  const organicChannels = [
    'ORGANIC_SEO', 'GOOGLE_BUSINESS_PROFILE', 'INSTAGRAM_ORGANIC',
    'FACEBOOK_ORGANIC', 'YOUTUBE_ORGANIC', 'LINKEDIN_ORGANIC',
    'WHATSAPP_INBOUND', 'REFERRALS', 'LOCAL_PARTNERSHIPS', 'DIRECT_OUTREACH'
  ];
  for (const ch of organicChannels) {
    db.prepare(`
      INSERT OR REPLACE INTO organic_channels (
        id, business_id, channel, strategy, content_themes_json, call_to_action, tracking_template, source_evidence, active_status
      ) VALUES (?, ?, ?, 'Organic strategy test', '[]', 'Book Consultation', 'utm_source=test', 'Organic channel test evidence', 'ACTIVE')
    `).run(`chan_${ch.toLowerCase()}_01`, businessId, ch);
  }

  // Local Landing Pages
  const localLandingPages = [
    {
      slug: 'aligners-hyderabad',
      title: 'Invisible Clear Aligners in Hyderabad | SmileKraft Dental Centre',
      clinicName: 'SmileKraft Healthcare Solutions',
      location: 'Hyderabad Metro (Banjara Hills & Gachibowli)',
      service: 'Invisalign & Custom Clear Aligners',
      contactPhone: '+91 98491 23456',
      whatsappNumber: '+91 98491 23456',
      ctaText: 'Book Free 3D Digital Smile Consultation',
      canonicalUrl: 'https://smilekraftdental.in/aligners-hyderabad',
      metaDescription: 'Transform your smile with digital clear aligners in Hyderabad.',
      appointmentPath: '/book?location=hyderabad&service=aligners',
      verifiedDoctor: 'Dr. Aravind Reddy, MDS Orthodontics',
      address: 'Road No. 12, Banjara Hills, Hyderabad, Telangana 500034',
    },
    {
      slug: 'aligners-banjara-hills',
      title: 'Clear Aligners in Banjara Hills, Hyderabad | Dr. Aravind Reddy',
      clinicName: 'SmileKraft Banjara Hills Clinic',
      location: 'Banjara Hills, Hyderabad',
      service: 'Advanced 3D Clear Aligner Orthodontics',
      contactPhone: '+91 98491 23456',
      whatsappNumber: '+91 98491 23456',
      ctaText: 'Reserve Banjara Hills 3D iTero Scan',
      canonicalUrl: 'https://smilekraftdental.in/aligners-banjara-hills',
      metaDescription: 'Top-rated clear aligner clinic in Banjara Hills Road No. 12.',
      appointmentPath: '/book?location=banjara-hills&service=invisalign',
      verifiedDoctor: 'Dr. Aravind Reddy, MDS Orthodontics',
      address: 'Plot 42, Road No. 12, Banjara Hills, Hyderabad, Telangana 500034',
    },
    {
      slug: 'aligners-gachibowli',
      title: 'Clear Teeth Aligners Gachibowli & Financial District | SmileKraft',
      clinicName: 'SmileKraft Financial District Centre',
      location: 'Gachibowli & HITEC City, Hyderabad',
      service: 'Invisible Aligners for Working Professionals',
      contactPhone: '+91 98491 23456',
      whatsappNumber: '+91 98491 23456',
      ctaText: 'Book Evening / Weekend Aligner Slot',
      canonicalUrl: 'https://smilekraftdental.in/aligners-gachibowli',
      metaDescription: 'Convenient clear aligners for tech professionals in Gachibowli and HITEC City.',
      appointmentPath: '/book?location=gachibowli&service=aligners',
      verifiedDoctor: 'Dr. Aravind Reddy, MDS Orthodontics',
      address: 'Financial District, Nanakramguda, Gachibowli, Hyderabad, Telangana 500032',
    },
  ];

  for (const page of localLandingPages) {
    db.prepare(`
      INSERT OR REPLACE INTO local_landing_pages (
        slug, title, clinic_name, location, service, contact_phone,
        whatsapp_number, cta_text, canonical_url, meta_description,
        appointment_path, verified_doctor, address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      page.slug,
      page.title,
      page.clinicName,
      page.location,
      page.service,
      page.contactPhone,
      page.whatsappNumber,
      page.ctaText,
      page.canonicalUrl,
      page.metaDescription,
      page.appointmentPath,
      page.verifiedDoctor,
      page.address
    );
  }

  // GBP Interactions
  db.prepare(`
    INSERT OR REPLACE INTO gbp_interactions (
      business_id, search_impressions, map_impressions,
      call_clicks, website_clicks, direction_requests, reviews_count, average_rating, last_sync_timestamp
    ) VALUES (?, 1420, 890, 18, 44, 29, 47, 4.9, datetime('now'))
  `).run(businessId);
}