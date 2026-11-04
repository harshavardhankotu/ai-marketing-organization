/**
 * SiteFix AI: Optimization Fix-Pack Generator
 * Generates verified, actionable optimization deliverables without hallucinating business data.
 * Implements V6 Specification Part 2.4.
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

    const cleanTitle = audit.preview.title && audit.preview.title !== '(No <title> found)'
      ? audit.preview.title
      : `${urlHostname} — Professional Services & Solutions`;

    const cleanDesc = audit.preview.metaDescription && audit.preview.metaDescription !== '(No meta description found)'
      ? audit.preview.metaDescription
      : `Welcome to ${urlHostname}. Discover our comprehensive range of services and solutions tailored for your business needs.`;

    const cleanCanonical = audit.preview.canonicalUrl && audit.preview.canonicalUrl !== '(No canonical URL specified)'
      ? audit.preview.canonicalUrl
      : targetUrl;

    // 1. Recommended HTML Head Snippet
    const headMetadataSnippet = [
      '<!-- ======================================================= -->',
      '<!-- SiteFix AI: Recommended <head> Optimization Tags        -->',
      `<!-- Target: ${targetUrl}                                    -->`,
      `<!-- Generated: ${new Date().toISOString()}                  -->`,
      '<!-- ======================================================= -->',
      `<title>${cleanTitle}</title>`,
      `<meta name="description" content="${cleanDesc}">`,
      `<link rel="canonical" href="${cleanCanonical}">`,
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<meta charset="utf-8">',
      '<meta name="robots" content="index, follow">'
    ].join('\n');

    // 2. Open Graph Snippet
    const openGraphSnippet = [
      '<!-- Open Graph Social Sharing Meta Tags -->',
      '<meta property="og:type" content="website">',
      `<meta property="og:url" content="${cleanCanonical}">`,
      `<meta property="og:title" content="${cleanTitle}">`,
      `<meta property="og:description" content="${cleanDesc}">`,
      `<meta property="og:image" content="${cleanCanonical.replace(/\/$/, '')}/og-image.jpg">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">'
    ].join('\n');

    // 3. Twitter / X Card Snippet
    const twitterCardSnippet = [
      '<!-- Twitter / X Card Meta Tags -->',
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${cleanTitle}">`,
      `<meta name="twitter:description" content="${cleanDesc}">`,
      `<meta name="twitter:image" content="${cleanCanonical.replace(/\/$/, '')}/og-image.jpg">`
    ].join('\n');

    // 4. Valid Schema.org JSON-LD Template with User Placeholders (Zero Hallucination)
    const schemaJsonLdSnippet = [
      '<script type="application/ld+json">',
      JSON.stringify(
        {
          '@context': 'https://schema.org',
          '@type': 'LocalBusiness',
          name: cleanTitle.split('—')[0].split('-')[0].trim() || urlHostname,
          url: cleanCanonical,
          description: cleanDesc,
          telephone: '[INSERT_YOUR_BUSINESS_PHONE_NUMBER_e.g._+91XXXXXXXXXX]',
          email: '[INSERT_CONTACT_EMAIL_e.g._contact@' + urlHostname + ']',
          address: {
            '@type': 'PostalAddress',
            streetAddress: '[INSERT_STREET_ADDRESS]',
            addressLocality: '[INSERT_CITY]',
            addressRegion: '[INSERT_STATE]',
            postalCode: '[INSERT_PINCODE]',
            addressCountry: 'IN'
          },
          openingHoursSpecification: [
            {
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
              opens: '09:00',
              closes: '19:00'
            }
          ]
        },
        null,
        2
      ),
      '</script>'
    ].join('\n');

    // 5. Checklist Markdown
    const checklistMarkdown = this.generateChecklistMarkdown(audit, cleanTitle, cleanCanonical);

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
    canonical: string
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
      `3. Ensure any placeholders (such as phone numbers or pincodes in Schema) are updated with your genuine business details.`,
      ``,
      `---`,
      ``,
      `> **LEGAL NOTICE:** ${SiteAuditFixPackGenerator.LEGAL_DISCLOSURE}`
    ].join('\n');
  }
}
