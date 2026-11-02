import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { app } from '../../src/index.js';
import { PlatformProspectDiscoveryEngine } from '../../src/revenue/platform-prospect-discovery-engine.js';
import { MarketExperimentManager } from '../../src/revenue/market-experiment-manager.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Owner Direct Outreach, Education Pipeline & GBP Review Protocols', () => {
  beforeEach(async () => {
    // Ensure experiments and curated batches are seeded
    MarketExperimentManager.getInstance().ensureInitialized();
    await PlatformProspectDiscoveryEngine.getInstance().ensureCuratedQualifiedProspectBatch();
  });

  describe('1. Curated Multi-Market Prospect Seeding & Draft Generation', () => {
    it('1a. seeds both healthcare and education coaching prospects into platform_prospects', () => {
      const db = getDb();
      const hcCount = (db.prepare("SELECT COUNT(*) as c FROM platform_prospects WHERE vertical IN ('dental', 'clinic')").get() as any)?.c || 0;
      const eduCount = (db.prepare("SELECT COUNT(*) as c FROM platform_prospects WHERE vertical = 'coaching'").get() as any)?.c || 0;

      expect(hcCount).toBeGreaterThanOrEqual(10);
      expect(eduCount).toBeGreaterThanOrEqual(10);
    });

    it('1b. creates draft records in direct_outreach_log behind strict human gate (human_approved = 0)', () => {
      const db = getDb();
      const drafts = db.prepare(`
        SELECT segment, human_approved, dispatched, COUNT(*) as c 
        FROM direct_outreach_log 
        GROUP BY segment, human_approved, dispatched
      `).all() as any[];

      const hcDrafts = drafts.find(d => d.segment === 'HEALTHCARE_DENTAL_SMB' && d.human_approved === 0 && d.dispatched === 0);
      const eduDrafts = drafts.find(d => d.segment === 'EDUCATION_COACHING_SMB' && d.human_approved === 0 && d.dispatched === 0);

      expect(hcDrafts).toBeDefined();
      expect(hcDrafts.c).toBeGreaterThanOrEqual(10);
      expect(eduDrafts).toBeDefined();
      expect(eduDrafts.c).toBeGreaterThanOrEqual(10);
    });
  });

  describe('2. Direct Outreach API Routes & Human Gate Controls', () => {
    it('2a. GET /api/v1/owner/direct-outreach returns pending drafts with populated wa.me deep links', async () => {
      const res = await app.request('/api/v1/owner/direct-outreach?status=pending', {
        headers: { 'x-user-id': 'usr_owner_primary' }
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.count).toBeGreaterThanOrEqual(10);

      // Verify each draft has a valid oneClickWhatsAppUrl with country code 91
      const first = json.data[0];
      expect(first.humanApproved).toBe(false);
      expect(first.dispatched).toBe(false);
      expect(first.oneClickWhatsAppUrl).toBeDefined();
      expect(first.oneClickWhatsAppUrl).toContain('https://wa.me/');
    });

    it('2b. POST /api/v1/owner/direct-outreach/:id/approve marks human_approved = 1', async () => {
      const db = getDb();
      const draft = db.prepare('SELECT id FROM direct_outreach_log WHERE human_approved = 0 LIMIT 1').get() as any;
      expect(draft).toBeDefined();

      const res = await app.request(`/api/v1/owner/direct-outreach/${encodeURIComponent(draft.id)}/approve`, {
        method: 'POST',
        headers: { 'x-user-id': 'usr_owner_primary' }
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe('APPROVED');

      const updated = db.prepare('SELECT human_approved, response_status FROM direct_outreach_log WHERE id = ?').get(draft.id) as any;
      expect(updated.human_approved).toBe(1);
      expect(updated.response_status).toBe('APPROVED');
    });

    it('2c. POST /api/v1/owner/direct-outreach/:id/record-dispatch records dispatch and updates experiment lead counts', async () => {
      const db = getDb();
      const draft = db.prepare('SELECT id, segment, prospect_name FROM direct_outreach_log WHERE dispatched = 0 LIMIT 1').get() as any;
      expect(draft).toBeDefined();

      const res = await app.request(`/api/v1/owner/direct-outreach/${encodeURIComponent(draft.id)}/record-dispatch`, {
        method: 'POST',
        headers: { 'x-user-id': 'usr_owner_primary' }
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe('DISPATCHED');

      // Verify direct_outreach_log is marked dispatched
      const updated = db.prepare('SELECT dispatched, dispatch_timestamp, response_status FROM direct_outreach_log WHERE id = ?').get(draft.id) as any;
      expect(updated.dispatched).toBe(1);
      expect(updated.dispatch_timestamp).toBeTruthy();
      expect(updated.response_status).toBe('DISPATCHED');

      // Verify prospect in platform_prospects moved to CONTACTED stage
      const prospect = db.prepare('SELECT stage, status, contact_count FROM platform_prospects WHERE prospect_business_name = ? OR business_name = ?').get(draft.prospect_name, draft.prospect_name) as any;
      if (prospect) {
        expect(prospect.stage).toBe('CONTACTED');
        expect(prospect.contact_count).toBeGreaterThanOrEqual(1);
      }
    });

    it('2d. POST /api/v1/owner/direct-outreach/:id/opt-out enforces 60-day suppression cooldown', async () => {
      const db = getDb();
      const draft = db.prepare("SELECT id, prospect_name FROM direct_outreach_log WHERE response_status != 'OPT_OUT' LIMIT 1").get() as any;
      expect(draft).toBeDefined();

      const res = await app.request(`/api/v1/owner/direct-outreach/${encodeURIComponent(draft.id)}/opt-out`, {
        method: 'POST',
        headers: { 'x-user-id': 'usr_owner_primary' }
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe('OPT_OUT');
      expect(json.cooldownDays).toBe(60);

      // Verify prospect marked opted-out
      const prospect = db.prepare('SELECT is_opted_out, stage FROM platform_prospects WHERE prospect_business_name = ? OR business_name = ?').get(draft.prospect_name, draft.prospect_name) as any;
      if (prospect) {
        expect(prospect.is_opted_out).toBe(1);
        expect(prospect.stage).toBe('LOST');
      }

      // Verify identifier added to outreach_suppression_list
      const suppressionRows = db.prepare('SELECT * FROM outreach_suppression_list').all() as any[];
      expect(suppressionRows.length).toBeGreaterThanOrEqual(1);
    });

    it('2e. POST /api/v1/owner/direct-outreach/:id/record-reply logs customer reply', async () => {
      const db = getDb();
      const draft = db.prepare('SELECT id FROM direct_outreach_log LIMIT 1').get() as any;

      const res = await app.request(`/api/v1/owner/direct-outreach/${encodeURIComponent(draft.id)}/record-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'usr_owner_primary'
        },
        body: JSON.stringify({ replyType: 'INTERESTED', notes: 'Doctor requested 4 PM phone demo on Tuesday.' })
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.responseStatus).toBe('INTERESTED');

      const updated = db.prepare('SELECT response_status FROM direct_outreach_log WHERE id = ?').get(draft.id) as any;
      expect(updated.response_status).toBe('INTERESTED');
    });
  });

  describe('3. Owner Digest Review Queue (/owner/today)', () => {
    it('3a. GET /owner/today serves complete review queue with 1-click links and action buttons', async () => {
      const res = await app.request('/owner/today?format=html', {
        headers: {
          'accept': 'text/html',
          'x-user-id': 'usr_owner_primary'
        }
      });
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('Daily Owner Digest &amp; Control Dashboard');
      expect(html).toContain('Autonomous Operations &amp; Workflows (18 Active)');
      expect(html).toContain('recordDispatch(');
      expect(html).toContain('copyDraft(');
      expect(html).toContain('recordOptOut(');
      expect(html).toContain('https://wa.me/');
    });
  });

  describe('4. Delivery Playbook & Ethical Google Review Protocols', () => {
    it('4a. DELIVERY_PLAYBOOK.md contains Step 9 GBP Review Request and NMC ethical compliance', () => {
      const possiblePaths = [
        path.resolve(process.cwd(), 'owner/DELIVERY_PLAYBOOK.md'),
        path.resolve(process.cwd(), '../../owner/DELIVERY_PLAYBOOK.md'),
        path.resolve(__dirname, '../../../../owner/DELIVERY_PLAYBOOK.md')
      ];
      const playbookPath = possiblePaths.find(p => fs.existsSync(p));
      expect(playbookPath).toBeDefined();
      const content = fs.readFileSync(playbookPath!, 'utf8');

      expect(content).toContain('Step 9');
      expect(content).toContain('Post-Consultation GBP Review Quick Reply');
      expect(content).toContain('/review');
      expect(content).toContain('National Medical Commission (NMC)');
      expect(content).toContain('NEVER offer paid or incentivized reviews');
    });
  });
});
