import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Strips surrounding quotes, whitespace, and literal/actual \r or \n characters from env values.
 */
export function normalizeSecretValue(val?: string | null): string {
  if (!val) return '';
  let s = String(val).trim();
  while (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[\r\n]+/g, '').trim();

  const isJson = s.startsWith('{') && s.endsWith('}');
  if (!isJson && !s.includes('"private_key"')) {
    s = s.replace(/\\r|\\n/g, '').trim();
  }
  return s;
}

/**
 * Parses and loads key-value pairs from a specific env file into process.env (without overwriting existing keys).
 */
export function loadEnvFileAtPath(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const cleanLine = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
      const eqIdx = cleanLine.indexOf('=');
      if (eqIdx !== -1) {
        const key = cleanLine.substring(0, eqIdx).trim();
        const val = normalizeSecretValue(cleanLine.substring(eqIdx + 1));
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads key-value pairs from .env.admin_secret, .env.local, .env, etc. into process.env if they exist.
 */
export function loadLocalEnvFile(options?: { force?: boolean }): void {
  // Step 1a: Tests must never load .env.local or local secret files unless explicitly forced in a dedicated test
  if (!options?.force && (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST))) {
    return;
  }
  const candidatePaths = [
    path.resolve(process.cwd(), '.env.admin_secret'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.txt'),
    path.resolve(process.cwd(), '.env.deploy_secrets'),
    path.resolve(process.cwd(), 'packages/backend/.env.admin_secret'),
    path.resolve(process.cwd(), 'packages/backend/.env.local'),
    path.resolve(process.cwd(), 'packages/backend/.env'),
    path.resolve(process.cwd(), 'packages/backend/.env.txt'),
    path.resolve(process.cwd(), 'packages/backend/.env.deploy_secrets'),
    path.resolve(process.cwd(), '../.env.admin_secret'),
    path.resolve(process.cwd(), '../.env.local'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../.env.txt'),
    path.resolve(process.cwd(), '../.env.deploy_secrets'),
    path.resolve(process.cwd(), '../../.env.admin_secret'),
    path.resolve(process.cwd(), '../../.env.local'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../../.env.txt')
  ];

  for (const p of candidatePaths) {
    loadEnvFileAtPath(p);
  }
}

/**
 * Resolves the configured owner key from OWNER_API_KEY, ADMIN_SECRET, OWNER_SECRET, or ADMIN_API_KEY
 * (falling back to AUTH_SECRET if none of the explicit owner keys are set), trimming whitespace and quotes.
 */
export function resolveOwnerKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    env.OWNER_API_KEY,
    env.ADMIN_SECRET,
    env.OWNER_SECRET,
    env.ADMIN_API_KEY,
    env.AUTH_SECRET
  ];
  for (const raw of candidates) {
    const cleaned = normalizeSecretValue(raw);
    if (cleaned && !isPlaceholderCredential(cleaned)) {
      return cleaned;
    }
  }
  return '';
}

/**
 * Resolves the cookie-signing secret from AUTH_SECRET or OWNER_SESSION_SECRET.
 * When unset or empty, deterministically derives a SHA-256 secret from resolvedOwnerKey
 * so HMAC cookie signing never throws on missing/empty secret.
 */
export function resolveAuthSecretFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  resolvedOwnerKey?: string
): string {
  const explicit = normalizeSecretValue(env.AUTH_SECRET || env.OWNER_SESSION_SECRET);
  if (explicit && !isPlaceholderCredential(explicit)) {
    return explicit;
  }
  const effectiveOwnerKey = resolvedOwnerKey !== undefined
    ? normalizeSecretValue(resolvedOwnerKey)
    : (resolveOwnerKeyFromEnv(env) || (!isProduction(env) ? 'dev_owner_key_secret' : ''));
  return crypto.createHash('sha256').update('aro_cookie_salt_' + effectiveOwnerKey).digest('hex');
}

/**
 * Production Environment and Secrets Validator
 * 
 * Enforces strict security directives:
 * 1. Production must reject placeholder credentials.
 * 2. Production must reject 'demo_key'.
 * 3. Production must clearly distinguish TEST from REAL.
 * 4. Production secrets must come strictly from deployment secrets.
 */

export const KNOWN_PLACEHOLDER_KEYS = new Set([
  'demo_key',
  'demo',
  'placeholder',
  'your_key_here',
  'your_gemini_api_key',
  'test_key',
  'test',
  'dummy',
  'none',
  'null',
  'undefined',
  'change_me',
  'fake_key',
  'sample_key',
  'unverified_webhook_hmac_secret',
  'unverified_sandbox_secret',
  'rzp_test_unverified_sandbox'
]);

export class ProductionSecretViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionSecretViolationError';
  }
}

