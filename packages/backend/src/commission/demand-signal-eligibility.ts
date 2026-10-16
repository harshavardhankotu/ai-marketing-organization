import { URL } from 'url';

/**
 * Normalizes a URL into its canonical form for deterministic deduplication.
 *
 * Rules:
 * - Parses valid HTTP(S) URLs only (rejects ftp, file, javascript, etc.)
 * - Rejects URLs containing user/password credentials
 * - Lowercases hostname and strips default ports (80 for http, 443 for https)
 * - Strips fragments (#...)
 * - Strips known marketing/tracking query parameters (utm_*, gclid, fbclid, etc.)
 * - Preserves meaningful query parameters and sorts them deterministically
 * - Consistently normalizes trailing slashes (root '/' kept, subpath trailing '/' stripped)
 * - Preserves path case sensitivity
 */
export function normalizeCanonicalUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // HTTP and HTTPS schemes only
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  // Reject URLs containing credentials
  if (parsed.username || parsed.password) {
    return null;
  }

  // Lowercase hostname
  parsed.hostname = parsed.hostname.toLowerCase();

  // Normalize default ports
  if ((parsed.protocol === 'http:' && parsed.port === '80') ||
      (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }

  // Strip fragment
  parsed.hash = '';

  // Strip known tracking query parameters
  const trackingParams = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'gclid', 'fbclid', 'msclkid', 'mc_eid', 'yclid', '_ga', '_gl', 'ref_src',
    'igshid', 's_kwcid', 'dclid', 'zanpid', 'irclickid'
  ]);

  const searchParams = new URLSearchParams(parsed.search);
  const keysToDelete: string[] = [];
  for (const [key] of searchParams.entries()) {
    const lowerKey = key.toLowerCase();
    if (trackingParams.has(lowerKey) || lowerKey.startsWith('utm_')) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    searchParams.delete(key);
  }

  // Sort query parameters deterministically
  searchParams.sort();
  parsed.search = searchParams.toString() ? `?${searchParams.toString()}` : '';

  // Consistently normalize trailing slashes:
  // Root URL '/' is preserved ('https://example.com/')
  // Subpaths strip trailing slash ('https://example.com/item/' -> 'https://example.com/item')
  let pathname = parsed.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  parsed.pathname = pathname;

  return parsed.toString();
}

/**
 * Standardized SQL condition for genuine buyer demand signals across D1 queries.
 * Excludes all forms of fixtures, duplicates, seeded rows, publisher articles, and quarantined rows.
 */
export const GENUINE_BUYER_DEMAND_SQL_CONDITION = `
  status NOT IN (
    'DUPLICATE',
    'SEEDED',
    'SEEDED_MIGRATION_0026',
    'UNSOURCED',
    'QUARANTINED',
    'UNSUPPORTED',
    'UNSUPPORTED_BY_DEMAND',
    'PAUSED_SEEDED_DEMAND'
  )
  AND source_url LIKE 'http%'
  AND source_url NOT LIKE '%search.community%'
  AND source_url NOT LIKE '%localhost%'
  AND source_url NOT LIKE '%example.com%'
  AND source_url NOT LIKE '%test.local%'
  AND signal_type = 'BUYER_QUESTION'
`;

/**
 * In-memory predicate to verify whether a demand signal represents a genuine buyer question.
 */
