import { describe, it, expect } from 'vitest';
import { BLOCKED_HOSTS, FORBIDDEN_PROVIDER_KEYS } from '../setup/hermetic-test-setup.js';
import { loadLocalEnvFile } from '../../src/config/env.js';
import { GeminiProvider } from '../../src/ai/gemini-provider.js';

describe('Step 1: Hermetic Tests & Provider Spend Blockers', () => {
  it('strips all provider keys from environment in test setup (Step 1a)', () => {
    for (const key of FORBIDDEN_PROVIDER_KEYS) {
      expect(process.env[key], `process.env.${key} must be stripped in tests`).toBeUndefined();
    }
  });

  it('loadLocalEnvFile refuses to load .env.local when in test environment (Step 1a)', () => {
    // Delete a test-only key if present
    delete process.env.TEST_SHOULD_NOT_LOAD;
    loadLocalEnvFile();
    // Verify no provider keys were injected by loadLocalEnvFile
    for (const key of FORBIDDEN_PROVIDER_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }
  });

  it('blocks live network calls to api.tavily.com and fails with HERMETIC_TEST_FAILURE (Step 1b)', async () => {
    await expect(fetch('https://api.tavily.com/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'test' })
    })).rejects.toThrow(/HERMETIC_TEST_FAILURE.*api\.tavily\.com/);
  });

  it('blocks live network calls to api.firecrawl.dev and fails with HERMETIC_TEST_FAILURE (Step 1b)', async () => {
    await expect(fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' })
    })).rejects.toThrow(/HERMETIC_TEST_FAILURE.*api\.firecrawl\.dev/);
  });

  it('blocks live network calls to generativelanguage.googleapis.com and fails with HERMETIC_TEST_FAILURE (Step 1b)', async () => {
    await expect(fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5:generateContent', {
      method: 'POST',
      body: JSON.stringify({ contents: [] })
    })).rejects.toThrow(/HERMETIC_TEST_FAILURE.*generativelanguage\.googleapis\.com/);
  });

  it('proves fixture branch in GeminiProvider is unreachable when NODE_ENV is production (Step 1c)', async () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const provider = new GeminiProvider();
      
      // In production with missing key, it throws security error, never returning fixture data
      await expect(
        provider.generateStructured<any>({
          agentId: 'test_agent',
          prompt: 'test prompt',
          context: {}
        })
      ).rejects.toThrow(/GEMINI_API_KEY must be provided via deployment secrets/);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
