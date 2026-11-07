/**
 * SiteFix AI: Optimization Fix-Pack Generator
 * Generates verified, actionable optimization deliverables without hallucinating business data.
 * Implements V6.2 Specification Phase 4.
 */

import { FixPackDeliverable, SiteAuditResult } from './site-audit-types.js';

export class SiteAuditFixPackGenerator {
  public static readonly LEGAL_DISCLOSURE =
    'Generated optimization files are suggestions for the customer to review and install. ' +
    'This tool does not modify the customer\'s website or guarantee rankings, traffic, or sales.';

  /**
   * Generates the complete paid deliverable pack from an audit scan result.
   */
  public generateFixPack(
    audit: SiteAuditResult,
    orderId?: string
  ): FixPackDeliverable {
    const targetUrl = audit.url;
    let urlHostname = 'yourwebsite.com';
    try {
      urlHostname = new URL(targetUrl).hostname;
    } catch {}

    const hasRealTitle = Boolean(
      audit.preview.title &&
      audit.preview.title !== '(No <title> found)' &&
      audit.preview.title !== '(No title tag found)'
    );
    const hasRealDesc = Boolean(
      audit.preview.metaDescription &&
      audit.preview.metaDescription !== '(No meta description found)' &&
      audit.preview.metaDescription !== '(No meta description specified)'
    );
    const hasRealCanonical = Boolean(
      audit.preview.canonicalUrl &&
      audit.preview.canonicalUrl !== '(No canonical URL specified)' &&
      audit.preview.canonicalUrl !== '(No canonical link found)'
    );
    const cleanCanonical = hasRealCanonical ? audit.preview.canonicalUrl : targetUrl;

    const hasRealOgTitle = Boolean(
      audit.preview.ogTitle &&
      audit.preview.ogTitle !== '(No og:title found)'
    );
    const hasRealOgImage = Boolean(
      audit.preview.ogImage &&
      audit.preview.ogImage !== '(No og:image found)' &&
      audit.preview.ogImage !== '(No og:image specified)' &&
      !audit.preview.ogImage.includes('og-image.jpg')
    );

    // Check if the scanned page has an existing noindex directive
    const hasNoindex = audit.findings.some(f => f.id === 'robots_noindex_detected');

    // 1. Recommended HTML Head Snippet
    const headLines = [
      '<!-- ======================================================= -->',
      '<!-- SiteFix AI: Recommended <head> Optimization Tags        -->',
      `<!-- Target: ${targetUrl}                                    -->`,
      `<!-- Generated: ${new Date().toISOString()}                  -->`,
      '<!-- ======================================================= -->'
    ];

    if (hasRealTitle) {
      headLines.push(`<title>${audit.preview.title}</title>`);
    } else {
      headLines.push('<!-- OWNER ACTION REQUIRED: Missing <title> tag. Add a descriptive title (50-60 chars): -->');
      headLines.push('<title><!-- [INSERT_PAGE_TITLE] --></title>');
    }

    if (hasRealDesc) {
      headLines.push(`<meta name="description" content="${audit.preview.metaDescription}">`);
    } else {
      headLines.push('<!-- OWNER ACTION REQUIRED: Missing meta description. Add a summary (120-160 chars): -->');
      headLines.push('<meta name="description" content="<!-- [INSERT_META_DESCRIPTION] -->">');
    }

    headLines.push(`<link rel="canonical" href="${cleanCanonical}">`);
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
      `<meta property="og:url" content="${cleanCanonical}">`
    ];

    if (hasRealOgTitle || hasRealTitle) {
      ogLines.push(`<meta property="og:title" content="${audit.preview.ogTitle || audit.preview.title}">`);
    } else {
      ogLines.push('<!-- OWNER ACTION: Add og:title -->');
    }

    if (hasRealDesc) {
      ogLines.push(`<meta property="og:description" content="${audit.preview.metaDescription}">`);
    } else {
      ogLines.push('<!-- OWNER ACTION: Add og:description -->');
    }

