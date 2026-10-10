import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateProductionSecrets,
  isPlaceholderCredential,
  ProductionSecretViolationError,
} from '../../src/config/env.js';
import { RevenueReconciliationEngine } from '../../src/revenue/revenue-reconciliation.js';
import { resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Production Secrets & Data Classification Enforcement', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetDbForTesting();
    seedDatabase({ forceSeed: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Production Secret Validation & Rejection of Placeholders', () => {
    it('rejects demo_key in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.GEMINI_API_KEY = 'demo_key';

      expect(() => validateProductionSecrets(process.env)).toThrow(ProductionSecretViolationError);
      expect(() => validateProductionSecrets(process.env)).toThrow(/strictly rejects 'demo_key'/i);
    });

    it('rejects common placeholder credentials in production', () => {
      process.env.NODE_ENV = 'production';

      const placeholders = [
        'placeholder',
        'your_key_here',
        'your_gemini_api_key',
        'test_key',
        'dummy',
        'change_me',
        '<YOUR_API_KEY>',
        '${GEMINI_API_KEY}',
        'AIzaSy...your_real_key_here',
        '   ',
        '',
      ];

      for (const ph of placeholders) {
        process.env.GEMINI_API_KEY = ph;
        expect(() => validateProductionSecrets(process.env)).toThrow(ProductionSecretViolationError);
      }
    });

    it('rejects missing GEMINI_API_KEY in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.GEMINI_API_KEY;

      expect(() => validateProductionSecrets(process.env)).toThrow(ProductionSecretViolationError);
      expect(() => validateProductionSecrets(process.env)).toThrow(/GEMINI_API_KEY deployment secret is missing/i);
    });

    it('accepts valid deployment secret in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.GEMINI_API_KEY = 'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6';

      expect(() => validateProductionSecrets(process.env)).not.toThrow();
    });

    it('allows demo_key in development or test environments', () => {
      process.env.NODE_ENV = 'development';
      process.env.GEMINI_API_KEY = 'demo_key';

      expect(() => validateProductionSecrets(process.env)).not.toThrow();

      process.env.NODE_ENV = 'test';
      expect(() => validateProductionSecrets(process.env)).not.toThrow();
    });
  });

  describe('2. Strict Tri-State Distinction: TEST vs REAL', () => {
    it('rejects recording REAL revenue using a SIMULATED gateway', () => {
      const engine = new RevenueReconciliationEngine();

      expect(() => {
        engine.recordTransaction({
          businessId: 'biz_smilekraft_hyd',
          invoiceNumber: 'INV-FAKE-REAL-001',
          amountINR: 25000,
          paymentMethod: 'UPI',
          paymentGateway: 'SIMULATED',
          classification: 'REAL',
        });
      }).toThrow(/Cannot record REAL revenue using a SIMULATED payment gateway/i);
    });

    it('isolates real and test ROAS in production mode without leakage', () => {
      const engine = new RevenueReconciliationEngine();

      // In development/test mode, summary reports both
      process.env.NODE_ENV = 'test';
      let summary = engine.getRevenueSummary('biz_smilekraft_hyd');
      expect(summary.testRevenueINR).toBeGreaterThan(0);
      expect(summary.testRoas).toBeGreaterThan(0);

      // Now switch to production mode
      process.env.NODE_ENV = 'production';
      summary = engine.getRevenueSummary('biz_smilekraft_hyd');

      // Before real transactions, realRevenue is 0 and roas is strictly 0.00
      expect(summary.realRevenueINR).toBe(0);
      expect(summary.roas).toBe(0);
      expect(summary.realRoas).toBe(0);
      // testRoas is clearly distinguished
      expect(summary.testRoas).toBeGreaterThan(0);

      // Now add audited REAL revenue
      engine.recordVerifiedManualRevenue({
        businessId: 'biz_smilekraft_hyd',
        invoiceNumber: 'INV-REAL-PROD-999',
        amountINR: 50000,
        paymentMethod: 'UPI',
        transactionRef: 'UPI-HDFC-VERIFIED-999',
        verificationSource: 'CLINIC_BANK_STATEMENT',
        verifiedByUserId: 'usr_owner_01',
        campaignId: 'camp_seed_aligners_01',
      });

      const updatedSummary = engine.getRevenueSummary('biz_smilekraft_hyd');
      expect(updatedSummary.realRevenueINR).toBe(50000);
      expect(updatedSummary.realRoas).toBeGreaterThan(0);
      expect(updatedSummary.roas).toBe(updatedSummary.realRoas);
      expect(updatedSummary.testRevenueINR).toBe(73000);
      // Real revenue never equals or bleeds into test revenue
      expect(updatedSummary.realRevenueINR).not.toBe(updatedSummary.testRevenueINR);
    });
  });

  describe('3. Git Ignore Enforcement for Secret Files (Step 1d)', () => {
    it('fails when any secret file pattern is not matched by .gitignore', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const candidatePaths = [
        path.resolve(process.cwd(), '.gitignore'),
        path.resolve(process.cwd(), '../../.gitignore'),
        path.resolve(process.cwd(), '../.gitignore')
      ];
      let gitignoreContent = '';
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          gitignoreContent = fs.readFileSync(p, 'utf8');
          break;
        }
      }
      if (!gitignoreContent) {
        throw new Error('.gitignore not found in workspace candidate paths');
      }
      const lines = gitignoreContent.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

      const requiredSecretFiles = [
        '.env',
        '.env.local',
        '.env.admin_secret',
        '.env.deploy_secrets',
        '.env.render.production',
        '.env.txt'
      ];

      for (const secretFile of requiredSecretFiles) {
        // Matches exact pattern or wildcard pattern like *.env*
        const isIgnored = lines.some(pattern => {
          if (pattern === secretFile) return true;
          if (pattern === '*.env*' && secretFile.includes('.env')) return true;
          if (pattern === '.env*' && secretFile.startsWith('.env')) return true;
          return false;
        });
        expect(isIgnored, `Secret file ${secretFile} must be explicitly ignored in .gitignore`).toBe(true);
      }
    });
  });
});
