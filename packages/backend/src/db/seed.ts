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

  console.log('Seeding completed successfully: Business, Goal, 80 Agents, Integrations, Quotas.');
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seedDatabase();
}