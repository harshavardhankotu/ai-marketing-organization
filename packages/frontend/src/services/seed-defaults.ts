import { AGENT_REGISTRY } from '@ai-marketing/shared';

export const DEFAULT_BUSINESS: any = null;

export const DEFAULT_GOALS: any[] = [];

export const DEFAULT_CAMPAIGNS: any[] = [];

export const DEFAULT_CONTENT_ASSETS: any[] = [];

export const DEFAULT_RESEARCH: any[] = [];

export const DEFAULT_EXPERIMENTS: any[] = [];

export const DEFAULT_EVOLUTION: any = {
  strategies: [],
  decisions: []
};

export const DEFAULT_METRICS = {
  impressions: 0,
  clicks: 0,
  leads: 0,
  qualifiedLeads: 0,
  opportunities: 0,
  customers: 0,
  revenueINR: 0,
  spendINR: 0,
  cacINR: 0,
  roas: 0
};

export const DEFAULT_APPROVALS: any[] = [];

export const DEFAULT_INTEGRATIONS = [
  { provider: 'GOOGLE_SEARCH_API', status: 'READY', mode: 'LIVE', details: 'Google Custom Search JSON API' },
  { provider: 'GOOGLE_BUSINESS_PROFILE', status: 'PENDING_CONFIG', mode: 'SANDBOX', details: 'Awaiting Location Authorization' },
  { provider: 'GOOGLE_ADS', status: 'READY', mode: 'LIVE', details: 'Google Ads Search Network' },
  { provider: 'META_ADS', status: 'PENDING_CONFIG', mode: 'SANDBOX', details: 'Awaiting Meta Marketing Graph API' },
  { provider: 'WHATSAPP', status: 'PENDING_CONFIG', mode: 'SANDBOX', details: 'Awaiting Meta Cloud API Credentials' },
  { provider: 'EMAIL', status: 'NOT_CONNECTED', mode: 'SANDBOX', details: 'Transactional SMTP Gateway' }
];

export const DEFAULT_QUOTA = {
  geminiRequestsToday: 0,
  geminiMaxDailyRequests: 1500,
  circuitBreakerTripped: false
};

export const DEFAULT_READINESS = {
  status: 'AWAITING_ONBOARDING',
  operatingState: 'AWAITING_ONBOARDING',
  metrics: {
    realLeadsCount: 0,
    realConsultationsCount: 0,
    realCustomersCount: 0,
    realRevenueINR: 0,
    realAttributedRevenueINR: 0,
    realSpendINR: 0
  }
};

export { AGENT_REGISTRY };