    if (hasRealOgImage) {
      ogLines.push(`<meta property="og:image" content="${audit.preview.ogImage}">`);
      ogLines.push('<meta property="og:image:width" content="1200">');
      ogLines.push('<meta property="og:image:height" content="630">');
    } else {
      ogLines.push('<!-- OWNER ACTION: Add og:image URL (recommended: 1200x630 JPG) to enable social share image preview -->');
    }

    const openGraphSnippet = ogLines.join('\n');

    // 3. Twitter / X Card Snippet
    const twitterLines = [
      '<!-- Twitter / X Card Meta Tags -->',
      '<meta name="twitter:card" content="summary_large_image">'
    ];
    if (hasRealOgTitle || hasRealTitle) {
      twitterLines.push(`<meta name="twitter:title" content="${audit.preview.ogTitle || audit.preview.title}">`);
    }
    if (hasRealDesc) {
      twitterLines.push(`<meta name="twitter:description" content="${audit.preview.metaDescription}">`);
    }
    if (hasRealOgImage) {
      twitterLines.push(`<meta name="twitter:image" content="${audit.preview.ogImage}">`);
    }

    const twitterCardSnippet = twitterLines.join('\n');

    // 4. Valid Schema.org JSON-LD (Strictly Verified Facts Only - Zero Hallucination)
    const schemaObject: Record<string, any> = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      url: cleanCanonical
    };

    if (hasRealTitle) {
      schemaObject.name = audit.preview.title.split('—')[0].split('-')[0].trim();
    }
    if (hasRealDesc) {
      schemaObject.description = audit.preview.metaDescription;
    }
    if (hasRealOgImage) {
      schemaObject.image = audit.preview.ogImage;
    }

    const schemaJsonLdSnippet = [
      '<!-- Schema.org Structured Data (Strictly Verified Live Metadata) -->',
      '<script type="application/ld+json">',
      JSON.stringify(schemaObject, null, 2),
      '</script>'
    ].join('\n');

    // 5. Missing fields requiring owner input
    const missingFieldsRequiringOwnerInput: string[] = [];
    if (!hasRealTitle) {
      missingFieldsRequiringOwnerInput.push('Website Name / Title: Add "name" attribute with your official site or business name.');
    }
    if (!hasRealDesc) {
      missingFieldsRequiringOwnerInput.push('Description: Add "description" attribute describing your business or service.');
    }
    if (!hasRealOgImage) {
      missingFieldsRequiringOwnerInput.push('Brand Image: Add "image" attribute with absolute URL to brand logo or banner.');
    }
    missingFieldsRequiringOwnerInput.push(
      'Business Phone Number: Add "telephone": "+91XXXXXXXXXX" if offering direct customer phone support.',
      'Physical Address: Add "address": { "@type": "PostalAddress", "streetAddress": "...", "addressLocality": "...", "postalCode": "..." } if operating a physical location.',
      'Business Email: Add "email": "contact@' + urlHostname + '" for inquiries.',
      'Operating Hours: Add "openingHoursSpecification" if operating physical store hours.',
      'Customer Reviews: Add "aggregateRating" ONLY if verified third-party reviews exist (never self-report ratings).'
    );

    // 6. Checklist Markdown
    const checklistMarkdown = this.generateChecklistMarkdown(
      audit,
      hasRealTitle ? audit.preview.title : urlHostname,
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
      canonicalUrlRecommendation: cleanCanonical,
      checklistMarkdown,
      recommendedOwnerAdditions: missingFieldsRequiringOwnerInput,
      missingFieldsRequiringOwnerInput,
      fullReportJson: audit,
      disclosure: SiteAuditFixPackGenerator.LEGAL_DISCLOSURE
    };
  }

  /**
   * Generates a step-by-step checklist formatted in Markdown.
   */
  private generateChecklistMarkdown(
    audit: SiteAuditResult,
    title: string,
    canonical: string,
    missingFields: string[] = [],
    hasNoindex: boolean = false
  ): string {
    const issues = audit.findings.filter((f) => f.status === 'ISSUE');
    const warnings = audit.findings.filter((f) => f.status === 'WARNING');

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
      ...missingFields.map((item, idx) => `${idx + 1}. **${item.split(':')[0]}:** ${item.split(':').slice(1).join(':').trim()}`),
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
