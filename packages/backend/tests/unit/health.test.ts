import { describe, it, expect } from 'vitest';
import app from '../../src/index.js';

describe('Health API Stability Endpoint', () => {
  it('GET /api/health returns status ok and service ai-marketing-organization', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).toEqual({
      status: 'ok',
      service: 'ai-marketing-organization'
    });
  });
});