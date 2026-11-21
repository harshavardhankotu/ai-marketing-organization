/**
 * SiteFix Core: Pure Zero-Hallucination Optimization Fix-Pack Generator
 * Never invents business info; unknown fields remain explicit owner placeholders.
 *
 * Security hardening (Pass 2.1):
 * - Strictly HTML-escapes all observed metadata interpolated into <title>, <meta>, Open Graph, and Twitter Card attributes.
 * - Strictly validates observed URLs (canonical, og:url, og:image, twitter:image, JSON-LD url/image, sitemap <loc>) to http: or https: schemes.
 * - Neutralizes `<` (as `\u003c`) and `</script>` sequences inside JSON-LD embedded within `<script type="application/ld+json">`.
 */

import type { FixPackDeliverable, SiteAuditResult } from './types.js';

const PLACEHOLDER_CANONICAL_URL = 'https://example.com/';

/**
 * Escapes HTML special characters for safe interpolation inside element text and double-quoted attributes.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Neutralizes comment-closing sequences and angle brackets inside HTML comments.
 */
export function escapeHtmlComment(value: unknown): string {
  return String(value ?? '')
    .replace(/--+/g, '- -')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ');
}

/**
 * Validates that a URL strictly uses http: or https: and contains no control characters.
 * Rejects javascript:, data:, vbscript:, file:, and malformed URLs.
 */
