import { IndianLanguage } from '../constants/india.js';

export type AutonomyMode = 'SAFE' | 'ASSISTED' | 'AUTONOMOUS';
export type SectorRiskTier = 'LOW' | 'MEDIUM' | 'HIGH';

export type AgentCategory = 
  | 'RESEARCH_INTELLIGENCE'
  | 'CONTENT'
  | 'MARKETING_GROWTH'
  | 'ANALYTICS_LEARNING';

export type AgentStatus = 'IDLE' | 'BUSY' | 'PAUSED' | 'WAITING_APPROVAL' | 'ERROR' | 'THROTTLED';
export type TaskPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | 'BACKGROUND';
export type TaskStatus = 
  | 'PENDING'
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'WAITING_APPROVAL'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type WorkflowStatus = 
  | 'PENDING'
  | 'RUNNING'
  | 'CHECKPOINTED'
  | 'WAITING_FOR_APPROVAL'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EMERGENCY_STOPPED';

export type EvidenceCertainty = 'OBSERVED' | 'INFERRED' | 'HYPOTHESIZED' | 'PREDICTED' | 'CONFIRMED';

export type ExperimentStatus = 'DRAFT' | 'RUNNING' | 'EVALUATING' | 'CONCLUDED' | 'CANCELLED';
export type ExperimentOutcome = 'SCALE' | 'MODIFY' | 'STOP' | 'RERUN' | 'INCONCLUSIVE';

export type AttributionModelType = 'FIRST_TOUCH' | 'LAST_TOUCH' | 'LINEAR' | 'ASSISTED_CONVERSION';

export type MarketingChannel = 
  | 'WHATSAPP'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'GOOGLE_BUSINESS_PROFILE'
  | 'GOOGLE_SEARCH_ADS'
  | 'META_ADS'
  | 'YOUTUBE'
  | 'LINKEDIN'
  | 'EMAIL'
  | 'SMS';

export type AnalyticsEventType = 
  | 'impression'
  | 'view'
  | 'click'
  | 'engagement'
  | 'visit'
  | 'signup'
  | 'lead'
  | 'qualified_lead'
  | 'appointment'
  | 'purchase'
  | 'revenue'
  | 'retention'
  | 'unsubscribe'
  | 'campaign_interaction';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MARKETER' | 'VIEWER';
  createdAt: string;
}

