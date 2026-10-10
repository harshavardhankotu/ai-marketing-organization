import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30000,
    setupFiles: ['./tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
      VITEST: 'true',
      PORT: '3001',
      OWNER_API_KEY: 'test_owner_key_for_ci_pipeline_only',
      AUTH_SECRET: 'test_owner_key_for_ci_pipeline_only',
      CRON_PING_SECRET: 'test_cron_secret_for_ci_pipeline_only',
      GOOGLE_SEARCH_API_KEY: 'test_google_search_key',
      GOOGLE_SEARCH_CX: 'test_google_cx',
      AMAZON_AFFILIATE_TAG: 'marketing98-21',
      TAVILY_API_KEY: 'tvly-test-fixture-ci-key',
      GEMINI_API_KEY: 'AIzaSyTestFixtureKeyForUnitTests12345'
    }
  }
});