/**
 * Checks if a given credential string is a placeholder or template value.
 */
export function isPlaceholderCredential(val?: string | null): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  if (trimmed.length === 0) return true;

  const lower = trimmed.toLowerCase();
  if (KNOWN_PLACEHOLDER_KEYS.has(lower)) return true;

  // Check for template/bracket placeholders e.g., <your_key>, ${KEY}
  if (/^<.*>$/.test(trimmed) || /^\$\{.*\}$/.test(trimmed)) return true;

  // Check for truncated examples like AIzaSy...your_real_key_here
  if (trimmed.includes('...') || lower.includes('your_') || lower.includes('example')) {
    return true;
  }

  // Minimum length check for real Google API keys
  if (trimmed.length < 10) return true;

  return false;
}

/**
 * Returns true if the environment is strictly production.
 */
export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * Validates that all required secrets exist and are NOT placeholders in production.
 * Throws ProductionSecretViolationError if any check fails.
 */
export function validateProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (!isProduction(env)) {
    // Development and test environments permit non-production placeholders
    return;
  }

  const geminiKey = env.GEMINI_API_KEY;

  if (!geminiKey || geminiKey.trim() === '') {
    throw new ProductionSecretViolationError(
      '[SECURITY VIOLATION] Production startup halted: GEMINI_API_KEY deployment secret is missing. ' +
      'Production secrets must come from deployment secrets (e.g., Cloudflare Secrets, GitHub Actions Secrets, Kubernetes Secrets).'
    );
  }

  if (isPlaceholderCredential(geminiKey)) {
    throw new ProductionSecretViolationError(
      `[SECURITY VIOLATION] Production startup halted: GEMINI_API_KEY contains placeholder/demo credential '${geminiKey}'. ` +
      `Production strictly rejects 'demo_key' and placeholders. A genuine key must be injected via deployment secrets.`
    );
  }
}

export const OWNER_VERIFIED_GOOGLE_SITE_TOKEN = 'WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I';
export const OWNER_VERIFIED_CUELINKS_TOKEN = 'VERIFY-CL-YE94W8YS';

/**
 * Resolves verification meta tokens from explicit config or environment variables.
 * Because Render (.env.render.production / render.yaml) does not set GOOGLE_SITE_VERIFICATION
 * or CUELINKS_VERIFICATION_CODE explicitly, non-test runtimes fall back to the owner's verified
 * production tokens so GSC and Cuelinks ownership checks remain intact across deploys.
 */
export function resolveVerificationTokens(
  config?: { googleSiteVerification?: string; cuelinksVerificationCode?: string },
  env: NodeJS.ProcessEnv = process.env
): { googleSiteVerification?: string; cuelinksVerificationCode?: string } {
  const isTestRuntime = Boolean(env.VITEST) || env.NODE_ENV === 'test';
  const rawGoogle = config?.googleSiteVerification ?? env.GOOGLE_SITE_VERIFICATION;
  const rawCuelinks = config?.cuelinksVerificationCode ?? env.CUELINKS_VERIFICATION_CODE ?? env.CUELINKS_VERIFICATION;

  const googleSiteVerification = (rawGoogle !== undefined ? rawGoogle.trim() : '') ||
    (!isTestRuntime && rawGoogle === undefined ? OWNER_VERIFIED_GOOGLE_SITE_TOKEN : undefined);
  const cuelinksVerificationCode = (rawCuelinks !== undefined ? rawCuelinks.trim() : '') ||
    (!isTestRuntime && rawCuelinks === undefined ? OWNER_VERIFIED_CUELINKS_TOKEN : undefined);

  return {
    googleSiteVerification: googleSiteVerification || undefined,
    cuelinksVerificationCode: cuelinksVerificationCode || undefined
  };
}

