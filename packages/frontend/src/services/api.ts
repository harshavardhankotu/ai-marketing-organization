export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('AI_MARKETING_API_URL');
    if (custom && custom.trim().length > 0) {
      if (custom.includes('loca.lt')) {
        localStorage.removeItem('AI_MARKETING_API_URL');
      } else {
        return custom.trim().replace(/\/+$/, '');
      }
    }
  }
  const envUrl = (import.meta as any).env?.VITE_API_BASE_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return '/api/v1';
}

export function setApiBaseUrl(url: string): void {
  if (typeof window !== 'undefined') {
    if (!url || url.trim().length === 0) {
      localStorage.removeItem('AI_MARKETING_API_URL');
    } else {
      localStorage.setItem('AI_MARKETING_API_URL', url.trim().replace(/\/+$/, ''));
    }
  }
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function onUnauthorized(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export async function fetchApi<T = any>(endpoint: string, options?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${base}${normalizedEndpoint}`;
  const isPublicEndpoint = normalizedEndpoint.startsWith('/public/') ||
    normalizedEndpoint === '/health' ||
    normalizedEndpoint.startsWith('/health/') ||
    normalizedEndpoint.startsWith('/payments/razorpay/health') ||
    normalizedEndpoint.startsWith('/compliance/dpdp/');
  const isAuthCheckOrLogin = normalizedEndpoint.startsWith('/auth/owner/session') ||
    normalizedEndpoint.startsWith('/auth/owner/login') ||
    normalizedEndpoint.startsWith('/auth/owner/logout');

  // Business context is purely for route filtering/selection, NEVER an authentication mechanism
  let activeBizId = '';
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('ai_marketing_active_business');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.id) activeBizId = parsed.id;
      }
    } catch {}
  }

  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'bypass-tunnel-reminder': '1',
        ...(activeBizId ? { 'x-business-id': activeBizId } : {}),
        ...(options?.headers || {})
      },
      ...options
    });
  } catch (netErr: any) {
    throw new ApiError(`Network error: Could not connect to API server at ${url}. ${netErr?.message || ''}`, 0);
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  // Intercept HTML responses from static SPA hosting rewrites (e.g. Firebase Hosting index.html fallback)
  if (contentType.includes('text/html') || text.trim().startsWith('<!doctype') || text.trim().startsWith('<html')) {
    throw new ApiError(
      `Backend API server not reached at ${url}. The cloud host returned static HTML instead of JSON. ` +
      `Ensure the local backend is running (npm start) and configure the API URL in Settings/Navbar.`,
      res.status
    );
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch (parseErr) {
    throw new ApiError(`Invalid JSON response from ${url} (status ${res.status}): ${text.slice(0, 100)}...`, res.status);
  }

  if (!res.ok) {
    const errorMsg = json?.error || `Request failed with status ${res.status}`;
    // If 401 on an authenticated admin endpoint, transition UI cleanly to unauthenticated state
    if (res.status === 401 && !isPublicEndpoint && !isAuthCheckOrLogin) {
      unauthorizedHandler?.();
    }
    throw new ApiError(errorMsg, res.status, json);
  }

  return json;
}

export const api = {
  getHealth: () => fetchApi('/health'),
  getQuota: () => fetchApi('/quota'),
  getAgents: () => fetchApi('/agents'),
  getAgentById: (id: string) => fetchApi(`/agents/${id}`),
  getBusiness: (id?: string) => fetchApi(id ? `/business?id=${id}` : '/business'),
  getPublicBusiness: (slug: string) => fetchApi(`/public/business/${encodeURIComponent(slug)}`),
  getPublicFunnel: (businessSlug: string, funnelSlug?: string) =>
    fetchApi(`/public/funnel/${encodeURIComponent(businessSlug)}${funnelSlug ? `/${encodeURIComponent(funnelSlug)}` : ''}`),
  createUniversalOrder: (data: any) =>
    fetchApi('/public/order', { method: 'POST', body: JSON.stringify(data) }),
  universalCheckout: (data: any) =>
    fetchApi('/public/checkout', { method: 'POST', body: JSON.stringify(data) }),
  createBookingReservation: (data: any) =>
    fetchApi('/public/booking', { method: 'POST', body: JSON.stringify(data) }),
  getAvailability: (businessSlug: string) =>
    fetchApi(`/public/availability?businessSlug=${encodeURIComponent(businessSlug)}`),
  createBusiness: (data: any) => fetchApi('/business', { method: 'POST', body: JSON.stringify(data) }),
  getGoals: () => fetchApi('/goals'),
  createGoal: (data: any) => fetchApi('/goals', { method: 'POST', body: JSON.stringify(data) }),
  getCampaigns: () => fetchApi('/campaigns'),
  getContent: () => fetchApi('/content'),
  getResearch: (businessId?: string) => fetchApi(`/research${businessId ? `?businessId=${businessId}` : ''}`),
  runResearchPipeline: (businessId: string) => fetchApi('/research/run', { method: 'POST', body: JSON.stringify({ businessId }) }),
  getResearchLogs: (businessId?: string) => fetchApi(`/research/logs${businessId ? `?businessId=${businessId}` : ''}`),
  getUniversalLocks: () => fetchApi('/quota/locks'),
  computeStrategy: (data: any) => fetchApi('/strategy/compute', { method: 'POST', body: JSON.stringify(data) }),
  getDashboardAnalytics: () => fetchApi('/analytics/dashboard'),
  getExperiments: () => fetchApi('/experiments'),
  getEvolution: () => fetchApi('/evolution'),
  getApprovals: () => fetchApi('/approvals'),
  resolveApproval: (data: { requestId: string; action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES'; feedbackNotes?: string }) =>
    fetchApi('/approvals/resolve', { method: 'POST', body: JSON.stringify(data) }),
  getIntegrations: () => fetchApi('/integrations'),
  getActivity: () => fetchApi('/activity'),
  triggerCycle: (businessId?: string, goalId?: string) =>
    fetchApi('/workflows/trigger-cycle', { method: 'POST', body: JSON.stringify({ businessId, goalId }) }),
  toggleKillSwitch: (businessId: string, active: boolean, reason: string) =>
    fetchApi('/kill-switch', { method: 'POST', body: JSON.stringify({ businessId, active, reason }) }),
  getRevenueSummary: () => fetchApi('/revenue/summary'),
  getTransactions: (classification?: string) =>
    fetchApi(`/revenue/transactions${classification ? `?classification=${classification}` : ''}`),
  recordTransaction: (data: any) =>
    fetchApi('/revenue/transactions', { method: 'POST', body: JSON.stringify(data) }),
  getCustomerJourneys: (classification?: string) =>
    fetchApi(`/customer-journeys${classification ? `?classification=${classification}` : ''}`),
  advanceJourney: (data: any) =>
    fetchApi('/customer-journeys/advance', { method: 'POST', body: JSON.stringify(data) }),
  getAICosts: () => fetchApi('/ai-costs'),
  getSystemReadiness: () => fetchApi('/system/readiness'),
  recordVerifiedEntry: (data: any) =>
    fetchApi('/revenue/verified-entry', { method: 'POST', body: JSON.stringify(data) }),
  post: (endpoint: string, data: any) =>
    fetchApi(endpoint, { method: 'POST', body: JSON.stringify(data) }),
  getRealEconomics: () => fetchApi('/economics/summary'),
  getAttributionEvidence: (journeyId: string) => fetchApi(`/attribution/evidence/${journeyId}`),
  getAutonomyStatus: () => fetchApi('/autonomy/status'),
  setAutonomyMode: (mode: string) => fetchApi('/autonomy/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  getAutonomyProposals: () => fetchApi('/autonomy/proposals'),
  getAutonomyExperiments: () => fetchApi('/autonomy/experiments'),
  getAgentScorecards: () => fetchApi('/agent-scorecards'),
  getMarketingMemory: (dimension?: string) => fetchApi(`/marketing-memory${dimension ? `?dimension=${dimension}` : ''}`),
  getKnowledgeGraph: () => fetchApi('/knowledge-graph'),
  getTruthEvents: (journeyId?: string) => fetchApi(`/truth/events${journeyId ? `?journeyId=${journeyId}` : ''}`),
  getTreatmentPlans: (journeyId: string) => fetchApi(`/treatment-plans/${journeyId}`),
  recordTreatmentPlan: (data: any) => fetchApi('/treatment-plans', { method: 'POST', body: JSON.stringify(data) }),
  optimizeCampaign: (data: any) => fetchApi('/campaigns/optimize', { method: 'POST', body: JSON.stringify(data) }),
  // Zero-Budget Organic Endpoints
  getOrganicChannels: () => fetchApi('/organic/channels'),
  getOrganicContent: () => fetchApi('/organic/content'),
  createOrganicContent: (data: any) => fetchApi('/organic/content', { method: 'POST', body: JSON.stringify(data) }),
  approveOrganicContent: (id: string, data: any) => fetchApi(`/organic/content/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  getLandingPages: () => fetchApi('/organic/landing-pages'),
  getOrganicReviews: () => fetchApi('/organic/reviews'),
  requestReview: (data: any) => fetchApi('/organic/reviews/request', { method: 'POST', body: JSON.stringify(data) }),
  getGBPInsights: () => fetchApi('/organic/gbp'),
  getOrganicEconomics: () => fetchApi('/organic/economics'),
  getZeroBudgetExperiments: () => fetchApi('/organic/experiments'),
  getTrafficStats: () => fetchApi('/organic/traffic-stats'),
  getTrafficSessions: (status?: string) => fetchApi(`/organic/sessions${status ? `?status=${status}` : ''}`),
  getAcquisitionEvidence: (id: string) => fetchApi(`/organic/acquisition-evidence/${id}`),
  getGBPOAuthStatus: () => fetchApi('/organic/gbp/oauth/status'),
  recordPublicationEvidence: (id: string, data: any) => fetchApi(`/organic/content/${id}/publish-evidence`, { method: 'POST', body: JSON.stringify(data) }),
  // Live Payment Gateway (Razorpay & Inbound UPI)
  createPaymentOrder: (data: { businessId?: string; journeyId?: string; amountINR: number; receipt?: string; service?: string; notes?: any; offerId?: string; organizationId?: string }) =>
    fetchApi('/payments/razorpay/create-order', { method: 'POST', body: JSON.stringify(data) }),
  verifyPayment: (data: { orderId: string; paymentId: string; signature: string; method?: string }) =>
    fetchApi('/payments/razorpay/verify', { method: 'POST', body: JSON.stringify(data) }),
  claimManualUPI: (data: { businessId: string; amountINR: number; utr: string; journeyId?: string; serviceRendered?: string; notes?: string }) =>
    fetchApi('/payments/manual-upi/claim', { method: 'POST', body: JSON.stringify(data) }),
  confirmManualUPI: (data: { claimId?: string; businessId: string; amountINR: number; utr: string; journeyId?: string; invoiceNumber?: string; serviceRendered?: string }) =>
    fetchApi('/payments/manual-upi/confirm', { method: 'POST', body: JSON.stringify(data) }),
  getPendingUpiClaims: () =>
    fetchApi('/payments/manual-upi/claims'),
  createRazorpayPaymentLink: (data: { businessId?: string; amountINR: number; description: string; customer?: any; proposalId?: string; prospectId?: string; offerId: string; organizationId?: string }) =>
    fetchApi('/payments/razorpay/create-payment-link', { method: 'POST', body: JSON.stringify(data) }),
  // Single-Owner Auth & Administration
  loginOwner: (apiKey: string) =>
    fetchApi('/auth/owner/login', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  logoutOwner: () =>
    fetchApi('/auth/owner/logout', { method: 'POST' }),
  getOwnerSession: () =>
    fetchApi('/auth/owner/session'),
  // Setup Wizard & Commercial Proof
  getSetupStatus: () => fetchApi('/setup/status'),
  runLiveSmokeTest: () => fetchApi('/setup/live-smoke-test', { method: 'POST' }),
  getCommercialProof: () => fetchApi('/commercial/proof'),
  // DPDP Statutory Compliance
  recordDPDPConsent: (data: any) =>
    fetchApi('/compliance/dpdp/consent', { method: 'POST', body: JSON.stringify(data) }),
  requestDPDPErasure: (data: any) =>
    fetchApi('/compliance/dpdp/erasure', { method: 'POST', body: JSON.stringify(data) }),
};