export interface BusinessProfile {
  id: string;
  organizationId: string;
  name: string;
  verticalId: string;
  verticalName: string;
  riskTier: SectorRiskTier;
  country: string;
  currency: string;
  timezone: string;
  city: string;
  neighborhood: string;
  websiteUrl?: string;
  phone?: string;
  primaryLanguage: IndianLanguage;
  secondaryLanguages: IndianLanguage[];
  brandVoice: string;
  valuePropositions: string[];
  offerings: {
    id: string;
    title: string;
    description: string;
    priceINR: number;
    targetSegment: string;
  }[];
  constraints: {
    monthlyBudgetINR: number;
    maxDailySpendINR: number;
    excludedTopics: string[];
    complianceMandates: string[];
  };
  autonomyMode: AutonomyMode;
  killSwitchActive: boolean;
  killSwitchReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessGoal {
  id: string;
  organizationId: string;
  businessId: string;
  title: string;
  targetMetric: string;
  targetValue: number;
  currentValue: number;
  metricUnit: string;
  timeframeDays: number;
  startDate: string;
  targetDate: string;
  budgetAllocatedINR: number;
  status: 'ACTIVE' | 'ACHIEVED' | 'AT_RISK' | 'PAUSED' | 'ABANDONED';
  kpis: {
    name: string;
    baseline: number;
    target: number;
    current: number;
    unit: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentDescriptor {
  id: string;
  name: string;
  category: AgentCategory;
  role: string;
  systemInstruction: string;
  capabilities: string[];
  allowedTools: string[];
  inputSchema: Record<string, any>;
  outputSchema: Record<string, any>;
  confidenceThreshold: number;
  taskPermissions: string[];
  costBudget: number;
  executionLimits: {
    maxRetries: number;
    timeoutSeconds: number;
    maxTokens: number;
  };
  performanceMetrics: {
    completionRate: number;
    approvalRate: number;
    avgLatencyMs: number;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    costIncurredINR: number;
  };
  memoryScope: 'BUSINESS' | 'MARKET' | 'CAMPAIGN' | 'AGENT' | 'SYSTEM';
  evaluationCriteria: string[];
  failurePolicy: 'RETRY' | 'ESCALATE_TO_SUPERVISOR' | 'FALLBACK_TO_HEURISTIC' | 'ABORT';
  retryPolicy: {
    maxAttempts: number;
    backoffBaseMs: number;
  };
  status: AgentStatus;
  version: string;
}

export interface StrategyRecord {
  id: string;
  organizationId: string;
  businessId: string;
  goalId: string;
  version: number;
  title: string;
  rationale: string;
  positioning: string;
  targetAudienceSegments: {
    segmentName: string;
    demographics: string;
    painPoints: string[];
    motivations: string[];
    localContext: string;
  }[];
  channelStrategy: {
    channel: MarketingChannel;
    budgetAllocationPercentage: number;
    projectedLeadSharePercentage: number;
    rationale: string;
    languages: IndianLanguage[];
  }[];
  contentThemes: string[];
  expectedLeads: number;
  expectedCostPerQualifiedLeadINR: number;
  status: 'ACTIVE' | 'SUPERSEDED' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
}

export interface CampaignRecord {
  id: string;
  organizationId: string;
  businessId: string;
  strategyId: string;
  goalId: string;
  title: string;
  objective: string;
  channels: MarketingChannel[];
  targetAudience: string;
  geography: {
    city: string;
    neighborhoods: string[];
  };
  budgetINR: number;
  spentINR: number;
  status: 'DRAFT' | 'REVIEW' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  startDate: string;
  endDate: string;
  primaryKPI: string;
  targetQualifiedLeads: number;
  achievedQualifiedLeads: number;
  conversionThreshold: number;
  experimentPlanId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentAssetRecord {
  id: string;
  organizationId: string;
  campaignId: string;
  agentId: string;
  title: string;
  channel: MarketingChannel;
  contentType: 'POST' | 'STORY' | 'REEL_SCRIPT' | 'WHATSAPP_MESSAGE' | 'AD_COPY' | 'EMAIL' | 'LANDING_PAGE';
  language: IndianLanguage;
  content: string;
  mediaPrompt?: string;
  callToAction: string;
  targetFunnelStage: 'AWARENESS' | 'CONSIDERATION' | 'CONVERSION' | 'RETENTION';
  version: number;
  status: 'DRAFT' | 'QA_PENDING' | 'WAITING_APPROVAL' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'REJECTED';
  brandVoiceScore: number;
  factualConfidence: number;
  complianceFlags: string[];
  performance: {
    impressions: number;
    clicks: number;
    leads: number;
    qualifiedLeads: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ResearchFindingRecord {
  id: string;
  organizationId: string;
  businessId: string;
  agentId: string;
  topic: string;
  market: string;
  finding: string;
  extractedEvidence: string;
  source: string;
  sourceUrl?: string;
  certainty: EvidenceCertainty;
  confidenceScore: number;
  relevanceScore: number;
  tags: string[];
  createdAt: string;
}

export interface DecisionRecord {
  id: string;
  organizationId: string;
  businessId: string;
  strategyId?: string;
  campaignId?: string;
  agentId: string;
  decision: string;
  reason: string;
  evidence: string;
  source: string;
  confidence: number;
  alternativesConsidered: string[];
  expectedOutcome: string;
  actualOutcome?: string;
  outcomeEvaluation?: 'EXCEEDED' | 'MET' | 'BELOW' | 'FAILED' | 'PENDING';
  impactDeltaPercent?: number;
  createdAt: string;
  evaluatedAt?: string;
}

export interface ExperimentRecord {
  id: string;
  organizationId: string;
  businessId: string;
  campaignId?: string;
  title: string;
  hypothesis: string;
  baseline: string;
  treatment: string;
  successMetric: string;
  minimumEvidenceRequirement: number;
  expectedEffect: string;
  startDate: string;
  endDate?: string;
  status: ExperimentStatus;
  outcome?: ExperimentOutcome;
  confidenceScore: number;
  decisionSummary?: string;
  metrics: {
    baselineSamples: number;
    baselineConversions: number;
    treatmentSamples: number;
    treatmentConversions: number;
    pVal: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface LearningRecord {
  id: string;
  organizationId: string;
  businessId: string;
  sourceExperimentId?: string;
  observation: string;
  hypothesis: string;
  experimentResult: string;
  learning: string;
  policyUpdate: string;
  confidence: number;
  appliedToStrategyVersion?: number;
  createdAt: string;
}

export interface HumanApprovalRequest {
  id: string;
  organizationId: string;
  businessId: string;
  requesterAgentId: string;
  title: string;
  description: string;
  entityType: 'CAMPAIGN' | 'CONTENT_ASSET' | 'BUDGET_INCREASE' | 'STRATEGY_UPDATE' | 'HIGH_RISK_PUBLISH';
  entityId: string;
  riskScore: number; // 0 - 100
  riskFactors: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
  feedbackNotes?: string;
  reviewedByUserId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface QuotaStatus {
  freeTierActive: boolean;
  geminiRequestsToday: number;
  geminiMaxDailyRequests: number;
  geminiTokensToday: number;
  geminiMaxDailyTokens: number;
  activeConcurrentCalls: number;
  maxConcurrentCalls: number;
  circuitBreakerTripped: boolean;
  queueDepth: number;
  quotaWarning: boolean;
  throttledMode: boolean;
}

export type DataClassification = 'REAL' | 'TEST' | 'SIMULATED';

export type CustomerJourneyStage = 
  | 'VISITOR' 
  | 'SESSION' 
  | 'LEAD' 
  | 'QUALIFIED_LEAD' 
  | 'OPPORTUNITY' 
  | 'CUSTOMER' 
  | 'CHURNED';

export type PaymentMethod = 
  | 'UPI' 
  | 'NETBANKING' 
  | 'CREDIT_CARD' 
  | 'DEBIT_CARD' 
  | 'NO_COST_EMI' 
  | 'CASH' 
  | 'OTHER';

export type PaymentGateway = 
  | 'RAZORPAY' 
  | 'CASHFREE' 
  | 'STRIPE' 
  | 'PHONEPE_PG' 
  | 'MANUAL' 
  | 'SIMULATED';

export interface CustomerTouchpoint {
  channel: MarketingChannel;
  campaignId?: string;
  timestamp: string;
  event: string;
  metadata?: Record<string, unknown>;
}

export interface CustomerJourneyRecord {
  id: string;
  organizationId: string;
  businessId: string;
  visitorId: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  stage: CustomerJourneyStage;
  firstTouchChannel?: MarketingChannel;
  lastTouchChannel?: MarketingChannel;
  touchpoints: CustomerTouchpoint[];
  totalLifetimeValueINR: number;
  classification: DataClassification;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionRecord {
  id: string;
  organizationId: string;
  businessId: string;
  journeyId?: string;
  campaignId?: string;
  invoiceNumber: string;
  amountINR: number;
  paymentMethod: PaymentMethod;
  paymentGateway: PaymentGateway;
  transactionRef?: string;
  status: 'SUCCESS' | 'PENDING' | 'REFUNDED' | 'FAILED';
  classification: DataClassification;
  serviceRendered?: string;
  createdAt: string;
}

export interface AICostRecord {
  id: string;
  organizationId: string;
  businessId: string;
  agentId: string;
  division: AgentCategory;
  model: string;
  thinkingLevel: 'none' | 'low' | 'medium' | 'high';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostINR: number;
  purpose: string;
  createdAt: string;
}

export interface RevenueReconciliationSummary {
  realRevenueINR: number;
  testRevenueINR: number;
  simulatedRevenueINR: number;
  totalTransactions: number;
  attributedTransactions: number;
  unattributedTransactions: number;
  totalAICostINR: number;
  aiCostPerQualifiedLeadINR: number;
  aiCostPerCustomerINR: number;
  roas: number;
  realRoas: number;
  testRoas: number;
}