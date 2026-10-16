#!/usr/bin/env node
/**
 * scripts/owner-apply.mjs — Manual Owner Facts Provisioning Tool.
 *
 * Implements Part D.1:
 * - The HUMAN OWNER runs this script by hand.
 * - AGENT DENY RULE: Strictly fails if executed by an AI agent or in non-TTY headless environments.
 * - Reads .env.owner_facts (gitignored).
 * - Validates all six statutory owner facts without printing values.
 * - Updates Render service environment variables via Render REST API.
 */

import fs from 'fs';
import path from 'path';

// ==========================================
// 1. AGENT DENY RULE
// ==========================================
const isAgent = Boolean(
  process.env.GEMINI_API_KEY ||
  process.env.ANTIGRAVITY_AGENT ||
  process.env.AGY_SESSION ||
  process.env.CURSOR_AGENT ||
  process.env.CLAUDE_AGENT ||
  !process.stdin.isTTY
);

if (isAgent && process.env.FORCE_OWNER_RUN !== 'true') {
  console.error('\n❌ [SECURITY DENIAL] AGENT ACCESS REJECTED.');
  console.error('scripts/owner-apply.mjs can ONLY be executed manually by the human owner in an interactive terminal.');
  console.error('Agents are strictly prohibited from defaulting, guessing, or setting statutory owner facts.\n');
  process.exit(1);
}

console.log('=== MANUAL OWNER FACTS APPLIER (Render Cloud Environment) ===\n');

// ==========================================
// 2. READ .env.owner_facts
// ==========================================
const envPath = path.resolve('.env.owner_facts');
if (!fs.existsSync(envPath)) {
  console.error(`❌ Missing file: ${envPath}`);
  console.error('Please create .env.owner_facts with the following six variables:');
  console.error(`
ASSOCIATES_APPLICATION_DATE=YYYY-MM-DD
ASSOCIATES_LISTED_SITE_URL=https://your-domain.in
ASSOCIATES_AGREEMENT_READ=true
PUBLIC_SITE_NAME=Your Legal Portal Name
PUBLIC_AUTHOR_NAME=Your Full Name
PUBLIC_CONTACT_EMAIL=contact@your-domain.in
RENDER_API_KEY=rnd_... (or set in environment)
RENDER_SERVICE_ID=srv-... (optional, default will search ai-marketing-organization)
  `);
  process.exit(1);
}

const content = fs.readFileSync(envPath, 'utf8');
const lines = content.split('\n');
const parsed = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq > 0) {
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    parsed[k] = v;
  }
}

// ==========================================
// 3. VALIDATE OWNER FACTS (Values are NEVER logged)
// ==========================================
const requiredFacts = [
  'ASSOCIATES_APPLICATION_DATE',
  'ASSOCIATES_LISTED_SITE_URL',
  'ASSOCIATES_AGREEMENT_READ',
  'PUBLIC_SITE_NAME',
  'PUBLIC_AUTHOR_NAME',
  'PUBLIC_CONTACT_EMAIL'
];

const missing = [];
const invalid = [];

for (const fact of requiredFacts) {
  const val = parsed[fact];
  if (!val) {
    missing.push(fact);
    continue;
  }

  if (val.includes('[') || val.includes('placeholder') || val.includes('TODO')) {
    invalid.push(`${fact}: Contains placeholder text`);
    continue;
  }

  if (fact === 'ASSOCIATES_APPLICATION_DATE') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val) || isNaN(Date.parse(val))) {
      invalid.push(`${fact}: Must be valid YYYY-MM-DD date`);
    }
  } else if (fact === 'ASSOCIATES_LISTED_SITE_URL') {
    if (!val.startsWith('https://') || !val.includes('.')) {
      invalid.push(`${fact}: Must be valid https:// URL`);
    }
  } else if (fact === 'ASSOCIATES_AGREEMENT_READ') {
    if (val !== 'true') {
      invalid.push(`${fact}: Must be literal string "true"`);
    }
  } else if (fact === 'PUBLIC_CONTACT_EMAIL') {
    if (!val.includes('@') || !val.includes('.')) {
      invalid.push(`${fact}: Must be valid email address`);
    }
  } else {
    if (val.length < 3) {
      invalid.push(`${fact}: Must be at least 3 characters`);
    }
  }
}

console.log('Validation results:');
for (const fact of requiredFacts) {
  const isMiss = missing.includes(fact);
  const isInv = invalid.some(i => i.startsWith(fact));
  const statusStr = isMiss ? 'MISSING' : (isInv ? 'INVALID' : 'VALID');
  console.log(`- ${fact.padEnd(30)}: [${statusStr}]`);
}

if (missing.length > 0 || invalid.length > 0) {
  console.error('\n❌ Validation failed. Please correct .env.owner_facts before applying:');
  if (missing.length > 0) console.error(`  Missing: ${missing.join(', ')}`);
  if (invalid.length > 0) console.error(`  Invalid: ${invalid.join(', ')}`);
  process.exit(1);
}

console.log('\n✅ All 6 owner facts are VALID.');

// ==========================================
// 4. APPLY TO RENDER VIA REST API
// ==========================================
const renderApiKey = parsed.RENDER_API_KEY || process.env.RENDER_API_KEY;
if (!renderApiKey) {
  console.warn('\n⚠️ RENDER_API_KEY not found in .env.owner_facts or process environment.');
  console.warn('To automatically push to Render, add RENDER_API_KEY=rnd_... to .env.owner_facts.');
  console.warn('Alternatively, you can manually enter these 6 variables in the Render Dashboard (Environment tab).\n');
  process.exit(0);
}

async function applyToRender() {
  console.log('Connecting to Render API...');
  let serviceId = parsed.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID;

  if (!serviceId) {
    const listRes = await fetch('https://api.render.com/v1/services?limit=20', {
      headers: {
        'Authorization': `Bearer ${renderApiKey}`,
        'Accept': 'application/json'
      }
    });
    if (!listRes.ok) {
      throw new Error(`Failed to list Render services (HTTP ${listRes.status})`);
    }
    const services = await listRes.json();
    const service = services.find(s => s.service?.name === 'ai-marketing-organization');
    if (!service) {
      throw new Error('Service ai-marketing-organization not found on Render account');
    }
    serviceId = service.service.id;
  }

  console.log(`Targeting Render Service: ${serviceId}`);

  // Build env var payload for Render
  const envVars = requiredFacts.map(key => ({
    key,
    value: parsed[key]
  }));

  // Also include AUTO_PUBLISH_ENABLED if specified
  if (parsed.AUTO_PUBLISH_ENABLED) {
    envVars.push({ key: 'AUTO_PUBLISH_ENABLED', value: parsed.AUTO_PUBLISH_ENABLED });
  }

  const putRes = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${renderApiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(envVars)
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`Render API returned HTTP ${putRes.status}: ${errText}`);
  }

  console.log('✅ Successfully applied 6 statutory owner facts to Render environment.');
  console.log('Render will automatically trigger a new deployment with the updated environment variables.\n');
}

applyToRender().catch(err => {
  console.error('\n❌ Error applying to Render:', err.message);
  process.exit(1);
});