export function sanitizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    const normalized = parsed.toString();
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash && !trimmed.endsWith('/')) {
      return normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Safely serializes JSON-LD for embedding inside <script type="application/ld+json">.
 * Escapes `<` as `\u003c`, `>` as `\u003e`, and line/paragraph separators so `</script>` can never break out.
 */
export function serializeJsonLdSafely(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export class SiteAuditFixPackGenerator {
  public static readonly LEGAL_DISCLOSURE =
    'Generated optimization files are suggestions for the customer to review and install. ' +
    "This tool does not modify the customer's website or guarantee rankings, traffic, or sales.";

  /**
   * Generates the complete paid deliverable pack from an audit scan result.
   */
  public generateFixPack(
    audit: SiteAuditResult,
    orderId?: string
  ): FixPackDeliverable {
    const safeTargetUrl = sanitizeHttpUrl(audit.url);
    const targetUrl = safeTargetUrl || PLACEHOLDER_CANONICAL_URL;
    let urlHostname = 'yourwebsite.com';
    try {
      urlHostname = new URL(targetUrl).hostname;
    } catch {}

    const preview = audit.preview || ({} as any);
    const findings = Array.isArray(audit.findings) ? audit.findings : [];

    const hasRealTitle = Boolean(
      preview.title &&
      preview.title !== '(No <title> found)' &&
      preview.title !== '(No title tag found)'
    );
    const hasRealDesc = Boolean(
      preview.metaDescription &&
      preview.metaDescription !== '(No meta description found)' &&
      preview.metaDescription !== '(No meta description specified)'
    );
    const rawHasRealCanonical = Boolean(
      preview.canonicalUrl &&
      preview.canonicalUrl !== '(No canonical URL specified)' &&
      preview.canonicalUrl !== '(No canonical link found)'
    );
    const safeCanonicalCandidate = rawHasRealCanonical
      ? sanitizeHttpUrl(preview.canonicalUrl)
      : null;
    const cleanCanonical = safeCanonicalCandidate || safeTargetUrl || PLACEHOLDER_CANONICAL_URL;
    const canonicalWasUnsafe = rawHasRealCanonical && !safeCanonicalCandidate;

    const hasRealOgTitle = Boolean(
      preview.ogTitle &&
      preview.ogTitle !== '(No og:title found)'
    );
    const hasRealOgDesc = Boolean(
      preview.ogDescription &&
      preview.ogDescription !== '(No og:description found)'
    );
    const rawHasRealOgImage = Boolean(
      preview.ogImage &&
      preview.ogImage !== '(No og:image found)' &&
      preview.ogImage !== '(No og:image specified)' &&
      !preview.ogImage.includes('og-image.jpg')
    );
    const safeOgImage = rawHasRealOgImage ? sanitizeHttpUrl(preview.ogImage) : null;
    const hasRealOgImage = Boolean(safeOgImage);

    const rawOgUrl = sanitizeHttpUrl(preview.ogUrl);
    const safeOgUrl = rawOgUrl || cleanCanonical;

    const rawTwitterImage = sanitizeHttpUrl(preview.twitterImage);
    const safeTwitterImage = rawTwitterImage || safeOgImage;

    const hasNoindex = findings.some(f => f.id === 'robots_noindex_detected');

    const escapedTitle = hasRealTitle ? escapeHtml(preview.title) : '';
    const escapedDesc = hasRealDesc ? escapeHtml(preview.metaDescription) : '';
    const escapedCanonical = escapeHtml(cleanCanonical);
    const escapedOgTitle = escapeHtml(
      hasRealOgTitle ? preview.ogTitle : (hasRealTitle ? preview.title : '')
    );
    const escapedOgDesc = escapeHtml(
      hasRealOgDesc ? preview.ogDescription : (hasRealDesc ? preview.metaDescription : '')
    );
    const escapedOgUrl = escapeHtml(safeOgUrl);
    const escapedOgImage = safeOgImage ? escapeHtml(safeOgImage) : '';
    const escapedTwitterTitle = escapeHtml(
      preview.twitterTitle || (hasRealOgTitle ? preview.ogTitle : (hasRealTitle ? preview.title : ''))
    );
    const escapedTwitterDesc = escapeHtml(
      preview.twitterDescription || (hasRealOgDesc ? preview.ogDescription : (hasRealDesc ? preview.metaDescription : ''))
    );
    const escapedTwitterImage = safeTwitterImage ? escapeHtml(safeTwitterImage) : '';

    // 1. Recommended HTML Head Snippet
    const headLines = [
      '<!-- ======================================================= -->',
      '<!-- SiteFix AI: Recommended <head> Optimization Tags        -->',
      `<!-- Target: ${escapeHtmlComment(targetUrl)}                                    -->`,
      `<!-- Generated: ${new Date().toISOString()}                  -->`,
      '<!-- ======================================================= -->'
    ];

    if (hasRealTitle) {
      headLines.push(`<title>${escapedTitle}</title>`);
    } else {
      headLines.push('<!-- OWNER ACTION REQUIRED: Missing <title> tag. Add a descriptive title (50-60 chars): -->');
      headLines.push('<title><!-- [INSERT_PAGE_TITLE] --></title>');
    }

    if (hasRealDesc) {
      headLines.push(`<meta name="description" content="${escapedDesc}">`);
    } else {
      headLines.push('<!-- OWNER ACTION REQUIRED: Missing meta description. Add a summary (120-160 chars): -->');
      headLines.push('<meta name="description" content="<!-- [INSERT_META_DESCRIPTION] -->">');
    }

    if (canonicalWasUnsafe) {
      headLines.push('<!-- SECURITY NOTICE: Observed canonical URL used an unsafe or malformed scheme and was replaced with the verified HTTP(S) page URL. -->');
    }
    headLines.push(`<link rel="canonical" href="${escapedCanonical}">`);
    headLines.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    headLines.push('<meta charset="utf-8">');

    if (hasNoindex) {
      headLines.push('<!-- CRITICAL SEARCH NOTICE: Scanned page has an active "noindex" directive. -->');
      headLines.push('<!-- If this page SHOULD be indexed by Google, replace "noindex" with "index": -->');
      headLines.push('<meta name="robots" content="noindex, follow"> <!-- REVIEW REQUIRED: Change to "index, follow" to enable search indexing -->');
    } else {
      headLines.push('<meta name="robots" content="index, follow">');
    }

    const headMetadataSnippet = headLines.join('\n');

    // 2. Open Graph Snippet
    const ogLines = [
      '<!-- Open Graph Social Sharing Meta Tags -->',
      '<meta property="og:type" content="website">',
      `<meta property="og:url" content="${escapedOgUrl}">`
    ];

    if (hasRealOgTitle || hasRealTitle) {
      ogLines.push(`<meta property="og:title" content="${escapedOgTitle}">`);
    } else {
      ogLines.push('<!-- OWNER ACTION: Add og:title -->');
    }

    if (hasRealOgDesc || hasRealDesc) {
      ogLines.push(`<meta property="og:description" content="${escapedOgDesc}">`);
    } else {
      ogLines.push('<!-- OWNER ACTION: Add og:description -->');
    }

    if (hasRealOgImage && escapedOgImage) {
      ogLines.push(`<meta property="og:image" content="${escapedOgImage}">`);
      ogLines.push('<meta property="og:image:width" content="1200">');
      ogLines.push('<meta property="og:image:height" content="630">');
    } else {
      ogLines.push('<!-- OWNER ACTION: Add og:image URL (recommended: 1200x630 JPG over HTTPS) to enable social share image preview -->');
    }

    const openGraphSnippet = ogLines.join('\n');

    // 3. Twitter / X Card Snippet
    const twitterLines = [
      '<!-- Twitter / X Card Meta Tags -->',
      '<meta name="twitter:card" content="summary_large_image">'
    ];
    if (escapedTwitterTitle) {
      twitterLines.push(`<meta name="twitter:title" content="${escapedTwitterTitle}">`);
    }
    if (escapedTwitterDesc) {
      twitterLines.push(`<meta name="twitter:description" content="${escapedTwitterDesc}">`);
    }
    if (escapedTwitterImage) {
      twitterLines.push(`<meta name="twitter:image" content="${escapedTwitterImage}">`);
    }

    const twitterCardSnippet = twitterLines.join('\n');

    // 4. Valid Schema.org JSON-LD (Strictly Verified Facts Only + Safe Script Serialization)
    const schemaObject: Record<string, any> = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      url: cleanCanonical
    };

    if (hasRealTitle) {
      schemaObject.name = String(preview.title).split('—')[0].split('-')[0].trim();
    } else if (audit.businessName) {
      schemaObject.name = String(audit.businessName);
    }
    if (hasRealDesc) {
      schemaObject.description = String(preview.metaDescription);
    }
    if (safeOgImage) {
      schemaObject.image = safeOgImage;
    }
    const observedEmail = audit.prospectSignals?.discoveredEmails?.[0];
    if (observedEmail) {
      schemaObject.email = observedEmail;
    }

    const schemaJsonLdSnippet = [
      '<!-- Schema.org Structured Data (Strictly Verified Live Metadata — Zero Hallucination) -->',
      '<!-- TODO: REPLACE_WITH_YOUR_PHONE_AND_ADDRESS_IF_LOCAL_BUSINESS before deploying if adding LocalBusiness fields -->',
      '<script type="application/ld+json">',
      serializeJsonLdSafely(schemaObject),
      '</script>'
    ].join('\n');

    // 5. Evidence-only robots.txt & sitemap.xml deliverables (strictly from validated HTTP(S) canonical URL)
    const canonicalOrigin = (() => {
      try {
        return new URL(cleanCanonical).origin;
      } catch {
        return `https://${urlHostname}`;
      }
    })();
    const robotsTxtSnippet = [
      `# SiteFix AI: Recommended /robots.txt for ${escapeHtmlComment(urlHostname)}`,
      '# TODO: REPLACE_WITH_YOUR_PRIVATE_PATHS if you have admin or staging routes to disallow',
      'User-agent: *',
      'Allow: /',
      `Sitemap: ${canonicalOrigin}/sitemap.xml`
    ].join('\n');

    const sitemapXmlSnippet = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<!-- SiteFix AI: Evidence-Only Starter Sitemap for ${escapeHtmlComment(urlHostname)} -->`,
      '<!-- TODO: REPLACE_WITH_YOUR_ADDITIONAL_URLS for verified service or product pages -->',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url>',
      `    <loc>${escapedCanonical}</loc>`,
      `    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>`,
      '    <changefreq>weekly</changefreq>',
      '    <priority>1.0</priority>',
      '  </url>',
      '</urlset>'
    ].join('\n');

    // 6. Missing fields requiring owner input
    const missingFieldsRequiringOwnerInput: string[] = [];
    if (!hasRealTitle) {
      missingFieldsRequiringOwnerInput.push('Website Name / Title: Add "name" attribute with your official site or business name.');
    }
    if (!hasRealDesc) {
      missingFieldsRequiringOwnerInput.push('Description: Add "description" attribute describing your business or service.');
    }
    if (!hasRealOgImage) {
      missingFieldsRequiringOwnerInput.push('Brand Image: Add "image" attribute with absolute HTTPS URL to brand logo or banner.');
    }
    missingFieldsRequiringOwnerInput.push(
      'Business Phone Number: Add "telephone": "+91XXXXXXXXXX" if offering direct customer phone support.',
      'Physical Address: Add "address": { "@type": "PostalAddress", "streetAddress": "...", "addressLocality": "...", "postalCode": "..." } if operating a physical location.',
      'Business Email: Add "email": "contact@' + urlHostname + '" for inquiries.',
      'Operating Hours: Add "openingHoursSpecification" if operating physical store hours.',
      'Customer Reviews: Add "aggregateRating" ONLY if verified third-party reviews exist (never self-report ratings).'
    );

    // 7. Checklist Markdown
    const checklistMarkdown = this.generateChecklistMarkdown(
      audit,
      hasRealTitle ? preview.title : urlHostname,
      cleanCanonical,
      missingFieldsRequiringOwnerInput,
      hasNoindex
    );

    return {
      auditId: audit.auditId,
      orderId,
      generatedAt: new Date().toISOString(),
      targetUrl,
      headMetadataSnippet,
      openGraphSnippet,
      twitterCardSnippet,
      schemaJsonLdSnippet,
      robotsTxtSnippet,
      sitemapXmlSnippet,
      canonicalUrlRecommendation: cleanCanonical,
      checklistMarkdown,
      recommendedOwnerAdditions: missingFieldsRequiringOwnerInput,
      missingFieldsRequiringOwnerInput,
      fullReportJson: audit,
      disclosure: SiteAuditFixPackGenerator.LEGAL_DISCLOSURE
    };
  }

  private generateChecklistMarkdown(
    audit: SiteAuditResult,
    _title: string,
    _canonical: string,
    missingFields: string[] = [],
    hasNoindex: boolean = false
  ): string {
    const findings = Array.isArray(audit?.findings) ? audit.findings : [];
    const issues = findings.filter(f => f.status === 'ISSUE');
    const warnings = findings.filter(f => f.status === 'WARNING');

    return [
      `# SiteFix AI: Optimization Implementation Checklist`,
      `**Target Website:** ${audit.url}`,
      `**Audit ID:** ${audit.auditId}`,
      `**Generated At:** ${new Date().toISOString()}`,
      `**Technical Score:** ${audit.score}/100 (${audit.overallStatus})`,
      ``,
      hasNoindex
        ? `> ⚠️ **CRITICAL WARNING:** Your website currently has an active \`noindex\` directive that prevents search engines from indexing it. If you want this site to appear in Google search results, update your robots meta tag to \`content="index, follow"\`.\n`
        : '',
      `---`,
      ``,
      `## ⚠️ High-Priority Issues (${issues.length})`,
      issues.length > 0
        ? issues
            .map(
              (i, idx) =>
                `${idx + 1}. **[${i.severity}] ${i.title}**\n   - **Location:** \`${i.location}\`\n   - **Issue:** ${i.explanation}\n   - **Action:** ${i.recommendation}`
            )
            .join('\n\n')
        : '✓ No critical issues detected!',
      ``,
      `---`,
      ``,
      `## 🔍 Optimization Warnings (${warnings.length})`,
      warnings.length > 0
        ? warnings
            .map(
              (w, idx) =>
                `${idx + 1}. **${w.title}**\n   - **Recommendation:** ${w.recommendation}`
            )
            .join('\n\n')
        : '✓ No warnings detected!',
      ``,
      `---`,
      ``,
      `## ⚡ Google PageSpeed & Core Web Vitals Status`,
      audit.pageSpeed?.status === 'SUCCESS' && audit.pageSpeed.coreWebVitals
        ? `**Performance:** ${audit.pageSpeed.performanceScore}/100 | **SEO:** ${audit.pageSpeed.seoScore}/100\n` +
          `- **Largest Contentful Paint (LCP):** ${audit.pageSpeed.coreWebVitals.lcp}\n` +
          `- **First Contentful Paint (FCP):** ${audit.pageSpeed.coreWebVitals.fcp}\n` +
          `- **Cumulative Layout Shift (CLS):** ${audit.pageSpeed.coreWebVitals.cls}\n` +
          `- **Total Blocking Time (TBT):** ${audit.pageSpeed.coreWebVitals.tbt}`
        : `> ℹ️ ${audit.pageSpeed?.notice || 'Live Core Web Vitals data currently unavailable: Google PageSpeed free tier quota reached or unconfigured. Raw HTML audit completed.'}`,
      ``,
      `---`,
      ``,
      `## 📋 Recommended Owner Schema Additions & Inputs (Zero-Hallucination Guard)`,
      `The generated Schema.org JSON-LD and meta tags contain only facts verified from your scanned site. ` +
        `To avoid search engine penalties, we do not invent contact numbers or addresses. You may manually enrich your tags with:`,
      ``,
      ...missingFields.map(
        (item, idx) => `${idx + 1}. **${item.split(':')[0]}:** ${item.split(':').slice(1).join(':').trim()}`
      ),
      ``,
      `---`,
      ``,
      `## 🛠️ CMS Installation Instructions`,
      ``,
      `### Option A: WordPress`,
      `1. Log into your WordPress Admin Dashboard.`,
      `2. If using Yoast SEO or Rank Math: Navigate to **Titles & Meta** and paste the provided Title, Meta Description, and Canonical URL.`,
      `3. For custom tracking and schema: Install the free "WPCode" or "Insert Headers and Footers" plugin.`,
      `4. Navigate to **Code Snippets -> Header & Footer**, and paste the generated \`<head>\` snippet and Schema.org JSON-LD into the **Header** section.`,
      `5. Save changes and clear your site caching plugin.`,
      ``,
      `### Option B: Shopify`,
      `1. In Shopify Admin, navigate to **Online Store -> Themes**.`,
      `2. Click **Actions -> Edit code**.`,
      `3. Open \`theme.liquid\` under the **Layout** folder.`,
      `4. Locate the opening \`<head>\` tag and paste the generated Open Graph and Schema snippets directly beneath it.`,
      `5. Click **Save**.`,
      ``,
      `### Option C: Custom HTML / Next.js / Static Site`,
      `1. Open your main layout template (e.g. \`index.html\` or \`app/layout.tsx\`).`,
      `2. Insert the generated tags inside the \`<head>\` element.`,
      `3. Complete any optional business details (phone, address) in the JSON-LD script.`,
      ``,
      `---`,
      ``,
      `> **LEGAL NOTICE:** ${SiteAuditFixPackGenerator.LEGAL_DISCLOSURE}`
    ].join('\n');
  }
}
