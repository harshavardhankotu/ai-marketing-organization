import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30000,
    setupFiles: ['./packages/backend/tests/setup/hermetic-test-setup.ts']
  }
});
