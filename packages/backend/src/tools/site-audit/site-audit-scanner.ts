/**
 * SiteFix AI: Deterministic Website Audit Scanner Engine
 * Strictly implements V6 Specification Part 2.1, 2.3, and 8.1.
 */

import { URL } from 'url';
import {
  AuditFinding,
  FindingCategory,
  FindingSeverity,
  FindingStatus,
  SiteAuditMetrics,
  SiteAuditPreview,
  SiteAuditResult,
  SiteAuditScanRequest
} from './site-audit-types.js';
import { SecureFetchResult, SecureUrlFetcher } from './secure-url-fetcher.js';

export class SiteAuditScanner {
  private fetcher = new SecureUrlFetcher();

  /**
   * Executes a full deterministic audit scan on the specified target website.
   */
  public async scanUrl(
    request: SiteAuditScanRequest,
    customFetchResult?: SecureFetchResult
  ): Promise<SiteAuditResult> {
    const rawUrl = request.url.trim();
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const scannedAt = new Date().toISOString();

    // 1. Fetch HTML safely via SecureUrlFetcher (or use customFetchResult in unit tests)
    let fetchResult: SecureFetchResult;
    if (customFetchResult) {
      fetchResult = customFetchResult;
    } else {
      fetchResult = await this.fetcher.fetch(rawUrl, {
        timeoutMs: 8000,
        maxRedirects: 3,
        maxSizeBytes: 1024 * 1024,
        acceptContentTypes: ['text/html', 'application/xhtml+xml']
      });
    }

    const html = fetchResult.body;
    const finalUrlObj = new URL(fetchResult.finalUrl);
    const findings: AuditFinding[] = [];

    // 2. Perform Category A: HTML & Metadata Audit
    const htmlMetaFindings = this.auditHtmlAndMetadata(html, fetchResult.finalUrl);
    findings.push(...htmlMetaFindings.findings);

    // 3. Perform Category B: Structured Data (JSON-LD) Audit
    const structuredDataFindings = this.auditStructuredData(html, request.websiteType);
    findings.push(...structuredDataFindings.findings);

    // 4. Perform Category C: Search Accessibility Audit
    const searchAccessibilityFindings = await this.auditSearchAccessibility(
      fetchResult,
      finalUrlObj,
      customFetchResult ? false : true
    );
    findings.push(...searchAccessibilityFindings.findings);

    // 5. Perform Category D: Performance Indicators
    const performanceFindings = this.auditPerformance(fetchResult);
    findings.push(...performanceFindings.findings);

    // 6. Perform Category E: Conversion Path Indicators
    const conversionFindings = this.auditConversionPath(html);
    findings.push(...conversionFindings.findings);

    // 7. Calculate Deterministic Score (0-100)
    const { score, overallStatus, explanation } = this.calculateDeterministicScore(findings);

    // 8. Assemble Metrics
    const metrics: SiteAuditMetrics = {
      httpStatus: fetchResult.statusCode,
      responseTimeMs: fetchResult.timingMs,
      htmlSizeBytes: fetchResult.bytesReceived || Buffer.byteLength(html, 'utf8'),
      contentType: fetchResult.contentType,
      redirectChain: fetchResult.redirectChain,
      hasRobotsTxt: searchAccessibilityFindings.hasRobotsTxt,
      hasSitemap: searchAccessibilityFindings.hasSitemap,
      jsonLdTypesFound: structuredDataFindings.typesFound,
      contactChannelsFound: conversionFindings.contactChannels
    };

    // 9. Generate Honest Free Preview
    const preview: SiteAuditPreview = {
      title: htmlMetaFindings.title || '(No <title> found)',
      metaDescription: htmlMetaFindings.metaDescription || '(No meta description found)',
      canonicalUrl: htmlMetaFindings.canonicalUrl || '(No canonical URL specified)',
      ogTitle: htmlMetaFindings.ogTitle || '(No og:title found)',
      ogImage: htmlMetaFindings.ogImage || '(No og:image specified)',
      fixPackSnippetPreview: this.generateQuickSnippetPreview(
        finalUrlObj.href,
        htmlMetaFindings.title,
        htmlMetaFindings.metaDescription,
        structuredDataFindings.typesFound
      )
    };

    return {
      auditId,
      url: rawUrl,
      scannedAt,
      overallStatus,
      score,
      scoreExplanation: explanation,
      findings,
      metrics,
      preview,
      disclosures: {
        notFullCrawl: true,
        noRankGuarantee: true,
        noWebVitalsClaim: true
      }
    };
  }

