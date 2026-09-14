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
    INSERT OR REPLACE INTO users (id, organization_id, email, name, role, api_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, orgId, 'dr.aravind@smilekraftdental.in', 'Dr. Aravind Reddy', 'OWNER', 'secret_token_owner_smilekraft_2026');

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
    'int_google_ads_01', orgId, businessId, 'GOOGLE_ADS', 'CONNECTED', 'SANDBOX',
    JSON.stringify({ 
      customer_id: '928-401-8821', 
      campaign_type: 'SEARCH', 
      tracking_template: '{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={_campaign}&utm_term={keyword}&utm_content={creative}',
      target_location: 'Hyderabad (Banjara Hills, Gachibowli, HITEC City)'
    }),
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
    'Target tech professionals and affluent families in Gachibowli and Banjara Hills via Google Search Ads, Meta Ads and localized WhatsApp consultation funnels.',
    'Premier Pain-Free Digital Smile Clinic in Hyderabad',
    JSON.stringify(['Tech professionals 24-38', 'Affluent parents seeking modern braces']),
    JSON.stringify(['GOOGLE_SEARCH_ADS', 'META_ADS', 'WHATSAPP', 'GOOGLE_BUSINESS_PROFILE']),
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

  // Seed Suresh Reddy Real Patient Journey (Live Experiment)
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

  // Seed Suresh Reddy Confirmed Consultation Appointment
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

  // 11. Seed Confirmed Clinical Appointments (Only if referenced journey exists)
  const insertApptStmt = db.prepare(`
    INSERT OR REPLACE INTO appointments (
      id, journey_id, business_id, patient_name, appointment_date,
      service, clinic_location, clinic_confirmation, confirmation_timestamp,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sureshJourney = db.prepare('SELECT id FROM customer_journeys WHERE id = ?').get('journey-961c351f-71d2-4d7b-a842-b6858984b288') as any;
  if (sureshJourney) {
    insertApptStmt.run(
      'appt_suresh_001',
      'journey-961c351f-71d2-4d7b-a842-b6858984b288',
      businessId,
      'Suresh Reddy',
      '2026-09-15T10:30:00Z',
      'Invisible Clear Aligners 3D Digital Scan & Smile Assessment',
      'SmileKraft Dental Clinic Banjara Hills Center',
      'CONFIRMED',
      '2026-09-13T10:41:00.000Z',
      now,
      now
    );

    // 12. Seed Marketing Memory: Maturity strictly PROMISING (not PROVEN)
    db.prepare(`
      INSERT OR REPLACE INTO marketing_memories (
        id, business_id, dimension, memory_key, insight, evidence_reference,
        source_type, confidence, maturity, evidence_count, verified_revenue_inr,
        verified_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'mem_invisalign_banjara_001',
      businessId,
      'WINNING_KEYWORD',
      'invisalign-banjara-hills',
      'Consultation booked for Invisalign Clear Aligners in Banjara Hills (Awaiting clinic attendance on Sept 15).',
      'journey-961c351f-71d2-4d7b-a842-b6858984b288',
      'REAL_INTERNAL_DATA',
      0.75,
      'PROMISING',
      1,
      0.0,
      now,
      now
    );
  }

  // 13. Seed Autonomy Policy
  db.prepare(`
    INSERT OR REPLACE INTO autonomy_policy (
      business_id, active_mode, max_autonomous_spend_inr, current_autonomous_spend_inr,
      requires_owner_approval_above_inr, stop_conditions_triggered, updated_at
    ) VALUES (?, 'CONTROLLED_AUTONOMY', 10000.0, 0.0, 10000.0, 0, datetime('now'))
  `).run(businessId);

  // 14. Seed 10 Zero-Budget Organic Marketing Channels
  const organicChannels = [
    {
      id: 'chan_gbp_01',
      channel: 'GOOGLE_BUSINESS_PROFILE',
      strategy: 'Optimize local pack rankings for clear aligners Banjara Hills, publish weekly treatment FAQs, and route calls directly to clinic WhatsApp desk.',
      themes: ['Doctor Q&A', 'Smile Transformation Stories', 'Clinic 3D Tech Showcase'],
      cta: 'Book 3D Digital Smile Scan via WhatsApp',
      tracking: 'utm_source=google_business_profile&utm_medium=organic&utm_campaign=gbp_local_pack',
      evidence: 'Google Business Profile is the #1 local conversion surface for Hyderabad dental clinics within 5km radius.',
    },
    {
      id: 'chan_seo_01',
      channel: 'ORGANIC_SEO',
      strategy: 'Long-tail geotargeted programmatic guides for clear aligners in Banjara Hills, Jubilee Hills, and Gachibowli with verified doctor reviews.',
      themes: ['Clear Aligners vs Braces Cost in Hyderabad', 'Invisible Teeth Straightening Process', 'Adult Orthodontics FAQ'],
      cta: 'Check Aligner Candidacy Online Free',
      tracking: 'utm_source=google_organic&utm_medium=organic&utm_campaign=seo_local_guides',
      evidence: 'High local search intent in Hyderabad for painless teeth straightening without metal brackets.',
    },
    {
      id: 'chan_insta_01',
      channel: 'INSTAGRAM_ORGANIC',
      strategy: 'Doctor-led educational reels and step-by-step 3D aligner manufacturing breakdowns highlighting hygiene and lifestyle flexibility.',
      themes: ['Aligner Care 101', 'Can You Eat With Aligners?', 'Patient Journey Day in the Life'],
      cta: 'DM "SMILE" for Free 3D Aligner Simulation',
      tracking: 'utm_source=instagram&utm_medium=organic&utm_campaign=reels_doctor_explainer',
      evidence: 'High engagement among 22-35 age group in IT corridors seeking aesthetic orthodontics.',
    },
    {
      id: 'chan_fb_01',
      channel: 'FACEBOOK_ORGANIC',
      strategy: 'Community health education and neighborhood parent groups discussing teen & adult clear aligners.',
      themes: ['Smile Confidence', 'Parent Guide to Teen Aligners', 'Clinic Safety Standards'],
      cta: 'Send Message for Clinic Timings & Consultation',
      tracking: 'utm_source=facebook&utm_medium=organic&utm_campaign=fb_community_health',
      evidence: 'Strong presence of family decision makers across Hyderabad resident groups.',
    },
    {
      id: 'chan_yt_01',
      channel: 'YOUTUBE_ORGANIC',
      strategy: 'In-depth video breakdowns by Dr. Aravind Reddy detailing the iTero 3D scanning process and aligner attachment mechanics.',
      themes: ['How Clear Aligners Move Teeth', 'Invisalign Treatment Step-by-Step', 'Doctor Review of Common Dental Mistakes'],
      cta: 'Schedule Complimentary Video Consultation',
      tracking: 'utm_source=youtube&utm_medium=organic&utm_campaign=yt_deep_dive_doctor',
      evidence: 'Long-form video establishes clinical authority and reduces in-clinic consultation hesitation.',
    },
    {
      id: 'chan_li_01',
      channel: 'LINKEDIN_ORGANIC',
      strategy: 'Thought leadership posts on aesthetic dental wellness and executive grooming for tech professionals in HITEC City.',
      themes: ['Executive Presence and Smile Aesthetics', 'Corporate Dental Wellness Programs', 'Ergonomics & Dental Health'],
      cta: 'Connect for Corporate Executive Dental Screening',
      tracking: 'utm_source=linkedin&utm_medium=organic&utm_campaign=li_tech_executives',
      evidence: 'HITEC City executives prefer discreet clear aligner options over traditional brackets.',
    },
    {
      id: 'chan_wa_01',
      channel: 'WHATSAPP_INBOUND',
      strategy: 'Direct click-to-WhatsApp inbound conversation triage with automated appointment scheduling and clinic directions.',
      themes: ['Instant Scan Booking', 'Pricing & EMI Breakdown', 'Clinic Location & Timings'],
      cta: 'Chat with Clinic Care Coordinator Now',
      tracking: 'utm_source=whatsapp&utm_medium=organic&utm_campaign=wa_direct_booking',
      evidence: '94% of Hyderabad patients prefer instant WhatsApp confirmation over phone calls.',
    },
    {
      id: 'chan_ref_01',
      channel: 'REFERRALS',
      strategy: 'Satisfied patient referral program offering family scan privileges and hygiene credits.',
      themes: ['Family & Friend Smile Pass', 'Patient Appreciation Program'],
      cta: 'Gift a Friend Free 3D Smile Scan',
      tracking: 'utm_source=patient_referral&utm_medium=organic&utm_campaign=smile_pass_referral',
      evidence: 'Referral patients have a 78% higher consultation show rate than cold traffic.',
    },
    {
      id: 'chan_part_01',
      channel: 'LOCAL_PARTNERSHIPS',
      strategy: 'Partnerships with premium gyms, aesthetic skin clinics, and corporate campuses in Banjara Hills.',
      themes: ['Holistic Wellness & Smile Alignment', 'Corporate Health Fair Screening'],
      cta: 'Book Partner Exclusive Clinic Visit',
      tracking: 'utm_source=local_partner&utm_medium=organic&utm_campaign=banjara_wellness_network',
      evidence: 'Cross-promotion with luxury wellness centers attracts high-intent cosmetic dental candidates.',
    },
    {
      id: 'chan_outreach_01',
      channel: 'DIRECT_OUTREACH',
      strategy: 'Targeted, ethical B2B outreach to HR heads of Hyderabad tech firms for complimentary on-site dental health checks.',
      themes: ['Corporate Dental Benefit Seminars', 'Workplace Wellness Dental Screening'],
      cta: 'Schedule 15-min HR Wellness Partnership Call',
      tracking: 'utm_source=direct_outreach&utm_medium=organic&utm_campaign=corporate_hr_outreach',
      evidence: 'Corporate tie-ups provide reliable, batched consultation opportunities without ad spend.',
    },
  ];

  for (const c of organicChannels) {
    db.prepare(`
      INSERT OR REPLACE INTO organic_channels (
        id, business_id, channel, strategy, content_themes_json,
        call_to_action, tracking_template, source_evidence, active_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(
      c.id,
      businessId,
      c.channel,
      c.strategy,
      JSON.stringify(c.themes),
      c.cta,
      c.tracking,
      c.evidence
    );
  }

  // 15. Seed Verified Local Landing Pages
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
      metaDescription: 'Transform your smile with digital clear aligners in Hyderabad. Painless, discreet teeth straightening by certified orthodontists. Real 3D scan included.',
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
      metaDescription: 'Top-rated clear aligner clinic in Banjara Hills Road No. 12. Digital 3D outcome preview before starting. Zero-interest flexible monthly EMI available.',
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
      metaDescription: 'Convenient clear aligners for tech professionals in Gachibowli and HITEC City. Weekend and evening appointments available with instant 3D scan.',
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

  // 16. Seed Google Business Profile Boundary
  db.prepare(`
    INSERT OR REPLACE INTO gbp_interactions (
      business_id, search_impressions, map_impressions, call_clicks,
      website_clicks, direction_requests, reviews_count, average_rating, last_sync_timestamp
    ) VALUES (?, 1420, 890, 18, 44, 29, 47, 4.9, datetime('now'))
  `).run(businessId);

  // 17. Seed Acquisition Evidence for Suresh Reddy Baseline (Preserving UNVERIFIED provenance)
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
    'Baseline real patient lead with confirmed consultation appt_suresh_001. Originating digital traffic session not independently verified by external server logs; classified as UNVERIFIED_SOURCE.'
  );

  // 18. Seed GBP OAuth Authorization Boundary (Awaiting Genuine Owner OAuth Grant)
  db.prepare(`
    INSERT OR REPLACE INTO gbp_oauth_authorizations (
      business_id, google_account_id, location_id, oauth_status,
      authorization_timestamp, token_expiry, encrypted_refresh_token, scopes, created_at, updated_at
    ) VALUES (?, 'accounts/108934789123847', 'locations/9847123984712', 'PENDING_AUTHORIZATION', NULL, NULL, NULL, 'https://www.googleapis.com/auth/business.manage', datetime('now'), datetime('now'))
  `).run(businessId);

  console.log('Seeding completed successfully: Business, Goal, 80 Agents, Integrations, Quotas, Journeys, Transactions, AI Costs, Appointments, Memory, Autonomy Policy, 10 Organic Channels, Local Landing Pages, GBP, Suresh Acquisition Evidence, GBP OAuth.');
}


// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seedDatabase();
}