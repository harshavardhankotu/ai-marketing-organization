import { beforeEach, afterEach } from 'vitest';

const originalNodeEnv = 'test';

beforeEach(() => {
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});
