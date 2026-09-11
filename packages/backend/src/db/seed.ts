import { getDb } from './client.js';
import { AGENT_REGISTRY } from '@ai-marketing/shared';

export function seedDatabase(): void {
  const db = getDb();

  const orgId = 'org_smilekraft_01';
  const userId = 'usr_owner_01';
  const businessId = 'biz_smilekraft_hyd';
  const goalId = 'goal_100_leads_hyd';

  // 1. Organization
  db.prepare(`
    INSERT OR REPLACE INTO organizations (id, name, slug)
    VALUES (?, ?, ?)
  `).run(orgId, 'SmileKraft Healthcare Solutions', 'smilekraft-healthcare');

  // 2. User
  db.prepare(`
    INSERT OR REPLACE INTO users (id, organization_id, email, name, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, orgId, 'dr.aravind@smilekraftdental.in', 'Dr. Aravind Reddy', 'OWNER');

  // 3. Business: Hyderabad Dental Clinic
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
      title: 'German Titanium Dental Implants',
      description: 'Lifetime warranty permanent dental implants with immediate loading crown technology.',
      priceINR: 28000,
      targetSegment: 'Adults 40+ and seniors in Banjara Hills and Jubilee Hills'
    },
    {
      id: 'off_whitening',
      title: 'Laser Teeth Whitening & Smile Makeover',
      description: '1-hour in-clinic laser teeth whitening. Up to 8 shades brighter for weddings and celebrations.',
      priceINR: 7500,
      targetSegment: 'Brides, grooms, and working professionals across Hyderabad'
    }
  ];

  const valueProps = [
    'US-FDA Approved Digital 3D Scanning',
    'Pain-Free Laser Treatment Technology',
    'Certified Implantologists with 15+ years experience',
    'Flexible 0% EMI Payment Plans in INR'
  ];

  const constraints = {
    monthlyBudgetINR: 50000,
    maxDailySpendINR: 2000,
    excludedTopics: ['Guaranteed 100% cure claims', 'Unrealistic overnight dentistry', 'Aggressive comparative competitor bashing'],
    complianceMandates: ['Medical Council of India ethical standards', 'No misleading before/after medical claims without disclaimer']
  };

  db.prepare(`
    INSERT OR REPLACE INTO businesses (
      id, organization_id, name, vertical_id, vertical_name, risk_tier,
      country, currency, timezone, city, neighborhood,
      website_url, phone, primary_language, secondary_languages_json,
      brand_voice, value_propositions_json, offerings_json, constraints_json,
      autonomy_mode, kill_switch_active, kill_switch_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    businessId,
    orgId,
    'SmileKraft Dental Clinic Hyderabad',
    'HEALTHCARE_DENTAL',
    'Dental Clinics & Orthodontics',
    'HIGH',
    'IN',
    'INR',
    'Asia/Kolkata',
    'Hyderabad',
    'Banjara Hills & Gachibowli',
    'https://smilekraftdental.in',
    '+91-98765-43210',
    'English',
    JSON.stringify(['Telugu', 'Hindi']),
    'Warm, empathetic, clinically authoritative, reassuring, and modern. Emphasizes patient comfort, gentle dentistry, and transparent pricing in INR.',
    JSON.stringify(valueProps),
    JSON.stringify(offerings),
    JSON.stringify(constraints),
    'ASSISTED',
    0,
    null
  );

  // 4. Primary Business Goal: 100 Qualified Patient Leads / month with ₹50,000 budget
  const kpis = [
    { name: 'Qualified Inquiries', baseline: 15, target: 100, current: 32, unit: 'leads' },
    { name: 'Cost per Qualified Lead (CPQL)', baseline: 1100, target: 500, current: 620, unit: 'INR' },
    { name: 'Consultation Show-up Rate', baseline: 45, target: 75, current: 68, unit: '%' }
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

  // 5. Seed 80 Agents
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

  // 6. Seed Integrations (Sandbox / Test Mode)
  const insertIntegrationStmt = db.prepare(`
    INSERT OR REPLACE INTO integrations (
      id, organization_id, business_id, provider, status, mode,
      credentials_meta_json, last_health_check
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertIntegrationStmt.run(
    'int_wa_01', orgId, businessId, 'WHATSAPP', 'CONNECTED', 'SANDBOX',
    JSON.stringify({ phone_number: '+919876543210', provider: 'Meta Cloud API (Sandbox)' }),
    new Date().toISOString()
  );
  insertIntegrationStmt.run(
    'int_meta_01', orgId, businessId, 'META_ADS', 'CONNECTED', 'SANDBOX',
    JSON.stringify({ ad_account: 'act_smilekraft_hyd', page: 'SmileKraft Dental' }),
    new Date().toISOString()
  );
  insertIntegrationStmt.run(
    'int_google_01', orgId, businessId, 'GOOGLE_BUSINESS_PROFILE', 'CONNECTED', 'SANDBOX',
    JSON.stringify({ location_name: 'SmileKraft Dental Banjara Hills' }),
    new Date().toISOString()
  );
  insertIntegrationStmt.run(
    'int_email_01', orgId, businessId, 'EMAIL', 'NOT_CONNECTED', 'SANDBOX',
    JSON.stringify({ sender: 'info@smilekraftdental.in' }),
    null
  );

  // 7. Seed Quota Record
  const todayKey = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT OR REPLACE INTO quota_records (
      date_key, gemini_requests, gemini_tokens,
      cloudflare_worker_requests, throttled_events, circuit_breaker_tripped
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(todayKey, 14, 28400, 156, 0, 0);

  const now = new Date().toISOString();

  // 8. Seed Initial Strategy
  const stratId = `strat_v1_${businessId}`;
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
    'Target tech professionals and affluent families in Gachibowli and Banjara Hills via Meta Ads and localized WhatsApp consultation funnels.',
    'Premier Pain-Free Digital Smile Clinic in Hyderabad',
    JSON.stringify(['Tech professionals 24-38', 'Affluent parents seeking modern braces']),
    JSON.stringify(['META_ADS', 'WHATSAPP', 'GOOGLE_BUSINESS_PROFILE']),
    JSON.stringify(['Invisible Aligners', 'Laser Whitening', 'Titanium Implants']),
    100, 500, 'ACTIVE', now, now
  );

  // 9. Seed Active Campaigns
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
    'Gachibowli IT Corridor Clear Aligners Campaign',
    'Generate 60 qualified consultation bookings for clear aligners in West Hyderabad',
    JSON.stringify(['META_ADS', 'WHATSAPP']),
    'Tech professionals aged 22-38 in HITEC City & Gachibowli',
    JSON.stringify({ city: 'Hyderabad', localities: ['Gachibowli', 'HITEC City', 'Kondapur'] }),
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

  // 10. Seed Customer Journeys (Visitor -> Opportunity -> Customer)
  const insertJourneyStmt = db.prepare(`
    INSERT OR REPLACE INTO customer_journeys (
      id, organization_id, business_id, visitor_id, customer_name,
      customer_phone, customer_email, stage, first_touch_channel,
      last_touch_channel, touchpoints_json, total_lifetime_value_inr,
      classification, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  // 9. Seed INR Transactions (UPI, Netbanking, 0% EMI)
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

  // 10. Seed AI Cost Logs (Efficiency & Token Accounting)
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

  console.log('Seeding completed successfully: Business, Goal, 80 Agents, Integrations, Quotas, Journeys, Transactions, AI Costs.');
}


// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seedDatabase();
}