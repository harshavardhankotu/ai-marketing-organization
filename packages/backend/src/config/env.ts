import fs from 'fs';
import path from 'path';

/**
 * Loads key-value pairs from .env or .env.local into process.env if they exist.
 */
export function loadLocalEnvFile(): void {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.txt'),
    path.resolve(process.cwd(), 'packages/backend/.env.local'),
    path.resolve(process.cwd(), 'packages/backend/.env'),
    path.resolve(process.cwd(), 'packages/backend/.env.txt'),
    path.resolve(process.cwd(), '../.env.local'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../.env.txt'),
    path.resolve(process.cwd(), '../../.env.local'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../../.env.txt')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const text = fs.readFileSync(p, 'utf-8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.substring(0, eqIdx).trim();
            let val = trimmed.substring(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
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