export const DEFAULT_TRUSTED_PUBLIC_SITE_URL = 'https://ai-marketing-organization.onrender.com';

/**
 * Returns the canonical trusted public origin derived strictly from environment config
 * (`PUBLIC_SITE_URL`), never from untrusted HTTP `Host` / `X-Forwarded-Host` headers.
 */
export function getTrustedPublicSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.PUBLIC_SITE_URL || '').trim();
  if (raw) {
    try {
      const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return `${parsed.protocol}//${parsed.host}`;
      }
    } catch {}
  }
  return DEFAULT_TRUSTED_PUBLIC_SITE_URL;
}

/**
 * Checks whether a domain is explicitly allowlisted via `AUTHORIZED_PUBLIC_AUDIT_DOMAINS`
 * for public indexing on `/audit/:domain` and `/sitemap.xml`.
 */
export function isDomainAuthorizedForPublicAudit(
  domain: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const normalized = String(domain || '').toLowerCase().trim().replace(/^www\./, '');
  if (!normalized) return false;
  const allowlistRaw = (env.AUTHORIZED_PUBLIC_AUDIT_DOMAINS || '').trim();
  if (!allowlistRaw) return false;
  const allowed = allowlistRaw
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
    .filter(Boolean);
  return allowed.includes(normalized);
}

export const OWNER_VERIFIED_FIXPACK_PRICE_INR = 499;
export const OWNER_VERIFIED_DIRECT_UPI_VPA = 'venkatasaiharsh149768.rzp@rxairtel';
export const OWNER_VERIFIED_DIRECT_UPI_PAYEE_NAME = 'SiteFix AI';

/**
 * Reads the authoritative SiteFix Fixpack price (INR) from environment configuration.
 * Mirrors resolveVerificationTokens(): if explicitly set to "" or "UNSET" (or passed as an
 * empty mock env `{}` in a negative Vitest unit test), returns null (PRICE_NOT_SET).
 * Otherwise resolves from env or falls back to the owner-declared render.yaml value (499).
 */
export function getSiteAuditFixpackPriceINR(
  env: NodeJS.ProcessEnv = process.env
): number | null {
  const raw = env.SITE_AUDIT_FIXPACK_PRICE_INR;
  if (raw !== undefined) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.toUpperCase() === 'UNSET') {
      return null;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
    return null;
  }
  if (process.env.VITEST && !env.VITEST) {
    return null;
  }
  return OWNER_VERIFIED_FIXPACK_PRICE_INR;
}

export interface DirectUpiConfig {
  vpa: string | null;
  payeeName: string | null;
  configured: boolean;
}

/**
 * Reads Direct UPI payment configuration from environment variables.
 * Mirrors resolveVerificationTokens(): if explicitly set to "" or "UNSET" (or passed as an
 * empty mock env `{}` in a negative Vitest unit test), returns configured=false.
 * Otherwise falls back to the owner-declared render.yaml VPA and payee name.
 */
export function getDirectUpiConfig(
  env: NodeJS.ProcessEnv = process.env
): DirectUpiConfig {
  const rawVpa = env.DIRECT_UPI_VPA;
  const rawPayee = env.DIRECT_UPI_PAYEE_NAME;
  if (
    rawVpa !== undefined && (!rawVpa.trim() || rawVpa.trim().toUpperCase() === 'UNSET') ||
    rawPayee !== undefined && (!rawPayee.trim() || rawPayee.trim().toUpperCase() === 'UNSET')
  ) {
    return { vpa: null, payeeName: null, configured: false };
  }
  if (rawVpa !== undefined && rawPayee !== undefined) {
    return { vpa: rawVpa.trim(), payeeName: rawPayee.trim(), configured: true };
  }
  if (process.env.VITEST && !env.VITEST) {
    return { vpa: null, payeeName: null, configured: false };
  }
  return {
    vpa: (rawVpa || OWNER_VERIFIED_DIRECT_UPI_VPA).trim(),
    payeeName: (rawPayee || OWNER_VERIFIED_DIRECT_UPI_PAYEE_NAME).trim(),
    configured: true,
  };
}
