#!/usr/bin/env node
/**
 * scripts/owner-apply.mjs — Owner-Only Fact Application & Render Sync Script
 *
 * Implements Step 9:
 * - Strictly executed by the HUMAN OWNER only (never by autonomous agents).
 * - Reads gitignored `.env.owner_facts`.
 * - Validates each owner fact format and integrity.
 * - Computes DIRECT_OFFER_TERMS_SHA256 directly from owner/OWN_OFFER.md.
 * - Updates Render service environment variables one key at a time.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

console.log('======================================================');
console.log('       HUMAN OWNER FACT ATTESTATION & RENDER SYNC     ');
console.log('======================================================\n');

// Step 10b: Known agent-written legacy terms SHA-256 hashes
export const LEGACY_AGENT_TERMS_SHA256 = [
  '778922fd08bda0745e74ff4baa368d58d6ba3729634c25dfa03b65a0fe684934'
];

// Determine target offer file
const offerFileArg = process.argv.find(a => a.startsWith('--offer-file='));
const targetOfferFile = offerFileArg ? path.resolve(process.cwd(), offerFileArg.split('=')[1]) : path.resolve(process.cwd(), 'owner', 'OWN_OFFER.md');

let offerFileHash = null;
if (fs.existsSync(targetOfferFile)) {
  const fileContent = fs.readFileSync(targetOfferFile, 'utf8');
  const computedHash = crypto.createHash('sha256').update(fileContent).digest('hex');
  offerFileHash = computedHash;

  if (LEGACY_AGENT_TERMS_SHA256.includes(computedHash.toLowerCase())) {
    console.error(`\n[REFUSAL] The file '${targetOfferFile}' matches a known agent-written legacy terms template (${computedHash}).`);
    console.error(`REFUSAL: Cannot attest legacy agent-written offer terms: ${computedHash}`);
    console.error('The human owner must write or edit the offer terms personally.');
    console.error('Edit owner/OWN_OFFER.draft.md into your own terms and save it as owner/OWN_OFFER.md.');
    process.exit(1);
  }

  // Step 10d: Deliverable verification against capability registry
  console.log('Auditing deliverables against capability registry...');
  const verifiedCapabilities = new Set([
    'Custom WhatsApp triage and FAQ response bot',
    'Google Business Profile instant lead capture',
    'Multi-touch follow-up workflow',
    'Direct calendar booking integration',
    'Live system handover report'
  ]);

  const deliverableMatches = fileContent.match(/^\s*[-*]\s+(.*)$/gm) || [];
  for (const rawLine of deliverableMatches) {
    const item = rawLine.replace(/^\s*[-*]\s+/, '').trim();
    if (item && !verifiedCapabilities.has(item) && !item.toLowerCase().includes('manual')) {
      console.warn(`[WARNING] Deliverable '${item}' is not verified as MANUAL_BY_OWNER or IMPLEMENTED_VERIFIED in capability registry.`);
    }
  }

  if (offerFileArg && !process.argv.includes('--apply')) {
    console.log(`✓ Offer file audited successfully: ${computedHash}`);
    process.exit(0);
  }
}

// 1. Read .env.owner_facts
const factsPath = path.resolve(process.cwd(), '.env.owner_facts');
if (!fs.existsSync(factsPath)) {
  console.error(`[ERROR] File not found: ${factsPath}`);
  console.error(`Please create '.env.owner_facts' with your desired configuration.`);
  console.error(`Refer to owner/OWN_OFFER.draft.md and user prompt for required fields.`);
  process.exit(1);
}

const rawText = fs.readFileSync(factsPath, 'utf-8');
const envVars = {};

for (const line of rawText.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const [k, ...rest] = trimmed.split('=');
  let val = rest.join('=').trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  envVars[k.trim()] = val;
}

// 2. Validate facts
const errors = [];

// Associates statutory facts (optional until affiliate lane starts)
if (envVars.ASSOCIATES_APPLICATION_DATE && !/^\d{4}-\d{2}-\d{2}$/.test(envVars.ASSOCIATES_APPLICATION_DATE)) {
  errors.push('ASSOCIATES_APPLICATION_DATE must be YYYY-MM-DD');
}
if (envVars.ASSOCIATES_LISTED_SITE_URL && !/^https?:\/\//.test(envVars.ASSOCIATES_LISTED_SITE_URL)) {
  errors.push('ASSOCIATES_LISTED_SITE_URL must start with http:// or https://');
}
if (envVars.ASSOCIATES_AGREEMENT_READ && envVars.ASSOCIATES_AGREEMENT_READ !== 'true') {
  errors.push('ASSOCIATES_AGREEMENT_READ must be "true"');
}
if (envVars.PUBLIC_CONTACT_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(envVars.PUBLIC_CONTACT_EMAIL)) {
  errors.push('PUBLIC_CONTACT_EMAIL must be a valid email format');
}

// Direct offer confirmation
if (envVars.OWN_OFFER_CONFIRMED && envVars.OWN_OFFER_CONFIRMED !== 'true') {
  errors.push('OWN_OFFER_CONFIRMED must be "true" to confirm your own offer terms');
}

  if (offerFileHash) {
    envVars.DIRECT_OFFER_TERMS_SHA256 = offerFileHash;
    console.log(`✓ Computed DIRECT_OFFER_TERMS_SHA256: ${envVars.DIRECT_OFFER_TERMS_SHA256.slice(0, 16)}...`);
  }

// WhatsApp phone format validation
if (envVars.OWNER_WHATSAPP_NUMBER) {
  const cleanPhone = envVars.OWNER_WHATSAPP_NUMBER.replace(/\D/g, '');
  if (cleanPhone.length < 10 || cleanPhone.length > 15) {
    errors.push('OWNER_WHATSAPP_NUMBER must be 10-15 digits with country code');
  }
}

// Telegram credentials validation
if (envVars.TELEGRAM_OWNER_CHAT_ID) {
  if (envVars.TELEGRAM_OWNER_CHAT_ID.startsWith('-100')) {
    errors.push('TELEGRAM_OWNER_CHAT_ID must be a personal chat ID, not a channel broadcast (-100)');
  }
}

if (errors.length > 0) {
  console.error('\n[VALIDATION FAILED]');
  errors.forEach(e => console.error(` - ${e}`));
  process.exit(1);
}

// 3. Render API configuration
const renderApiKey = process.env.RENDER_API_KEY || envVars.RENDER_API_KEY;
const serviceId = process.env.RENDER_SERVICE_ID || envVars.RENDER_SERVICE_ID || 'srv-darecoc9v7es73ea8t2g';

if (!renderApiKey) {
  console.error('[ERROR] RENDER_API_KEY not found in environment or .env.owner_facts.');
  console.error('Please configure RENDER_API_KEY to allow setting environment variables.');
  process.exit(1);
}

// 4. Set Render variables one key at a time
console.log('\n[SYNCING TO RENDER] Updating variables one key at a time...\n');

const keysToSync = [
  'ASSOCIATES_APPLICATION_DATE',
  'ASSOCIATES_LISTED_SITE_URL',
  'ASSOCIATES_AGREEMENT_READ',
  'PUBLIC_SITE_NAME',
  'PUBLIC_AUTHOR_NAME',
  'PUBLIC_CONTACT_EMAIL',
  'OWN_OFFER_CONFIRMED',
  'DIRECT_OFFER_TERMS_SHA256',
  'OWNER_WHATSAPP_NUMBER',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_OWNER_CHAT_ID',
  'TELEGRAM_ENABLED'
];

for (const key of keysToSync) {
  if (!envVars[key]) continue;

  const val = envVars[key];
  const url = `https://api.render.com/v1/services/${serviceId}/env-vars/${key}`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${renderApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: val })
    });

    if (res.ok) {
      console.log(`✓ Set ${key} in Render`);
    } else {
      // Try POST if PUT returned 404 (creating new variable)
      const postUrl = `https://api.render.com/v1/services/${serviceId}/env-vars`;
      const postRes = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${renderApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{ key, value: val }])
      });
      if (postRes.ok) {
        console.log(`✓ Created ${key} in Render`);
      } else {
        const errText = await postRes.text().catch(() => '');
        console.error(`✗ Failed to set ${key}: HTTP ${postRes.status} (${errText.slice(0, 100)})`);
      }
    }
  } catch (err) {
    console.error(`✗ Error setting ${key}: ${err.message}`);
  }
}

console.log('\n======================================================');
console.log('   SYNC COMPLETE. Check /api/v1/owner/facts-status   ');
console.log('======================================================');
