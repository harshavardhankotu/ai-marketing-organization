import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { AutomaticOfferLane } from '../../src/commission/automatic-offer-lane.js';
import { execFile } from 'child_process';
import path from 'path';
import app from '../../src/index.js';

describe('Part D: Owner Facts & Auto Publish Gate Test Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ASSOCIATES_APPLICATION_DATE;
    delete process.env.ASSOCIATES_LISTED_SITE_URL;
    delete process.env.ASSOCIATES_AGREEMENT_READ;
    delete process.env.PUBLIC_SITE_NAME;
    delete process.env.PUBLIC_AUTHOR_NAME;
    delete process.env.PUBLIC_CONTACT_EMAIL;
    delete process.env.AUTO_PUBLISH_ENABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. GET /api/v1/owner/facts-status Endpoint (Part D.2)', () => {
    it('returns SET/MISSING and VALID/INVALID status for each fact without exposing values', async () => {
      const res = await app.request('/api/v1/owner/facts-status');
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.allValid).toBe(false);
      expect(json.data.missingCount).toBe(6);
      expect(json.data.autoPublishEnabled).toBe(false);

      const facts = json.data.facts;
      expect(facts.length).toBe(6);

      const requiredKeys = [
        'ASSOCIATES_APPLICATION_DATE',
        'ASSOCIATES_LISTED_SITE_URL',
        'ASSOCIATES_AGREEMENT_READ',
        'PUBLIC_SITE_NAME',
        'PUBLIC_AUTHOR_NAME',
        'PUBLIC_CONTACT_EMAIL'
      ];

      for (const key of requiredKeys) {
        const fact = facts.find((f: any) => f.field === key);
        expect(fact).toBeDefined();
        expect(fact.status).toBe('MISSING');
        expect(fact.validity).toBe('INVALID');
        expect(fact.value).toBeUndefined(); // Values are NEVER exposed
      }
    });

    it('returns VALID when facts are properly set in environment', async () => {
      process.env.ASSOCIATES_APPLICATION_DATE = '2026-01-15';
      process.env.ASSOCIATES_LISTED_SITE_URL = 'https://myspecsite.in';
      process.env.ASSOCIATES_AGREEMENT_READ = 'true';
      process.env.PUBLIC_SITE_NAME = 'My Spec Site';
      process.env.PUBLIC_AUTHOR_NAME = 'Portal Operator';
      process.env.PUBLIC_CONTACT_EMAIL = 'operator@myspecsite.in';
      process.env.AUTO_PUBLISH_ENABLED = 'true';

      const res = await app.request('/api/v1/owner/facts-status');
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.allValid).toBe(true);
      expect(json.data.missingCount).toBe(0);
      expect(json.data.autoPublishEnabled).toBe(true);

      for (const fact of json.data.facts) {
        expect(fact.status).toBe('SET');
        expect(fact.validity).toBe('VALID');
        expect(fact.value).toBeUndefined(); // Values are NEVER exposed
      }
    });
  });

  describe('2. scripts/owner-apply.mjs Agent Deny Rule (Part D.1)', () => {
    it('fails immediately when executed in an agent environment (GEMINI_API_KEY set or non-TTY)', async () => {
      const scriptPath = path.resolve('scripts/owner-apply.mjs');

      const exitCode = await new Promise<number>((resolve) => {
        execFile(process.execPath, [scriptPath], {
          env: {
            ...process.env,
            GEMINI_API_KEY: 'test-agent-key',
            FORCE_OWNER_RUN: undefined
          }
        }, (error) => {
          resolve(error ? (error.code || 1) : 0);
        });
      });

      expect(exitCode).toBe(1);
    });
  });

  describe('3. AUTO_PUBLISH_ENABLED Gate (Part D.4)', () => {
    it('blocks publication with KILL_SWITCH_ACTIVE when AUTO_PUBLISH_ENABLED is false or unset', () => {
      process.env.AUTO_PUBLISH_ENABLED = 'false';
      const lane = AutomaticOfferLane.getInstance();

      const mockGuide = {
        productId: 'prod_test',
        title: 'Test Guide',
        slug: 'test-guide',
        disclosure: 'As an Amazon Associate I earn from qualifying purchases.',
        contentMarkdown: '# Test Guide\n\nSpecs here.',
        amazonSearchUrl: 'https://www.amazon.in/s?k=test',
        disclaimer: 'Illustrative search link',
        specLines: ['203 DPI'],
        createdAt: new Date().toISOString()
      };

      const mockLint = { valid: true, errors: [] };
      const result = lane.activateAndPublishGuide(mockGuide, mockLint);

      expect(result.published).toBe(false);
      expect(result.reason).toContain('KILL_SWITCH_ACTIVE');
    });
  });
});
