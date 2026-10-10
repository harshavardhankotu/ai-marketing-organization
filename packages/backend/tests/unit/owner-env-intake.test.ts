import { describe, it, expect, beforeEach } from 'vitest';
import { validateOwnerEnvFacts, initOwnerEnvIntake } from '../../src/config/owner-env-intake.js';
import { getDb } from '../../src/db/client.js';

describe('Step 5: Owner Facts from Environment Variables (No Form)', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_intake (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        application_date TEXT,
        listed_site_urls_json TEXT,
        agreement_read_confirmed INTEGER NOT NULL DEFAULT 0,
        agreement_read_confirmed_at TEXT,
        site_name TEXT,
        author_name TEXT,
        contact_email TEXT,
        tavily_key_rotated INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        updated_at TEXT,
        written_by TEXT NOT NULL DEFAULT 'OWNER_FORM',
        status TEXT NOT NULL DEFAULT 'VALID',
        created_at TEXT
      );
    `);
    db.prepare(`DELETE FROM owner_intake WHERE id = 'primary'`).run();
  });

  it('fails validation when any required environment variable is missing (Step 5a, 5c)', () => {
    const emptyEnv = {};
    const res = validateOwnerEnvFacts(emptyEnv);
    expect(res.valid).toBe(false);
    expect(res.missingFields).toContain('ASSOCIATES_APPLICATION_DATE');
    expect(res.missingFields).toContain('ASSOCIATES_LISTED_SITE_URL');
    expect(res.missingFields).toContain('ASSOCIATES_AGREEMENT_READ');
    expect(res.missingFields).toContain('PUBLIC_SITE_NAME');
    expect(res.missingFields).toContain('PUBLIC_AUTHOR_NAME');
    expect(res.missingFields).toContain('PUBLIC_CONTACT_EMAIL');

    // Boot initialization must NOT create row
    const initRes = initOwnerEnvIntake(emptyEnv);
    expect(initRes.initialized).toBe(false);
    const db = getDb();
    const row = db.prepare(`SELECT * FROM owner_intake WHERE id = 'primary'`).get();
    expect(row).toBeUndefined();
  });

  it('fails validation when placeholder or bracketed text is provided (Step 5b, 5f)', () => {
    const placeholderEnv = {
      ASSOCIATES_APPLICATION_DATE: '[INSERT_DATE_HERE]',
      ASSOCIATES_LISTED_SITE_URL: 'https://placeholder.example.com',
      ASSOCIATES_AGREEMENT_READ: 'true',
      PUBLIC_SITE_NAME: '<PUT_SITE_NAME>',
      PUBLIC_AUTHOR_NAME: 'TODO_AUTHOR',
      PUBLIC_CONTACT_EMAIL: 'your_email@domain.com'
    };

    const res = validateOwnerEnvFacts(placeholderEnv);
    expect(res.valid).toBe(false);
    expect(res.invalidFields.length).toBeGreaterThan(0);
    expect(res.invalidFields.some(f => f.field === 'ASSOCIATES_APPLICATION_DATE')).toBe(true);
    expect(res.invalidFields.some(f => f.field === 'PUBLIC_SITE_NAME')).toBe(true);

    const initRes = initOwnerEnvIntake(placeholderEnv);
    expect(initRes.initialized).toBe(false);
    const db = getDb();
    const row = db.prepare(`SELECT * FROM owner_intake WHERE id = 'primary'`).get();
    expect(row).toBeUndefined();
  });

  it('fails validation when application date is in the future or URL is not https (Step 5b)', () => {
    const futureDate = new Date(Date.now() + 86400000 * 10).toISOString().split('T')[0];
    const invalidEnv = {
      ASSOCIATES_APPLICATION_DATE: futureDate,
      ASSOCIATES_LISTED_SITE_URL: 'http://insecure-site.com', // not https
      ASSOCIATES_AGREEMENT_READ: 'true',
      PUBLIC_SITE_NAME: 'Valid Site',
      PUBLIC_AUTHOR_NAME: 'Valid Author',
      PUBLIC_CONTACT_EMAIL: 'valid@site.org'
    };

    const res = validateOwnerEnvFacts(invalidEnv);
    expect(res.valid).toBe(false);
    expect(res.invalidFields.some(f => f.field === 'ASSOCIATES_APPLICATION_DATE' && f.reason.includes('past'))).toBe(true);
    expect(res.invalidFields.some(f => f.field === 'ASSOCIATES_LISTED_SITE_URL' && f.reason.includes('https'))).toBe(true);
  });

  it('succeeds with valid values, creates owner_intake with written_by OWNER_ENV, and computes 180-day deadline (Step 5b, 5e)', () => {
    const validEnv = {
      ASSOCIATES_APPLICATION_DATE: '2026-08-15',
      ASSOCIATES_LISTED_SITE_URL: 'https://aimarketing.org',
      ASSOCIATES_AGREEMENT_READ: 'true',
      PUBLIC_SITE_NAME: 'Tech Consumer Guides',
      PUBLIC_AUTHOR_NAME: 'Editorial Staff',
      PUBLIC_CONTACT_EMAIL: 'contact@aimarketing.org'
    };

    const res = validateOwnerEnvFacts(validEnv);
    expect(res.valid).toBe(true);
    expect(res.facts).toBeDefined();
    expect(res.deadline180Days).toBeDefined();
    expect(res.deadline180Days?.label).toBe('owner-reported, verify in Associates Central');

    // 180 days from 2026-08-15 is ~2027-02-11
    const appMs = new Date('2026-08-15').getTime();
    const expectedDeadline = new Date(appMs + 180 * 86400000).toISOString().split('T')[0];
    expect(res.deadline180Days?.deadlineDate).toBe(expectedDeadline);

    // Boot initialization creates owner_intake
    const initRes = initOwnerEnvIntake(validEnv);
    expect(initRes.initialized).toBe(true);

    const db = getDb();
    const row = db.prepare(`SELECT * FROM owner_intake WHERE id = 'primary'`).get() as any;
    expect(row).toBeDefined();
    expect(row.written_by).toBe('OWNER_ENV');
    expect(row.status).toBe('VALID');
    expect(row.site_name).toBe('Tech Consumer Guides');
    expect(row.author_name).toBe('Editorial Staff');
    expect(row.contact_email).toBe('contact@aimarketing.org');
    expect(row.listed_site_urls_json).toBe(JSON.stringify(['https://aimarketing.org']));
  });
});