export function isEligibleBuyerDemandSignal(signal: any): boolean {
  if (!signal) return false;

  // Signal type must strictly be BUYER_QUESTION
  if (signal.signal_type !== 'BUYER_QUESTION') return false;

  // Status must be an active, discovered, or addressed state — never fixture or duplicate
  const invalidStatuses = new Set([
    'DUPLICATE',
    'SEEDED',
    'SEEDED_MIGRATION_0026',
    'UNSOURCED',
    'QUARANTINED',
    'UNSUPPORTED',
    'UNSUPPORTED_BY_DEMAND',
    'PAUSED_SEEDED_DEMAND'
  ]);
  if (invalidStatuses.has(signal.status)) return false;

  // URL must be a valid canonical HTTP(S) URL
  const rawUrl = signal.source_url || signal.url;
  const canonical = normalizeCanonicalUrl(rawUrl);
  if (!canonical) return false;

  // Exclude synthetic fixture domains
  const lowerUrl = canonical.toLowerCase();
  if (
    lowerUrl.includes('search.community') ||
    lowerUrl.includes('localhost') ||
    lowerUrl.includes('example.com') ||
    lowerUrl.includes('test.local') ||
    lowerUrl.includes('mock-demand')
  ) {
    return false;
  }

  // Publisher articles misclassified by simple question marks or title prefixes
  const title = (signal.topic || signal.title || '').toLowerCase();
  const publisherKeywords = ['best ', 'top 10', 'top 5', 'reviews', 'tested', 'listicle', 'buying guide'];
  if (publisherKeywords.some(kw => title.includes(kw))) {
    return false;
  }

  return true;
}

/**
 * Classifies signal type into BUYER_QUESTION vs PUBLISHER_ARTICLE.
 * Listicles, reviews, ranking sites, and publisher articles must NEVER be classified as buyer questions,
 * even if their title or snippet happens to contain a question mark.
 */
export function classifySignalType(title: string, snippet: string, url: string): 'BUYER_QUESTION' | 'PUBLISHER_ARTICLE' {
  const lowerTitle = (title || '').toLowerCase();
  const lowerUrl = (url || '').toLowerCase();
  const lowerSnippet = (snippet || '').toLowerCase();

  // Known publisher aggregator domains
  const publisherDomains = [
    'pcmag.com',
    'businessnewsdaily.com',
    'aiaccountant.com',
    'invoicecrowd.com',
    'business.com',
    'pilot.com',
    'mybillbook.in',
    'busy.in',
    'cnbc.com',
    'yahoo.com',
    'indeed.com',
    'quickenaccounting.com',
    'forbes.com',
    'investopedia.com',
    'techradar.com',
    'cnet.com',
    'wirecutter.com',
    'tomsguide.com',
    'g2.com',
    'capterra.com',
    'softwareadvice.com',
    'trustradius.com'
  ];

  if (publisherDomains.some(d => lowerUrl.includes(d))) {
    return 'PUBLISHER_ARTICLE';
  }

  // Known publisher article URL structures
  if (
    lowerUrl.includes('/blog/') ||
    lowerUrl.includes('/article/') ||
    lowerUrl.includes('/articles/') ||
    lowerUrl.includes('/reviews/') ||
    lowerUrl.includes('/review/') ||
    lowerUrl.includes('/picks/') ||
    lowerUrl.includes('/categories/') ||
    lowerUrl.includes('/news/')
  ) {
    return 'PUBLISHER_ARTICLE';
  }

  // Typical publisher article and listicle title patterns
  if (
    lowerTitle.startsWith('best ') ||
    lowerTitle.includes(' best ') ||
    lowerTitle.startsWith('top ') ||
    lowerTitle.includes(' top 10') ||
    lowerTitle.includes(' top 5') ||
    lowerTitle.includes('reviews') ||
    lowerTitle.includes('tested') ||
    lowerTitle.includes('buyers guide') ||
    lowerTitle.includes('buying guide') ||
    lowerTitle.includes('ranking') ||
    lowerTitle.includes('comparison review') ||
    lowerTitle.includes('ultimate guide')
  ) {
    return 'PUBLISHER_ARTICLE';
  }

  const isQuestion =
    lowerTitle.endsWith('?') ||
    lowerTitle.startsWith('how ') ||
    lowerTitle.startsWith('which ') ||
    lowerTitle.startsWith('can ') ||
    lowerTitle.startsWith('suggest ') ||
    lowerTitle.startsWith('what ') ||
    lowerTitle.startsWith('does ') ||
    lowerTitle.startsWith('is there ') ||
    lowerSnippet.includes('?') ||
    lowerSnippet.startsWith('how ');

  return isQuestion ? 'BUYER_QUESTION' : 'PUBLISHER_ARTICLE';
}
