const API_BASE = '/api/v1';

export async function fetchApi<T = any>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-organization-id': 'org_smilekraft_01',
      'x-user-id': 'usr_owner_01',
      ...(options?.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

export const api = {
  getHealth: () => fetchApi('/health'),
  getQuota: () => fetchApi('/quota'),
  getAgents: () => fetchApi('/agents'),
  getAgentById: (id: string) => fetchApi(`/agents/${id}`),
  getBusiness: () => fetchApi('/business'),
  createBusiness: (data: any) => fetchApi('/business', { method: 'POST', body: JSON.stringify(data) }),
  getGoals: () => fetchApi('/goals'),
  createGoal: (data: any) => fetchApi('/goals', { method: 'POST', body: JSON.stringify(data) }),
  getCampaigns: () => fetchApi('/campaigns'),
  getContent: () => fetchApi('/content'),
  getResearch: () => fetchApi('/research'),
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
};