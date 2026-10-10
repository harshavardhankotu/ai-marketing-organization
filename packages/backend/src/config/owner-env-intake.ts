import { getDb } from '../db/client.js';

export interface OwnerEnvFacts {
  applicationDate: string;
  listedSiteUrl: string;
  agreementRead: boolean;
  siteName: string;
  authorName: string;
  contactEmail: string;
}

export interface OwnerEnvValidationResult {
  valid: boolean;
  facts?: OwnerEnvFacts;
  missingFields: string[];
  invalidFields: { field: string; reason: string }[];
  deadline180Days?: {
    deadlineDate: string;
    label: string;
  };
}

const PLACEHOLDER_PATTERN = /(\[|\]|<|>|\bPUT_\b|\bINSERT\b|\bplaceholder\b|\bexample\b|\byour_\b|\btodo\b)/i;

/**
 * Validates the 6 mandatory owner-provided environment variables (Step 5).
 */
export function validateOwnerEnvFacts(env: Record<string, string | undefined> = process.env): OwnerEnvValidationResult {
  const missingFields: string[] = [];
  const invalidFields: { field: string; reason: string }[] = [];

  const appDate = env.ASSOCIATES_APPLICATION_DATE?.trim();
  const listedUrl = env.ASSOCIATES_LISTED_SITE_URL?.trim();
  const agreementRead = env.ASSOCIATES_AGREEMENT_READ?.trim();
  const siteName = env.PUBLIC_SITE_NAME?.trim();
  const authorName = env.PUBLIC_AUTHOR_NAME?.trim();
  const contactEmail = env.PUBLIC_CONTACT_EMAIL?.trim();

  // 1. ASSOCIATES_APPLICATION_DATE
  if (!appDate) {
    missingFields.push('ASSOCIATES_APPLICATION_DATE');
  } else if (PLACEHOLDER_PATTERN.test(appDate)) {
    invalidFields.push({ field: 'ASSOCIATES_APPLICATION_DATE', reason: 'Contains placeholder text' });
  } else {
    const parsed = new Date(appDate);
    if (isNaN(parsed.getTime())) {
      invalidFields.push({ field: 'ASSOCIATES_APPLICATION_DATE', reason: 'Invalid date format (must be YYYY-MM-DD)' });
    } else if (parsed >= new Date()) {
      invalidFields.push({ field: 'ASSOCIATES_APPLICATION_DATE', reason: 'Application date must be in the past' });
    }
  }

  // 2. ASSOCIATES_LISTED_SITE_URL
  if (!listedUrl) {
    missingFields.push('ASSOCIATES_LISTED_SITE_URL');
  } else if (PLACEHOLDER_PATTERN.test(listedUrl)) {
    invalidFields.push({ field: 'ASSOCIATES_LISTED_SITE_URL', reason: 'Contains placeholder text' });
  } else if (!listedUrl.startsWith('https://')) {
    invalidFields.push({ field: 'ASSOCIATES_LISTED_SITE_URL', reason: 'Must be an https:// URL' });
  }

  // 3. ASSOCIATES_AGREEMENT_READ
  if (!agreementRead) {
    missingFields.push('ASSOCIATES_AGREEMENT_READ');
  } else if (!['true', '1', 'yes'].includes(agreementRead.toLowerCase())) {
    invalidFields.push({ field: 'ASSOCIATES_AGREEMENT_READ', reason: "Must be 'true' indicating owner has read the operating agreement" });
  }

  // 4. PUBLIC_SITE_NAME
  if (!siteName) {
    missingFields.push('PUBLIC_SITE_NAME');
  } else if (PLACEHOLDER_PATTERN.test(siteName)) {
    invalidFields.push({ field: 'PUBLIC_SITE_NAME', reason: 'Contains placeholder or bracketed text' });
  }

  // 5. PUBLIC_AUTHOR_NAME
  if (!authorName) {
    missingFields.push('PUBLIC_AUTHOR_NAME');
  } else if (PLACEHOLDER_PATTERN.test(authorName)) {
    invalidFields.push({ field: 'PUBLIC_AUTHOR_NAME', reason: 'Contains placeholder or bracketed text' });
  }

  // 6. PUBLIC_CONTACT_EMAIL
  if (!contactEmail) {
    missingFields.push('PUBLIC_CONTACT_EMAIL');
  } else if (PLACEHOLDER_PATTERN.test(contactEmail)) {
    invalidFields.push({ field: 'PUBLIC_CONTACT_EMAIL', reason: 'Contains placeholder or bracketed text' });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    invalidFields.push({ field: 'PUBLIC_CONTACT_EMAIL', reason: 'Invalid email address format' });
  }

  if (missingFields.length > 0 || invalidFields.length > 0) {
    return {
      valid: false,
      missingFields,
      invalidFields
    };
  }

  // All 6 valid
  const appDateParsed = new Date(appDate!);
  const deadlineMs = appDateParsed.getTime() + 180 * 24 * 60 * 60 * 1000;
  const deadlineDate = new Date(deadlineMs).toISOString().split('T')[0];

  return {
    valid: true,
    facts: {
      applicationDate: appDate!,
      listedSiteUrl: listedUrl!,
      agreementRead: true,
      siteName: siteName!,
      authorName: authorName!,
      contactEmail: contactEmail!
    },
    missingFields: [],
    invalidFields: [],
    deadline180Days: {
      deadlineDate,
      label: 'owner-reported, verify in Associates Central'
    }
  };
}

/**
 * Initializes owner intake row from environment variables at system boot.
 * Creates an owner_intake record ONLY if all 6 facts are valid.
 */
export function initOwnerEnvIntake(env: Record<string, string | undefined> = process.env): {
  initialized: boolean;
  validation: OwnerEnvValidationResult;
} {
  const validation = validateOwnerEnvFacts(env);

  if (!validation.valid || !validation.facts) {
    return { initialized: false, validation };
  }

  const db = getDb();
  const { facts } = validation;

  const rowId = 'primary';
  const orgId = 'org_owner_primary';
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO owner_intake (
      id, organization_id, application_date, listed_site_urls_json,
      agreement_read_confirmed, agreement_read_confirmed_at,
      site_name, author_name, contact_email, tavily_key_rotated,
      completed_at, updated_at, written_by, status, created_at
    ) VALUES (
      ?, ?, ?, ?,
      1, ?,
      ?, ?, ?, 1,
      ?, ?, 'OWNER_ENV', 'VALID', ?
    )
    ON CONFLICT(id) DO UPDATE SET
      application_date = excluded.application_date,
      listed_site_urls_json = excluded.listed_site_urls_json,
      agreement_read_confirmed = 1,
      site_name = excluded.site_name,
      author_name = excluded.author_name,
      contact_email = excluded.contact_email,
      written_by = 'OWNER_ENV',
      status = 'VALID',
      updated_at = excluded.updated_at
  `).run(
    rowId,
    orgId,
    facts.applicationDate,
    JSON.stringify([facts.listedSiteUrl]),
    now,
    facts.siteName,
    facts.authorName,
    facts.contactEmail,
    now,
    now,
    now
  );

  return { initialized: true, validation };
}
