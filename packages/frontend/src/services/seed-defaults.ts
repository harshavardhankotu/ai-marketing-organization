import { AGENT_REGISTRY } from '@ai-marketing/shared';

export const DEFAULT_BUSINESS = {
  id: 'biz_smilekraft_hyd',
  name: 'SmileKraft Dental Clinic Hyderabad',
  vertical_name: 'Dental Clinics & Orthodontics',
  city: 'Hyderabad',
  neighborhood: 'Banjara Hills & Gachibowli',
  country: 'IN',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  autonomy_mode: 'CONTROLLED_AUTONOMY',
  kill_switch_active: 0,
  website_url: 'https://smilekraftdental.in',
  phone: '+91-98765-43210',
  offerings: [
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
  ],
  valuePropositions: [
    'US-FDA Approved Digital 3D Scanning',
    'Pain-Free Laser Treatment Technology',
    'Certified Implantologists with 15+ years experience',
    'Flexible 0% EMI Payment Plans in INR'
  ]
};

export const DEFAULT_GOALS = [
  {
    id: 'goal_100_leads_hyd',
    title: 'Acquire 100 Qualified Patient Consultations in Hyderabad',
    target_metric: 'qualified_leads',
    target_value: 100,
    current_value: 32,
    metric_unit: 'consultations',
    budget_allocated_inr: 50000,
    status: 'ACTIVE',
    kpis: [
      { name: 'Qualified Inquiries', baseline: 15, target: 100, current: 32, unit: 'leads' },
      { name: 'Cost per Qualified Lead (CPQL)', baseline: 1100, target: 500, current: 620, unit: 'INR' },
      { name: 'Consultation Show-up Rate', baseline: 45, target: 75, current: 68, unit: '%' }
    ]
  }
];

export const DEFAULT_CAMPAIGNS = [
  {
    id: 'camp_seed_aligners_01',
    title: 'Hyderabad Clear Aligners & Invisible Braces Search Campaign',
    objective: 'Generate qualified consultation bookings for clear aligners in Hyderabad through high-intent search ads',
    channels: ['GOOGLE_SEARCH_ADS', 'WHATSAPP'],
    target_audience: 'Tech professionals aged 22-38 in HITEC City, Gachibowli & Banjara Hills',
    budget_inr: 30000,
    spent_inr: 12400,
    status: 'ACTIVE',
    target_qualified_leads: 60,
    achieved_qualified_leads: 22,
    primary_kpi: 'qualified_consultations'
  },
  {
    id: 'camp_seed_implants_01',
    title: 'Banjara Hills Titanium Implants & Restorative Dentistry',
    objective: 'Attract 40 high-intent dental implant patients in Central Hyderabad',
    channels: ['GOOGLE_BUSINESS_PROFILE', 'META_ADS'],
    target_audience: 'Adults 40+ needing single or full mouth restoration in Banjara Hills & Jubilee Hills',
    budget_inr: 20000,
    spent_inr: 8900,
    status: 'ACTIVE',
    target_qualified_leads: 40,
    achieved_qualified_leads: 10,
    primary_kpi: 'qualified_consultations'
  },
  {
    id: 'cmp_google_invisalign_01',
    title: 'SmileKraft Banjara Hills Google Search Ads (Live Experiment)',
    objective: 'Drive qualified patient consultations for Invisalign clear aligners in Banjara Hills',
    channels: ['GOOGLE_SEARCH_ADS', 'WHATSAPP'],
    target_audience: 'Affluent adults & working professionals in Banjara Hills & Jubilee Hills',
    budget_inr: 10000,
    spent_inr: 0,
    status: 'ACTIVE',
    target_qualified_leads: 25,
    achieved_qualified_leads: 1,
    primary_kpi: 'qualified_consultations'
  }
];

