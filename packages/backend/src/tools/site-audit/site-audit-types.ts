/**
 * SiteFix AI: Site Audit & Optimization Pack Types
 * Strictly implements requirements from V6 Specification Parts 2 & 3.
 */

export type FindingCategory =
  | 'HTML_METADATA'
  | 'STRUCTURED_DATA'
  | 'SEARCH_ACCESSIBILITY'
  | 'PERFORMANCE_INDICATORS'
  | 'CONVERSION_PATH';

export type FindingStatus =
  | 'PASS'
  | 'WARNING'
  | 'ISSUE'
  | 'NOT_CHECKED'
  | 'NOT_APPLICABLE'
  | 'NEEDS_USER_CONFIRMATION';

export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface AuditFinding {
  id: string;
  category: FindingCategory;
  title: string;
  status: FindingStatus;
  severity: FindingSeverity;
  location: string;
  evidence: string;
  explanation: string;
  recommendation: string;
  confidence: number; // 0 - 100
  canAutoGenerate: boolean;
  needsUserConfirmation: boolean;
}

export interface SiteAuditMetrics {
  httpStatus: number;
  responseTimeMs: number;
  htmlSizeBytes: number;
  contentType: string;
  redirectChain: string[];
  hasRobotsTxt: boolean;
  hasSitemap: boolean;
  jsonLdTypesFound: string[];
  contactChannelsFound: string[];
}

export interface SiteAuditPreview {
  title: string;
  metaDescription: string;
  canonicalUrl: string;
  ogTitle: string;
  ogImage: string;
  fixPackSnippetPreview: string;
}

export interface SiteAuditDisclosures {
  notFullCrawl: boolean;
  noRankGuarantee: boolean;
  noWebVitalsClaim: boolean;
}

export interface SiteAuditPageSpeedData {
  status: 'SUCCESS' | 'UNAVAILABLE';
  reason?: string;
  notice?: string;
  performanceScore?: number;
  seoScore?: number;
  coreWebVitals?: {
    lcp: string;
    fcp: string;
    cls: string;
    tbt: string;
  } | null;
  opportunities?: Array<{
    id: string;
    title: string;
    description: string;
    savingsEst?: string;
  }>;
}

export interface SiteAuditResult {
  auditId: string;
  url: string;
  scannedAt: string;
  overallStatus: 'OPTIMIZED' | 'NEEDS_IMPROVEMENT' | 'ACTION_REQUIRED';
  score: number; // Deterministic 0-100 score
  scoreExplanation: string;
  findings: AuditFinding[];
  metrics: SiteAuditMetrics;
  preview: SiteAuditPreview;
  disclosures: SiteAuditDisclosures;
  pageSpeed?: SiteAuditPageSpeedData;
  businessName?: string;
  domain?: string;
  probedAt?: string;
  scorecard?: {
    totalScore: number;
    grade?: string;
    items?: any[];
  };
}

export interface SiteAuditScanRequest {
  url: string;
  websiteType?: 'LOCAL_BUSINESS' | 'SHOPIFY_ECOMMERCE' | 'FREELANCER_PORTFOLIO' | 'SAAS' | 'GENERAL_CONTENT';
  businessCategory?: string;
  businessName?: string;
  skipCache?: boolean;
  userConfirmedOwnership?: boolean;
}

export interface FixPackDeliverable {
  auditId: string;
  orderId?: string;
  generatedAt: string;
  targetUrl: string;
  headMetadataSnippet: string;
  openGraphSnippet: string;
  twitterCardSnippet: string;
  schemaJsonLdSnippet: string;
  canonicalUrlRecommendation: string;
  checklistMarkdown: string;
  recommendedOwnerAdditions?: string[];
  missingFieldsRequiringOwnerInput?: string[];
  fullReportJson: any;
  disclosure: string;
}

export interface CheckoutReadiness {
  status: 'READY' | 'LOCKED_MISSING_CONFIGURATION' | 'PENDING_OWNER_ATTESTATION';
  isReady: boolean;
  missingConfig: string[];
  termsSha256?: string;
  expectedSha256?: string;
}

export interface FixPackDeliveryTokenPayload {
  auditId: string;
  orderId: string;
  paymentId: string;
  sku: 'SITEFIX_AI_PACK_V1';
  exp: number;
}

export interface FixPackDeliveryToken {
  orderId: string;
  auditId: string;
  sku: string;
  expiresAt: number;
  signature: string;
}
