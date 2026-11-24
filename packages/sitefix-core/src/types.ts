/**
 * SiteFix Core: Pure Types for Deterministic Scanner, SSRF Fetcher & Fix-Pack Generator
 * Zero database, HTTP server, or third-party runtime dependencies.
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
  ogDescription?: string;
  ogImage: string;
  ogImageWidth?: string;
  ogImageHeight?: string;
  ogUrl?: string;
  ogType?: string;
  twitterCard?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  fixPackSnippetPreview: string;
}

export interface OpenGraphInspection {
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogImageIsHttps: boolean;
  ogImageWidth: string | null;
  ogImageHeight: string | null;
  ogUrl: string | null;
  ogType: string | null;
  whatsappReadinessStatus: 'READY' | 'NEEDS_ATTENTION' | 'INCOMPLETE';
  whatsappCacheNotice: string;
}

export interface TwitterCardInspection {
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
  twitterSite: string | null;
}

export interface RobotsSitemapInspection {
  metaRobotsNoindex: boolean;
  metaRobotsContent: string | null;
  robotsTxtUrl: string;
  robotsTxtStatus: number | null;
  robotsTxtFound: boolean;
  robotsTxtDisallowsAll: boolean;
  robotsTxtDirectives: string[];
  sitemapUrlsDeclared: string[];
  sitemapCheckedUrl: string | null;
  sitemapReachable: boolean;
  sitemapHttpStatus: number | null;
}

export interface JsonLdBlockInspection {
  blockIndex: number;
  validSyntax: boolean;
  syntaxError?: string;
  types: string[];
  missingRecommendedFields: Array<{
    type: string;
    field: string;
    reason: string;
  }>;
  rawSnippet: string;
}

export interface JsonLdInspection {
  blockCount: number;
  validBlockCount: number;
  invalidBlockCount: number;
  typesFound: string[];
  blocks: JsonLdBlockInspection[];
}

export interface SiteAuditDetailedDiagnostics {
  openGraph: OpenGraphInspection;
  twitterCard: TwitterCardInspection;
  robotsAndSitemap: RobotsSitemapInspection;
  jsonLd: JsonLdInspection;
}

export interface SiteAuditDisclosures {
  notFullCrawl: boolean;
  noRankGuarantee: boolean;
  noWebVitalsClaim: boolean;
}

export interface SiteAuditPageSpeedData {
  status: 'SUCCESS' | 'UNAVAILABLE' | 'UNAVAILABLE_RATE_LIMITED' | 'UNAVAILABLE_KEY_ERROR';
  pageSpeedStatus?: 'SUCCESS' | 'UNAVAILABLE' | 'UNAVAILABLE_RATE_LIMITED' | 'UNAVAILABLE_KEY_ERROR';
  reason?: string;
  notice?: string;
  performanceScore?: number | null;
  seoScore?: number | null;
  coreWebVitals?: {
    lcp?: string;
    fcp?: string;
    cls?: string;
    tbt?: string;
  } | null;
  opportunities?: Array<{
    id: string;
    title: string;
    description: string;
    savingsEst?: string;
  }>;
}

export interface ProspectTriggerSignals {
  hasPaidAdPixel: boolean;
  adPixelVendors: string[];
  hasConversionLeak: boolean;
  hasReachableEmail: boolean;
  discoveredEmails: string[];
  hasTechnicalSeoDefects: boolean;
  defectCount: number;
  isNationalChainOrDirectory: boolean;
  isRegulatedHealthcare?: boolean;
  eligibleForOutreach?: boolean;
  prospectTriggerScore: number;
  triggerTags: string[];
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
  diagnostics?: SiteAuditDetailedDiagnostics;
  prospectSignals?: ProspectTriggerSignals;
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
  websiteType?:
    | 'DEVELOPER_LAUNCH_QA'
    | 'LOCAL_BUSINESS'
    | 'SHOPIFY_ECOMMERCE'
    | 'FREELANCER_PORTFOLIO'
    | 'SAAS'
    | 'GENERAL_CONTENT';
  businessCategory?: string;
  businessName?: string;
  skipCache?: boolean;
  userConfirmedOwnership?: boolean;
}

export interface RecheckCheckItem {
  checkId: string;
  findingId: string;
  category: FindingCategory;
  title: string;
  baselineStatus?: FindingStatus;
  recheckStatus?: FindingStatus;
  severity: FindingSeverity;
}

export interface RecheckComparisonResult {
  baselineAuditId: string;
  recheckAuditId: string;
  url: string;
  baselineScore: number;
  recheckScore: number;
  scoreDelta: number;
  resolvedChecks: RecheckCheckItem[];
  remainingChecks: RecheckCheckItem[];
  regressions: RecheckCheckItem[];
  allCriticalResolved: boolean;
  checkedAt: string;
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
  robotsTxtSnippet?: string;
  sitemapXmlSnippet?: string;
  canonicalUrlRecommendation: string;
  checklistMarkdown: string;
  recommendedOwnerAdditions?: string[];
  missingFieldsRequiringOwnerInput?: string[];
  fullReportJson: any;
  disclosure: string;
}

export interface PaymentReadinessState {
  sandboxTestReady: boolean;
  liveMoneyReady: boolean;
  paymentMode: 'LIVE' | 'SANDBOX' | 'UNCONFIGURED';
  ownerOfferAttested: boolean;
  gatewayCredentialStatus: 'VERIFIED_LIVE' | 'VERIFIED_TEST' | 'NOT_VERIFIED';
  missingConfiguration: string[];
}

export interface CheckoutReadiness {
  status: 'READY' | 'LOCKED_MISSING_CONFIGURATION' | 'PENDING_OWNER_ATTESTATION';
  isReady: boolean;
  missingConfig: string[];
  termsSha256?: string;
  expectedSha256?: string;
  paymentReadiness: PaymentReadinessState;
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

export interface SecureFetchResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  timingMs: number;
  bytesReceived: number;
  contentType: string;
  redirectChain: string[];
}

export interface SecureFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxSizeBytes?: number;
  acceptContentTypes?: string[];
  userAgent?: string;
  allowHttpForTesting?: boolean;
  /**
   * Optional injected Web Fetch implementation (e.g. for local CLI tests or custom transports).
   * URL structure, protocol, port, redirect hops, timeout, and body size caps are still enforced.
   */
  fetchImpl?: typeof fetch;
  /**
   * Only honored when fetchImpl is explicitly injected (e.g. mocked domains in unit tests).
   * Production native fetches ALWAYS execute DNS resolve-then-connect with pinned IP validation.
   */
  skipDnsForInjectedFetch?: boolean;
}