  /**
   * Category A: HTML & Metadata Audit
   */
  private auditHtmlAndMetadata(html: string, url: string): {
    findings: AuditFinding[];
    title: string;
    metaDescription: string;
    canonicalUrl: string;
    ogTitle: string;
    ogImage: string;
  } {
    const findings: AuditFinding[] = [];

    // Title tag
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    if (!title) {
      findings.push({
        id: 'meta_title_missing',
        category: 'HTML_METADATA',
        title: 'Missing HTML <title> Tag',
        status: 'ISSUE',
        severity: 'CRITICAL',
        location: '<head>',
        evidence: 'No <title> tag was found in the document <head>.',
        explanation: 'The <title> tag is the primary element used by search engines and browsers to understand page topic and render search snippets.',
        recommendation: 'Add a descriptive <title> tag between 30 and 65 characters defining your brand and primary service.',
        confidence: 100,
        canAutoGenerate: true,
        needsUserConfirmation: false
      });
    } else if (title.length < 15) {
      findings.push({
        id: 'meta_title_too_short',
        category: 'HTML_METADATA',
        title: 'HTML <title> Too Short',
        status: 'WARNING',
        severity: 'MEDIUM',
        location: `<title>${title}</title>`,
        evidence: `Current title length is ${title.length} characters: "${title}".`,
        explanation: 'Very short titles under 15 characters fail to convey sufficient context to search engines and potential visitors.',
        recommendation: 'Expand title to 30-65 characters including your business name and specific offering.',
        confidence: 95,
        canAutoGenerate: true,
        needsUserConfirmation: true
      });
    } else if (title.length > 70) {
      findings.push({
        id: 'meta_title_too_long',
        category: 'HTML_METADATA',
        title: 'HTML <title> Exceeds Optimal Length',
        status: 'WARNING',
        severity: 'LOW',
        location: `<title>${title.substring(0, 50)}...</title>`,
        evidence: `Current title length is ${title.length} characters.`,
        explanation: 'Titles longer than 65-70 characters are typically truncated in desktop and mobile search engine result pages (SERPs).',
        recommendation: 'Condense title to under 65 characters so key phrases remain visible without truncation.',
        confidence: 90,
        canAutoGenerate: true,
        needsUserConfirmation: true
      });
    } else {
      findings.push({
        id: 'meta_title_optimal',
        category: 'HTML_METADATA',
        title: 'HTML <title> Tag Present and Optimal',
        status: 'PASS',
        severity: 'INFO',
        location: `<title>${title}</title>`,
        evidence: `Length: ${title.length} characters: "${title}".`,
        explanation: 'The title tag is within the optimal length range (15-70 characters).',
        recommendation: 'Maintain this concise, relevant page title.',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    }

    // Meta Description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
    const metaDescription = descMatch ? descMatch[1].trim() : '';

    if (!metaDescription) {
      findings.push({
        id: 'meta_description_missing',
        category: 'HTML_METADATA',
        title: 'Missing Meta Description',
        status: 'ISSUE',
        severity: 'HIGH',
        location: '<head>',
        evidence: 'No <meta name="description"> tag was discovered in page HTML.',
        explanation: 'Search engines often display the meta description as the snippet preview under your title in search results.',
        recommendation: 'Add a compelling meta description between 50 and 160 characters describing your core value proposition.',
        confidence: 100,
        canAutoGenerate: true,
        needsUserConfirmation: false
      });
    } else if (metaDescription.length < 50) {
      findings.push({
        id: 'meta_description_too_short',
        category: 'HTML_METADATA',
        title: 'Meta Description Too Brief',
        status: 'WARNING',
        severity: 'LOW',
        location: `<meta name="description" content="${metaDescription}">`,
        evidence: `Length is ${metaDescription.length} characters: "${metaDescription}".`,
        explanation: 'Descriptions under 50 characters miss the opportunity to describe key customer benefits and encourage click-throughs.',
        recommendation: 'Expand description to 100-150 characters with a clear call-to-action.',
        confidence: 90,
        canAutoGenerate: true,
        needsUserConfirmation: true
      });
    } else if (metaDescription.length > 165) {
      findings.push({
        id: 'meta_description_too_long',
        category: 'HTML_METADATA',
        title: 'Meta Description May Be Truncated',
        status: 'WARNING',
        severity: 'LOW',
        location: '<meta name="description">',
        evidence: `Length is ${metaDescription.length} characters.`,
        explanation: 'Descriptions exceeding 160 characters are usually truncated on mobile search results.',
        recommendation: 'Keep primary messaging within the first 150-155 characters.',
        confidence: 85,
        canAutoGenerate: true,
        needsUserConfirmation: true
      });
    } else {
      findings.push({
        id: 'meta_description_optimal',
        category: 'HTML_METADATA',
        title: 'Meta Description Present and Well-Sized',
        status: 'PASS',
        severity: 'INFO',
        location: `<meta name="description" content="${metaDescription}">`,
        evidence: `Length: ${metaDescription.length} characters.`,
        explanation: 'Meta description exists within the recommended 50-160 character boundary.',
        recommendation: 'Keep content aligned with user search intent.',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    }

    // Canonical Tag
    const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i) ||
      html.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["'][^>]*>/i);
    const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : '';

    if (!canonicalUrl) {
      findings.push({
        id: 'canonical_tag_missing',
        category: 'HTML_METADATA',
        title: 'Missing Rel Canonical Link',
        status: 'WARNING',
        severity: 'MEDIUM',
        location: '<head>',
        evidence: 'No <link rel="canonical"> tag found.',
        explanation: 'Canonical tags prevent duplicate content issues when URLs are accessed via HTTP/HTTPS, www/non-www, or with tracking parameters.',
        recommendation: `Add <link rel="canonical" href="${url}"> to specify the preferred indexing destination.`,
        confidence: 100,
        canAutoGenerate: true,
        needsUserConfirmation: false
      });
    } else {
      findings.push({
        id: 'canonical_tag_present',
        category: 'HTML_METADATA',
        title: 'Rel Canonical Link Defined',
        status: 'PASS',
        severity: 'INFO',
        location: `<link rel="canonical" href="${canonicalUrl}">`,
        evidence: `Points to: ${canonicalUrl}`,
        explanation: 'Canonical tag properly informs search engines of the authoritative page version.',
        recommendation: 'Ensure canonical URL matches the preferred domain protocol and host.',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    }

    // Viewport meta
    const viewportMatch = html.match(/<meta[^>]*name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']viewport["'][^>]*>/i);
    if (!viewportMatch) {
      findings.push({
        id: 'viewport_missing',
        category: 'HTML_METADATA',
        title: 'Missing Mobile Viewport Meta Tag',
        status: 'ISSUE',
        severity: 'HIGH',
        location: '<head>',
        evidence: 'No <meta name="viewport"> tag detected.',
        explanation: 'Without a viewport tag, mobile devices will render the desktop version zoomed out, harming mobile usability.',
        recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">.',
        confidence: 100,
        canAutoGenerate: true,
        needsUserConfirmation: false
      });
    } else {
      findings.push({
        id: 'viewport_present',
        category: 'HTML_METADATA',
        title: 'Mobile Viewport Tag Present',
        status: 'PASS',
        severity: 'INFO',
        location: `<meta name="viewport" content="${viewportMatch[1]}">`,
        evidence: `Content: ${viewportMatch[1]}`,
        explanation: 'Mobile viewport tag is declared for mobile responsiveness.',
        recommendation: 'Retain responsive viewport configuration.',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    }

    // Open Graph Metadata
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["'][^>]*>/i);
    const ogTitle = ogTitleMatch ? ogTitleMatch[1].trim() : '';

    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:image["'][^>]*>/i);
    const ogImage = ogImageMatch ? ogImageMatch[1].trim() : '';

    if (!ogTitle || !ogImage) {
      findings.push({
        id: 'opengraph_tags_incomplete',
        category: 'HTML_METADATA',
        title: 'Incomplete Open Graph Social Sharing Tags',
        status: 'ISSUE',
        severity: 'HIGH',
        location: '<head>',
        evidence: `Found og:title: ${ogTitle ? 'YES' : 'NO'}, og:image: ${ogImage ? 'YES' : 'NO'}.`,
        explanation: 'When links are shared on WhatsApp, LinkedIn, Meta, or Slack, Open Graph tags determine the visual card preview.',
        recommendation: 'Install complete Open Graph meta tags (og:title, og:description, og:image, og:url).',
        confidence: 100,
        canAutoGenerate: true,
        needsUserConfirmation: false
      });
    } else {
      findings.push({
        id: 'opengraph_tags_present',
        category: 'HTML_METADATA',
        title: 'Open Graph Tags Implemented',
        status: 'PASS',
        severity: 'INFO',
        location: '<head>',
        evidence: `og:title="${ogTitle}", og:image configured.`,
        explanation: 'Social sharing platforms can display rich visual preview cards for your link.',
        recommendation: 'Ensure og:image is high-resolution (1200x630 recommended).',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    }

    // Twitter / X card metadata
    const twitterCardMatch = html.match(/<meta[^>]*name=["']twitter:card["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']twitter:card["'][^>]*>/i);
    if (!twitterCardMatch) {
      findings.push({
        id: 'twitter_card_missing',
        category: 'HTML_METADATA',
        title: 'Missing Twitter/X Card Declaration',
        status: 'WARNING',
        severity: 'LOW',
        location: '<head>',
        evidence: 'No <meta name="twitter:card"> detected.',
        explanation: 'Twitter/X cards format link previews on Twitter and third-party messaging clients.',
        recommendation: 'Add <meta name="twitter:card" content="summary_large_image">.',
        confidence: 95,
        canAutoGenerate: true,
        needsUserConfirmation: false
      });
    }

    return {
      findings,
      title,
      metaDescription,
      canonicalUrl,
      ogTitle,
      ogImage
    };
  }

  /**
   * Category B: Structured Data (Schema.org / JSON-LD) Audit
   * Zero hallucination: Never invents fake reviews, addresses, or phone numbers.
   */
  private auditStructuredData(
    html: string,
    websiteType?: string
  ): { findings: AuditFinding[]; typesFound: string[] } {
    const findings: AuditFinding[] = [];
    const typesFound: string[] = [];

    // Find all <script type="application/ld+json"> blocks
    const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const blocks: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = scriptRegex.exec(html)) !== null) {
      blocks.push(match[1]);
    }

    if (blocks.length === 0) {
      findings.push({
        id: 'schema_jsonld_missing',
        category: 'STRUCTURED_DATA',
        title: 'No Schema.org JSON-LD Structured Data Detected',
        status: 'ISSUE',
        severity: 'HIGH',
        location: '<head> or <body>',
        evidence: 'Zero <script type="application/ld+json"> tags found on the page.',
        explanation: 'Structured data enables rich search snippets, local business knowledge panels, breadcrumbs, and search engine entity understanding.',
        recommendation: 'Implement clean Schema.org JSON-LD formatted structured data tailored to your business category.',
        confidence: 100,
        canAutoGenerate: true,
        needsUserConfirmation: true
      });
      return { findings, typesFound };
    }

    // Validate each JSON-LD block
    let blockIndex = 0;
    for (const rawJson of blocks) {
      blockIndex++;
      let parsed: any;
      try {
        parsed = JSON.parse(rawJson.trim());
      } catch (err: any) {
        findings.push({
          id: `schema_jsonld_syntax_error_${blockIndex}`,
          category: 'STRUCTURED_DATA',
          title: `JSON-LD Syntax Error in Block #${blockIndex}`,
          status: 'ISSUE',
          severity: 'CRITICAL',
          location: `<script type="application/ld+json"> (Block #${blockIndex})`,
          evidence: `JSON parser failed: ${err.message}. Raw snippet: "${rawJson.substring(0, 80)}..."`,
          explanation: 'Malformed JSON prevents search engines from parsing your structured data entirely.',
          recommendation: 'Fix JSON syntax errors, unescaped characters, or trailing commas in your JSON-LD block.',
          confidence: 100,
          canAutoGenerate: true,
          needsUserConfirmation: false
        });
        continue;
      }

      // Extract types (handle @graph or single object or array)
      const items: any[] = Array.isArray(parsed)
        ? parsed
        : parsed['@graph'] && Array.isArray(parsed['@graph'])
        ? parsed['@graph']
        : [parsed];

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const rawType = item['@type'];
        const typeList: string[] = Array.isArray(rawType) ? rawType : [String(rawType || 'Unknown')];
        for (const t of typeList) {
          if (t && t !== 'Unknown' && !typesFound.includes(t)) {
            typesFound.push(t);
          }
        }

        // Check essential fields for common types without hallucinating
        if (typeList.some((t) => ['LocalBusiness', 'Store', 'Restaurant', 'MedicalBusiness', 'Organization'].includes(t))) {
          if (!item.name) {
            findings.push({
              id: 'schema_missing_business_name',
              category: 'STRUCTURED_DATA',
              title: `Missing 'name' in ${typeList.join('/')} Schema`,
              status: 'ISSUE',
              severity: 'HIGH',
              location: `JSON-LD (${typeList.join('/')})`,
              evidence: 'The "name" property is missing from the business entity.',
              explanation: 'Search engines require an entity name to associate the schema with your brand.',
              recommendation: 'Add the official business name to the JSON-LD entity.',
              confidence: 95,
              canAutoGenerate: true,
              needsUserConfirmation: true
            });
          }
          if (!item.telephone) {
            findings.push({
              id: 'schema_missing_telephone',
              category: 'STRUCTURED_DATA',
              title: `Missing 'telephone' Property in ${typeList.join('/')}`,
              status: 'NEEDS_USER_CONFIRMATION',
              severity: 'INFO',
              location: `JSON-LD (${typeList.join('/')})`,
              evidence: 'No "telephone" property declared in local business schema.',
              explanation: 'A phone number helps customers initiate direct calls from Google Search and Maps snippets.',
              recommendation: 'Insert your official contact number into the generated template.',
              confidence: 90,
              canAutoGenerate: true,
              needsUserConfirmation: true
            });
          }
        }
      }
    }

    if (typesFound.length > 0) {
      findings.push({
        id: 'schema_types_detected',
        category: 'STRUCTURED_DATA',
        title: 'Valid Schema.org Structured Data Detected',
        status: 'PASS',
        severity: 'INFO',
        location: '<script type="application/ld+json">',
        evidence: `Detected entity types: ${typesFound.join(', ')}.`,
        explanation: 'Structured data blocks parsed cleanly without syntax errors.',
        recommendation: 'Maintain data accuracy and keep schemas updated when business details change.',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    }

    return { findings, typesFound };
  }

  /**
   * Category C: Search Accessibility Audit
   */
  private async auditSearchAccessibility(
    fetchResult: SecureFetchResult,
    urlObj: URL,
    checkNetwork: boolean
  ): Promise<{ findings: AuditFinding[]; hasRobotsTxt: boolean; hasSitemap: boolean }> {
    const findings: AuditFinding[] = [];
    const html = fetchResult.body;
    let hasRobotsTxt = false;
    let hasSitemap = false;

    // 1. HTTPS Check
    if (urlObj.protocol !== 'https:') {
      findings.push({
        id: 'security_insecure_http',
        category: 'SEARCH_ACCESSIBILITY',
        title: 'Insecure HTTP Protocol',
        status: 'ISSUE',
        severity: 'CRITICAL',
        location: 'URL Protocol',
        evidence: `Accessed via unencrypted ${urlObj.protocol}.`,
        explanation: 'HTTPS is a baseline requirement for web security, user data protection, and modern search indexing.',
        recommendation: 'Enforce an SSL certificate and 301 redirect all HTTP traffic to HTTPS.',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    } else {
      findings.push({
        id: 'security_https_enforced',
        category: 'SEARCH_ACCESSIBILITY',
        title: 'Secure HTTPS Enforced',
        status: 'PASS',
        severity: 'INFO',
        location: 'URL Protocol',
        evidence: 'Connection established securely over HTTPS.',
        explanation: 'Encrypted connection protects visitor communication.',
        recommendation: 'Maintain active TLS certificate renewals.',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    }

    // 2. HTTP Status Check
    if (fetchResult.statusCode !== 200) {
      findings.push({
        id: 'http_non_200_status',
        category: 'SEARCH_ACCESSIBILITY',
        title: `Non-200 HTTP Response (${fetchResult.statusCode})`,
        status: 'ISSUE',
        severity: 'HIGH',
        location: 'HTTP Response Header',
        evidence: `Server responded with HTTP status code ${fetchResult.statusCode}.`,
        explanation: 'Search crawlers require an HTTP 200 OK status to index and rank page content.',
        recommendation: 'Ensure your server returns a clean HTTP 200 OK without unexpected gateway or authorization errors.',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    }

    // 3. Meta Robots noindex check
    const noindexMatch = html.match(/<meta[^>]*name=["'](robots|googlebot)["'][^>]*content=["']([^"']*noindex[^"']*)["'][^>]*>/i);
    if (noindexMatch) {
      findings.push({
        id: 'robots_noindex_detected',
        category: 'SEARCH_ACCESSIBILITY',
        title: 'Noindex Tag Detected on Public Page',
        status: 'ISSUE',
        severity: 'CRITICAL',
        location: `<meta name="${noindexMatch[1]}" content="${noindexMatch[2]}">`,
        evidence: `Found tag: ${noindexMatch[0]}`,
        explanation: 'A "noindex" directive explicitly instructs Google and other search engines NOT to show this page in search results.',
        recommendation: 'Remove the "noindex" directive if this page is intended for public organic search discovery.',
        confidence: 100,
        canAutoGenerate: true,
        needsUserConfirmation: true
      });
    }

    // 4. Check for sitemap in HTML
    const sitemapLink = html.match(/<link[^>]*rel=["']sitemap["'][^>]*href=["']([^"']*)["'][^>]*>/i);
    if (sitemapLink) {
      hasSitemap = true;
    }

    // 5. Check robots.txt (if network checks enabled)
    if (checkNetwork) {
      try {
        const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
        const robotsRes = await this.fetcher.fetch(robotsUrl, {
          timeoutMs: 3000,
          maxRedirects: 2,
          maxSizeBytes: 64 * 1024,
          acceptContentTypes: ['text/plain', 'text/html']
        });

        if (robotsRes.statusCode === 200 && robotsRes.body.length > 0) {
          hasRobotsTxt = true;
          if (robotsRes.body.toLowerCase().includes('disallow: /')) {
            findings.push({
              id: 'robots_txt_disallow_all',
              category: 'SEARCH_ACCESSIBILITY',
              title: 'Robots.txt May Disallow Crawlers',
              status: 'WARNING',
              severity: 'HIGH',
              location: '/robots.txt',
              evidence: 'Contains "Disallow: /" directive.',
              explanation: 'A global Disallow rule can prevent search engines from crawling your site.',
              recommendation: 'Inspect /robots.txt to ensure legitimate search crawlers (Googlebot, Bingbot) are not blocked from public pages.',
              confidence: 90,
              canAutoGenerate: false,
              needsUserConfirmation: true
            });
          }
          if (robotsRes.body.toLowerCase().includes('sitemap:')) {
            hasSitemap = true;
          }
        }
      } catch {
        // robots.txt missing or failed; clearly explain that this is optional for many small sites
        findings.push({
          id: 'robots_txt_optional_info',
          category: 'SEARCH_ACCESSIBILITY',
          title: 'Robots.txt Not Detected (Optional)',
          status: 'NOT_CHECKED',
          severity: 'INFO',
          location: '/robots.txt',
          evidence: 'No active /robots.txt was retrieved.',
          explanation: 'A robots.txt file is optional for standard single-domain websites without private directories.',
          recommendation: 'Consider adding a basic robots.txt if you want to declare a sitemap location explicitly.',
          confidence: 80,
          canAutoGenerate: true,
          needsUserConfirmation: false
        });
      }
    }

    return { findings, hasRobotsTxt, hasSitemap };
  }

  /**
   * Category D: Performance Indicators
   * Discloses that this is initial HTTP server timing, NOT Core Web Vitals.
   */
  private auditPerformance(fetchResult: SecureFetchResult): { findings: AuditFinding[] } {
    const findings: AuditFinding[] = [];
    const sizeBytes = fetchResult.bytesReceived || Buffer.byteLength(fetchResult.body, 'utf8');
    const sizeKb = Math.round(sizeBytes / 1024);

    if (sizeKb > 250) {
      findings.push({
        id: 'perf_html_size_large',
        category: 'PERFORMANCE_INDICATORS',
        title: 'Large HTML Document Size',
        status: 'WARNING',
        severity: 'MEDIUM',
        location: 'HTML Document',
        evidence: `HTML document size is ${sizeKb} KB (recommended: under 150 KB).`,
        explanation: 'Very large initial HTML payloads delay DOM parsing and increase mobile rendering time.',
        recommendation: 'Minify inline CSS/JS and load heavy assets or scripts asynchronously.',
        confidence: 95,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    } else {
      findings.push({
        id: 'perf_html_size_healthy',
        category: 'PERFORMANCE_INDICATORS',
        title: 'Initial HTML Document Size is Lightweight',
        status: 'PASS',
        severity: 'INFO',
        location: 'HTML Document',
        evidence: `HTML size: ${sizeKb} KB.`,
        explanation: 'Initial document payload is lightweight for fast mobile network delivery.',
        recommendation: 'Maintain compact HTML structure.',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    }

    findings.push({
      id: 'perf_ttfb_timing',
      category: 'PERFORMANCE_INDICATORS',
      title: 'Server Response Timing Indicator',
      status: fetchResult.timingMs > 2500 ? 'WARNING' : 'PASS',
      severity: fetchResult.timingMs > 2500 ? 'MEDIUM' : 'INFO',
      location: 'HTTP Connection Timing',
      evidence: `Initial HTTP connection & response timing: ${fetchResult.timingMs}ms.`,
      explanation: 'Server connection response timing indicates initial host responsiveness. NOTE: This is initial HTTP timing, NOT Google Core Web Vitals (LCP, INP, CLS).',
      recommendation: fetchResult.timingMs > 2500 ? 'Consider host caching or CDN edge acceleration to reduce server latency.' : 'Keep server latency low.',
      confidence: 95,
      canAutoGenerate: false,
      needsUserConfirmation: false
    });

    return { findings };
  }

  /**
   * Category E: Conversion-path Indicators
   */
  private auditConversionPath(html: string): { findings: AuditFinding[]; contactChannels: string[] } {
    const findings: AuditFinding[] = [];
    const contactChannels: string[] = [];

    // Tel links
    const hasTel = /href=["']tel:[^"']+["']/i.test(html);
    if (hasTel) contactChannels.push('PHONE_CLICK_TO_CALL');

    // Mailto links
    const hasMailto = /href=["']mailto:[^"']+["']/i.test(html);
    if (hasMailto) contactChannels.push('EMAIL_CLICK_TO_CONTACT');

    // Booking links (cal.com, calendly, book, appointment)
    const hasBooking = /(calendly\.com|cal\.com|schedule|appointment|booking)/i.test(html);
    if (hasBooking) contactChannels.push('ONLINE_BOOKING');

    // CTA buttons
    const hasCta = /<(button|a)[^>]*(class=["'][^"']*(btn|cta|button)[^"']*|id=["'][^"']*(btn|cta|button)[^"']*)[^>]*>/i.test(html);

    if (contactChannels.length === 0 && !hasCta) {
      findings.push({
        id: 'conversion_no_visible_contact_or_cta',
        category: 'CONVERSION_PATH',
        title: 'No Direct Contact or Action Channel Detected',
        status: 'WARNING',
        severity: 'MEDIUM',
        location: 'Page Body',
        evidence: 'No click-to-call (tel:), email (mailto:), or booking links discovered.',
        explanation: 'Visitors who discover your website need a frictionless mechanism to inquire, book, or contact your business immediately.',
        recommendation: 'Add a prominent click-to-call button and a primary action trigger on your page.',
        confidence: 90,
        canAutoGenerate: true,
        needsUserConfirmation: true
      });
    } else {
      findings.push({
        id: 'conversion_channels_detected',
        category: 'CONVERSION_PATH',
        title: 'Direct Action Channels Present',
        status: 'PASS',
        severity: 'INFO',
        location: 'Page Body',
        evidence: `Active channels: ${contactChannels.join(', ') || 'CTA Button'}.`,
        explanation: 'Visitors have clear, accessible options to contact or take action.',
        recommendation: 'Ensure contact phone and email links remain actively monitored.',
        confidence: 100,
        canAutoGenerate: false,
        needsUserConfirmation: false
      });
    }

    return { findings, contactChannels };
  }

  /**
   * Deterministic 0-100 scoring algorithm based on documented deductions.
   */
  public calculateDeterministicScore(findings: AuditFinding[]): {
    score: number;
    overallStatus: 'OPTIMIZED' | 'NEEDS_IMPROVEMENT' | 'ACTION_REQUIRED';
    explanation: string;
  } {
    let score = 100;

    for (const f of findings) {
      if (f.status === 'ISSUE') {
        if (f.severity === 'CRITICAL') score -= 15;
        else if (f.severity === 'HIGH') score -= 10;
        else if (f.severity === 'MEDIUM') score -= 7;
        else score -= 4;
      } else if (f.status === 'WARNING') {
        if (f.severity === 'HIGH') score -= 6;
        else if (f.severity === 'MEDIUM') score -= 4;
        else score -= 2;
      }
    }

    score = Math.max(0, Math.min(100, score));

    let overallStatus: 'OPTIMIZED' | 'NEEDS_IMPROVEMENT' | 'ACTION_REQUIRED';
    if (score >= 85) overallStatus = 'OPTIMIZED';
    else if (score >= 60) overallStatus = 'NEEDS_IMPROVEMENT';
    else overallStatus = 'ACTION_REQUIRED';

    const explanation =
      `Deterministic technical audit score of ${score}/100 calculated from ${findings.length} inspected criteria ` +
      `across HTML metadata, structured data syntax, search accessibility, server timing, and conversion paths. ` +
      `DISCLOSURE: This score measures technical standards conformance; it does NOT predict search engine rankings.`;

    return { score, overallStatus, explanation };
  }

  /**
   * Generates a preview snippet for the free report.
   */
  private generateQuickSnippetPreview(
    url: string,
    title: string,
    desc: string,
    types: string[]
  ): string {
    const cleanTitle = title || 'Your Business Name - Primary Service';
    const cleanDesc = desc || 'Professional services and solutions tailored for your requirements.';
    return [
      '<!-- SiteFix AI Recommended Head Preview -->',
      `<title>${cleanTitle}</title>`,
      `<meta name="description" content="${cleanDesc}">`,
      `<link rel="canonical" href="${url}">`,
      `<meta property="og:title" content="${cleanTitle}">`,
      `<meta name="twitter:card" content="summary_large_image">`
    ].join('\n');
  }
}