export const DEFAULT_CONTENT_ASSETS = [
  {
    id: 'cnt_wa_01',
    title: 'Instant 3D Smile Scan Booking Invite (WhatsApp)',
    channel: 'WHATSAPP',
    language: 'English',
    body: 'Hi {{name}}, smile with confidence! SmileKraft Dental Clinic in Banjara Hills offers custom 3D Clear Aligners with zero discomfort. Book your 3D digital scan consultation this week and get ₹5,000 off your complete treatment. Reply 1 to view clinic timings or 2 to speak with our orthodontist Dr. Aravind Reddy MDS.',
    status: 'APPROVED',
    compliance_passed: true,
    brand_voice_score: 96
  },
  {
    id: 'cnt_wa_02',
    title: 'స్పష్టమైన ఎలైలర్లతో అందమైన చిరునవ్వు (Telugu WhatsApp)',
    channel: 'WHATSAPP',
    language: 'Telugu',
    body: 'నమస్కారం {{name}}, మీ పళ్లను తీగలు లేకుండా సరిచేసుకోవాలనుకుంటున్నారా? బంజారా హిల్స్‌లోని SmileKraft డెంటల్ క్లినిక్‌లో ఆధునిక 3D క్లియర్ ఎలైలర్ చికిత్స అందుబాటులో ఉంది. ఈ రోజే డాక్టర్ అరవింద్ రెడ్డితో సంప్రదింపులను బుక్ చేసుకోండి. సమాధానం ఇవ్వండి: 1. క్లినిక్ వేళలు 2. అపాయింట్‌మెంట్.',
    status: 'APPROVED',
    compliance_passed: true,
    brand_voice_score: 94
  },
  {
    id: 'cnt_insta_01',
    title: 'Doctor Explainer: Why Clear Aligners Beat Metal Braces',
    channel: 'INSTAGRAM',
    language: 'English',
    body: 'Still thinking braces mean metal wires and dietary restrictions? Watch Dr. Aravind Reddy explain how custom German-engineered clear aligners gently shift your teeth with near-invisible precision in as little as 6 months. Swipe left to see real patient transformation time-lapses! #HyderabadDentist #ClearAligners #SmileKraft',
    status: 'APPROVED',
    compliance_passed: true,
    brand_voice_score: 95
  },
  {
    id: 'cnt_gbp_01',
    title: 'Clear Aligners FAQ - Banjara Hills & Gachibowli Local Pack',
    channel: 'GOOGLE_BUSINESS_PROFILE',
    language: 'English',
    body: 'Are clear aligners right for adults? Yes! SmileKraft Dental Clinic in Banjara Hills (Road #12) specializes in adult orthodontics. Enjoy removable trays, easy brushing, and virtually invisible smile correction. Call or WhatsApp our front desk for appointment slots today.',
    status: 'APPROVED',
    compliance_passed: true,
    brand_voice_score: 92
  }
];

export const DEFAULT_RESEARCH = [
  {
    id: 'res_comp_01',
    title: 'Hyderabad Clear Aligner Competitor Price & Offer Matrix',
    category: 'COMPETITOR_ANALYSIS',
    summary: 'Surveyed 12 dental chains across Gachibowli, Madhapur, and Banjara Hills. Average aligner pricing ranges from ₹55,000 to ₹95,000. SmileKraft at ₹45,000 with 0% EMI has a decisive price-to-value advantage.',
    confidenceScore: 94,
    evidenceStatus: 'VERIFIED_EXTERNAL',
    source: 'Local Clinic Secret Shopper & Google Ads Footprint Audit'
  },
  {
    id: 'res_local_02',
    title: 'Gachibowli & Hitec City Search Intent Trends',
    category: 'LOCAL_SEARCH_INTENT',
    summary: 'Search volume for "invisible teeth aligners hyderabad" and "best orthodontist banjara hills" spiked 34% quarter-over-quarter. Tech workers strongly prioritize weekend appointments and clinic proximity to Financial District.',
    confidenceScore: 91,
    evidenceStatus: 'VERIFIED_EXTERNAL',
    source: 'Google Trends & Keyword Planner (Telangana Geo)'
  },
  {
    id: 'res_audit_03',
    title: 'Medical Advertising Compliance Audit (ASCI & MCI)',
    category: 'REGULATORY_COMPLIANCE',
    summary: 'All dental marketing materials adhere to Medical Council of India guidelines: strictly educational, no superlative cure claims (no "100% guaranteed straight teeth"), and transparent disclosures of doctor qualifications (MDS Orthodontics).',
    confidenceScore: 99,
    evidenceStatus: 'VERIFIED_REGULATORY',
    source: 'Medical Council of India & ASCI Healthcare Code'
  }
];

export const DEFAULT_EXPERIMENTS = [
  {
    id: 'exp_ab_copy_01',
    title: 'Doctor Authority vs Patient Transformation Headline Test',
    hypothesis: 'Doctor-led credentials ("Treated by MDS Orthodontist") will yield a 25% higher qualified lead show-up rate than lifestyle cosmetic transformation messaging in Banjara Hills.',
    status: 'RUNNING',
    channel: 'META_ADS',
    sampleSize: 1240,
    confidenceLevel: '95%',
    winner: 'VARIANT_A (Doctor Authority - 7.2% vs 4.8% CVR)'
  },
  {
    id: 'exp_ab_format_02',
    title: 'WhatsApp Instant Scan Booking vs Phone Call Callback',
    hypothesis: 'Offering an instant WhatsApp chat-to-book option will decrease lead drop-off by 40% compared to traditional phone call request forms.',
    status: 'COMPLETED',
    channel: 'WHATSAPP',
    sampleSize: 620,
    confidenceLevel: '98%',
    winner: 'VARIANT_B (WhatsApp Instant - +54% completed bookings)'
  }
];

export const DEFAULT_EVOLUTION = {
  strategies: [
    {
      version: 2,
      title: 'Hyderabad Strategy v2.0 (Post-Learning Autonomous Optimization)',
      rationale: 'Shifted 40% of Meta Ads budget into Google Search and WhatsApp Inbound based on higher show-up rates and lower CPQL.',
      channelAllocations: { WHATSAPP: '45%', GOOGLE_SEARCH_ADS: '35%', GOOGLE_BUSINESS_PROFILE: '20%' },
      status: 'ACTIVE'
    },
    {
      version: 1,
      title: 'Initial Launch Strategy v1.0',
      rationale: 'Equal split across search, social, and local directories.',
      channelAllocations: { META_ADS: '40%', GOOGLE_SEARCH_ADS: '30%', WHATSAPP: '30%' },
      status: 'SUPERSEDED'
    }
  ],
  learnings: [
    {
      id: 'lrn_01',
      title: 'WhatsApp Instant Booking Outperforms Web Forms 2.4x in Hyderabad',
      category: 'CHANNEL_EFFICIENCY',
      impact: 'CPQL reduced from ₹1,100 to ₹620; consultation show-up rate increased to 68%.'
    },
    {
      id: 'lrn_02',
      title: 'Doctor Qualification Disclosures Boost Trust in Cosmetic Orthodontics',
      category: 'CREATIVE_FIDELITY',
      impact: 'Highlighting Dr. Aravind Reddy MDS increased booking conversions by 31% over generic clinic branding.'
    }
  ],
  decisions: [
    {
      id: 'dec_01',
      action: 'REALLOCATE_BUDGET',
      details: 'Shifted ₹10,000 monthly spend to Google Local Search and WhatsApp automation desk.',
      status: 'EXECUTED'
    }
  ]
};

export const DEFAULT_METRICS = {
  impressions: 24500,
  clicks: 1840,
  leads: 78,
  qualifiedLeads: 32,
  appointments: 24,
  revenueINR: 148000,
  spentINR: 21300,
  cpqlINR: 666,
  roas: 8
};

export const DEFAULT_APPROVALS = [
  {
    id: 'appr_01',
    agent_id: 'strat-01',
    agent_name: 'Marketing Strategist Agent',
    action_type: 'BUDGET_REALLOCATION',
    description: 'Reallocate ₹5,000 monthly ad spend from Meta display to Google Search High-Intent Keywords.',
    risk_score: 'LOW',
    status: 'PENDING',
    created_at: new Date().toISOString()
  },
  {
    id: 'appr_02',
    agent_id: 'cnt-03',
    agent_name: 'WhatsApp Writer Agent',
    action_type: 'CAMPAIGN_BROADCAST',
    description: 'Broadcast Diwali Smile Makeover 0% EMI message to 450 qualified aligner inquiries.',
    risk_score: 'MEDIUM',
    status: 'PENDING',
    created_at: new Date().toISOString()
  }
];

export const DEFAULT_INTEGRATIONS = [
  { provider: 'WHATSAPP', status: 'CONNECTED', mode: 'SANDBOX', details: '+919876543210 (Meta Cloud API)' },
  { provider: 'GOOGLE_ADS', status: 'CONNECTED', mode: 'SANDBOX', details: 'Customer ID: 928-401-8821' },
  { provider: 'GOOGLE_BUSINESS_PROFILE', status: 'CONNECTED', mode: 'SANDBOX', details: 'SmileKraft Dental Banjara Hills' },
  { provider: 'META_ADS', status: 'CONNECTED', mode: 'SANDBOX', details: 'SmileKraft Facebook & Instagram' }
];

export const DEFAULT_QUOTA = {
  geminiRequestsToday: 14,
  geminiMaxDailyRequests: 1500,
  geminiTokensToday: 28400,
  circuitBreakerTripped: false
};

export const DEFAULT_READINESS = {
  status: 'FIRST_VERIFIED_REVENUE',
  operatingState: 'FIRST_VERIFIED_REVENUE',
  passedChecks: 12,
  totalChecks: 12,
  metrics: {
    realLeadsCount: 1,
    realConsultationsCount: 1,
    realCustomersCount: 0,
    realRevenueINR: 500,
    realAttributedRevenueINR: 0,
    realSpendINR: 21300,
    activeCampaignsCount: 3,
    googleClicksCount: 0,
    trackedSessionsCount: 5,
    attributedLeadsCount: 0,
    unverifiedLeadsCount: 1,
    verifiedActualGoogleAdsSpendINR: 0
  }
};

export { AGENT_REGISTRY };
