import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/client.js';
import { D1Client } from '../db/d1-client.js';

export interface StructuredHistoryItem {
  what: string;
  outcome: 'WORKED' | 'FAILED' | 'UNKNOWN';
  cause: string;
  rule: string;
  evidence_ref: string;
  source_file: string;
  date: string;
}

export interface IngestResult {
  totalConsidered: number;
  inserted: number;
  skippedDuplicates: number;
  countsByOutcome: {
    WORKED: number;
    FAILED: number;
    UNKNOWN: number;
  };
}

export class HistoryIngestService {
  private static instance: HistoryIngestService;

  public static getInstance(): HistoryIngestService {
    if (!HistoryIngestService.instance) {
      HistoryIngestService.instance = new HistoryIngestService();
    }
    return HistoryIngestService.instance;
  }

  /**
   * Generates a deterministic SHA-256 hash for deduplication.
   */
  public computeHash(item: StructuredHistoryItem): string {
    const raw = `${item.what.trim().toLowerCase()}|${item.outcome}|${item.cause.trim().toLowerCase()}|${item.rule.trim().toLowerCase()}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Compiles canonical structured facts from all authoritative history sources:
   * 1. KNOWN HISTORY (SEED ONLY)
   * 2. PROJECT_STATUS.md (Measured Facts & Known Resolved Issues & Superseded Claims)
   * 3. SYSTEM_MAP.md (Architecture & Verified Components)
   * 4. mistakes_board (Empirical mistakes and operational guardrails)
   * 5. learning_records (Existing policy entries)
   */
  public getCanonicalHistoryItems(): StructuredHistoryItem[] {
    return [
      // --- FROM KNOWN HISTORY (SEED ONLY) ---
      {
        what: 'Hourly cron runs one business only. Cooldowns and idle state work.',
        outcome: 'WORKED',
        cause: 'Durable cron architecture with single-business isolation and ActionCooldownManager.',
        rule: 'Hourly cron must process exactly one business per invocation and observe cooldowns.',
        evidence_ref: 'packages/cloudflare-worker/src/worker.ts; packages/backend/src/revenue/action-cooldown-manager.ts',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-06'
      },
      {
        what: 'Fail-closed gates: money path, partner approval, outbound hold.',
        outcome: 'WORKED',
        cause: 'Strict boolean checks with fail-closed default on unverified configurations.',
        rule: 'Block money actions, partner offers, and outbound communications unless explicitly verified.',
        evidence_ref: 'packages/backend/src/revenue/owner-auth.ts; packages/backend/src/commission/owner-control-center.ts',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-07'
      },
      {
        what: 'Hidden demo businesses return 404. Rate limit uses a trusted client IP.',
        outcome: 'WORKED',
        cause: 'Security isolation checks and salted SHA-256 IP rate limiting via DurableRateLimiter.',
        rule: 'Demo businesses must return 404 on public routes; rate limiter must extract trusted client IP.',
        evidence_ref: 'packages/backend/src/security/client-ip.ts; packages/backend/tests/unit/stop-the-waste-safety-pass.test.ts',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-06'
      },
      {
        what: 'Static site build from published guides only.',
        outcome: 'WORKED',
        cause: 'Static site generator filters strictly by published status in production D1.',
        rule: 'prepare-deploy must build ONLY from PUBLISHED guides in production D1, failing if none exist.',
        evidence_ref: 'scripts/prepare-deploy.mjs; packages/backend/src/commission/static-site-generator.ts',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-08'
      },
      {
        what: 'Tavily usage endpoint works on the free plan.',
        outcome: 'WORKED',
        cause: 'GET https://api.tavily.com/usage returns HTTP 200 with credit usage on free tier.',
        rule: 'Use GET https://api.tavily.com/usage for daily automated quota reconciliation.',
        evidence_ref: 'packages/backend/src/quota/unified-quota-service.ts',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-09'
      },
      {
        what: 'Ledger keeps EXPECTED, PENDING, VERIFIED, and PAID apart.',
        outcome: 'WORKED',
        cause: 'Commission ledger schema enforces strict event state transitions.',
        rule: 'Commission ledger must never conflate estimated, pending, and verified earnings.',
        evidence_ref: 'packages/backend/src/commission/commission-ledger.ts',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-02'
      },
      {
        what: 'Discovery loop made duplicate and junk prospects (video, directory, PDF).',
        outcome: 'FAILED',
        cause: 'Search queries lacked domain negative filters and deduplication against existing prospects.',
        rule: 'Filter out junk domains (.pdf, directories, YouTube) and enforce deduplication hash before insertion.',
        evidence_ref: 'packages/backend/tests/unit/stop-the-waste-safety-pass.test.ts:skips candidates whose domain or source URL already exists in platform_prospects',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-06'
      },
      {
        what: 'Fixture businesses ran in production cycles.',
        outcome: 'FAILED',
        cause: 'ARO cycle picked demo businesses (smilekraft, platform-aro) due to lack of environment scoping.',
        rule: 'Exclude demo and fixture businesses from production execution loops.',
        evidence_ref: 'packages/backend/src/revenue/autonomous-revenue-orchestrator.ts',
        source_file: 'KNOWN_HISTORY',
        date: '2026-09-29'
      },
      {
        what: 'Counters differed from the provider dashboard (Tavily).',
        outcome: 'FAILED',
        cause: 'Local in-memory counter claimed 4 credits while Tavily dashboard showed 226 credits.',
        rule: 'Never rely on local counters alone; reconcile with provider usage API and flag drift >10%.',
        evidence_ref: 'scripts/generate-status.mjs; packages/backend/src/quota/unified-quota-service.ts',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-08'
      },
      {
        what: 'Agent wrote a production log row by script and called it app provenance.',
        outcome: 'FAILED',
        cause: 'Script inserted call_1791393061443_spec01 into production D1 directly.',
        rule: 'Do not write to production D1 from scratch/ or scripts/; app provenance requires runtime calls.',
        evidence_ref: 'scripts/check-no-scratch-writes.mjs',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-08'
      },
      {
        what: 'Agent chose products and wrote facts as if the owner checked them.',
        outcome: 'FAILED',
        cause: 'Agent synthesized product facts and marked proposals without owner review.',
        rule: 'Product approval requires explicit owner submission with canonical Amazon URL, 3 facts, and product_checked=true.',
        evidence_ref: 'packages/backend/src/commission/owner-control-center.ts',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-08'
      },
      {
        what: 'Reports said PASS without raw proof. Raw output changed between reports.',
        outcome: 'FAILED',
        cause: 'Manual summary and paraphrasing without raw command output.',
        rule: 'Give PASS only when raw output proves it; paste raw CLI output without alteration.',
        evidence_ref: 'mistakes_board:mst_02_pass_without_raw_proof',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-08'
      },
      {
        what: 'The 80 catalog agents are not wired. They produced no output.',
        outcome: 'FAILED',
        cause: 'Catalog agents existed as definitions without execution wiring in the revenue orchestrator.',
        rule: 'Do not rely on unwired agents for revenue; use deterministic single-owner pipeline.',
        evidence_ref: 'AGENTS.md',
        source_file: 'KNOWN_HISTORY',
        date: 'UNKNOWN'
      },
      {
        what: 'No traffic source exists. No guide is published. No visitor has arrived.',
        outcome: 'FAILED',
        cause: 'Zero published guides in production D1 and lack of inbound distribution channels.',
        rule: 'Focus on demand engine matching people who ask for recommendations to approved offers.',
        evidence_ref: 'PROJECT_STATUS.md',
        source_file: 'KNOWN_HISTORY',
        date: '2026-10-08'
      },
      {
        what: 'Intent-based discovery of people who ask for recommendations.',
        outcome: 'UNKNOWN',
        cause: 'Not tried yet. Demand engine state machine being implemented.',
        rule: 'Discover commercial intent queries on owner-approved public hosts and score 0-100.',
        evidence_ref: 'packages/backend/src/commission/demand-engine.ts',
        source_file: 'KNOWN_HISTORY',
        date: 'UNKNOWN'
      },
      {
        what: 'Non-Amazon partners.',
        outcome: 'UNKNOWN',
        cause: 'Not tried yet. Researching Indian affiliate networks for individual signups.',
        rule: 'Verify KYC, payout rules, and link formatting before submitting for owner approval.',
        evidence_ref: 'packages/backend/src/commission/partner-registry.ts',
        source_file: 'KNOWN_HISTORY',
        date: 'UNKNOWN'
      },
      {
        what: 'Search Console data from the owner\'s own site.',
        outcome: 'UNKNOWN',
        cause: 'Not tried yet. Awaiting owner connecting Search Console.',
        rule: 'Use Search Console query impressions as highest-quality proof of search intent.',
        evidence_ref: 'packages/backend/src/commission/search-console.ts',
        source_file: 'KNOWN_HISTORY',
        date: 'UNKNOWN'
      },

      // --- FROM PROJECT_STATUS.md (Known Resolved Issues & Hardening) ---
      {
        what: 'Fake Booking Success Screen: Hardened consultation booking to require backend verification',
        outcome: 'WORKED',
        cause: 'Client showed success without confirming backend payment request.',
        rule: 'Require backend database confirmation for consultation bookings.',
        evidence_ref: 'PROJECT_STATUS.md:c276790',
        source_file: 'PROJECT_STATUS.md',
        date: '2026-09-29'
      },
      {
        what: 'Razorpay Default Webhook Secret Fallback: Replaced with strict production fail-closed signature verification',
        outcome: 'WORKED',
        cause: 'Insecure fallback secret in non-production allowed unsigned webhooks.',
        rule: 'Reject webhooks in production if webhook secret is missing or invalid.',
        evidence_ref: 'PROJECT_STATUS.md:c276790,47f880d',
        source_file: 'PROJECT_STATUS.md',
        date: '2026-09-29'
      },
      {
        what: 'D1 Migration Parser Regex Bug: Fixed runner with robust statement splitter',
        outcome: 'WORKED',
        cause: 'Naive regex broke on semicolons inside quotes or comments.',
        rule: 'Use robust character-by-character SQL statement parser for migrations.',
        evidence_ref: 'packages/backend/src/db/d1-migrations/index.ts',
        source_file: 'PROJECT_STATUS.md',
        date: '2026-09-29'
      },
      {
        what: 'Category policy block query: Executes SQL against learning_records with category input',
        outcome: 'WORKED',
        cause: 'Category block query previously had no input parameter.',
        rule: 'Category policy query must pass target category as parameter to SQL.',
        evidence_ref: 'packages/backend/tests/unit/owner-control-center.test.ts:category policy executes SQL against learning_records with category input and uses matched rows',
        source_file: 'PROJECT_STATUS.md',
        date: '2026-10-09'
      },

      // --- FROM mistakes_board (Open and Fixed empirical mistakes) ---
      {
        what: 'Placeholder text left in prompts (mst_01)',
        outcome: 'FAILED',
        cause: 'Agent prompts contained placeholder brackets and template variables.',
        rule: 'Reject any value that contains brackets, PUT_, or INSERT.',
        evidence_ref: 'mistakes_board:mst_01_placeholder_prompts',
        source_file: 'mistakes_board',
        date: '2026-10-06'
      },
      {
        what: 'Hook tested by script only. Antigravity did not run it (mst_07)',
        outcome: 'FAILED',
        cause: 'Hook verification executed standalone test script without interception in agent runtime.',
        rule: 'Report PARTIAL when a hook is tested by script only and not intercepted by Antigravity runtime.',
        evidence_ref: 'mistakes_board:mst_07_hook_tested_by_script_only',
        source_file: 'mistakes_board',
        date: '2026-10-08'
      },
      {
        what: 'Provider limits written as fact without a source (mst_08)',
        outcome: 'FAILED',
        cause: 'Hardcoded 1500 for Gemini and 1000 for Tavily without official citation.',
        rule: 'Leave provider limits as NULL (UNKNOWN) unless citing official documentation, or label ASSUMPTION.',
        evidence_ref: 'mistakes_board:mst_08_provider_limits_unverified_source',
        source_file: 'mistakes_board',
        date: '2026-10-08'
      },
      {
        what: 'Guide generated before owner approval (mst_12)',
        outcome: 'FAILED',
        cause: 'Guide generation triggered on unapproved candidate proposal.',
        rule: 'Guide drafting must strictly gate on owner-approved proposal and offer active=1.',
        evidence_ref: 'mistakes_board:mst_12_guide_generated_before_approval',
        source_file: 'mistakes_board',
        date: '2026-10-08'
      },
      {
        what: 'Production log row written by script and shown as app provenance (mst_14)',
        outcome: 'FAILED',
        cause: 'Direct insert of call_1791393061443_spec01 via scratch script.',
        rule: 'Never write production log rows by script. Application provenance requires logged runtime calls through the app.',
        evidence_ref: 'mistakes_board:mst_14_production_log_row_script_provenance',
        source_file: 'mistakes_board',
        date: '2026-10-09'
      },
      {
        what: 'Tavily credits rose from 226 (owner, Oct 8) to 257 (API) with no log (mst_15)',
        outcome: 'FAILED',
        cause: 'Tavily API calls executed outside the logged application runtime without include_usage tracking.',
        rule: 'Log actual credits on every Tavily call with include_usage, run daily usage sync, and flag drift >10%.',
        evidence_ref: 'mistakes_board:mst_15_tavily_credits_unlogged_rise',
        source_file: 'mistakes_board',
        date: '2026-10-09'
      },
      {
        what: 'Boilerplate "biggest risk" repeated without data (mst_16)',
        outcome: 'FAILED',
        cause: 'Risk assessment was hardcoded boilerplate without computing risk from measured data.',
        rule: 'Compute top blockers directly from open mistakes board items and money path, citing measured data and monetary impact.',
        evidence_ref: 'mistakes_board:mst_16_boilerplate_biggest_risk_repeated',
        source_file: 'mistakes_board',
        date: '2026-10-09'
      },
      {
        what: 'Category BLOCK policy: Health, skin care, supplements, medical categories blocked',
        outcome: 'FAILED',
        cause: 'High-liability and regulated categories pose commercial and legal risk.',
        rule: 'Drop categories with outcome BLOCK (health, skin care, supplements, medical).',
        evidence_ref: 'learning_records:lrn_category_policy',
        source_file: 'learning_records',
        date: '2026-10-08'
      }
    ];
  }

  /**
   * Executes history ingest into learning_records.
   * Deduplicates using content_hash.
   */
  public async ingest(): Promise<IngestResult> {
    const items = this.getCanonicalHistoryItems();
    const db = getDb();
    let inserted = 0;
    let skipped = 0;

    // Ensure default organization exists for foreign key constraint
    try {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug, created_at)
        VALUES ('org_owner_primary', 'Primary Owner Organization', 'owner-primary', datetime('now'))
      `).run();
    } catch {}

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const hash = this.computeHash(item);
      const id = `lrn_hist_${hash.substring(0, 16)}`;

      try {
        const stmt = db.prepare(`
          INSERT INTO learning_records (
            id, organization_id, learning_type, decision, hypothesis, action,
            audience, offer, channel, result, what, outcome, cause, rule,
            evidence_ref, source_file, date, content_hash, created_at
          ) VALUES (
            ?, 'org_owner_primary', 'HISTORY_INGEST', ?, ?, ?,
            'ALL', 'ALL', 'ALL', ?, ?, ?, ?, ?,
            ?, ?, ?, ?, datetime('now')
          )
          ON CONFLICT(content_hash) DO NOTHING
        `);

        const res = stmt.run(
          id,
          item.what,
          item.cause,
          item.rule,
          item.outcome,
          item.what,
          item.outcome,
          item.cause,
          item.rule,
          item.evidence_ref,
          item.source_file,
          item.date,
          hash
        );

        if (res.changes > 0) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (err: any) {
        if (err.message?.includes('UNIQUE constraint')) {
          skipped++;
        } else {
          console.warn(`[HistoryIngestService] Insert warning for '${item.what}':`, err.message);
        }
      }
    }

    // Also sync to remote D1 if configured
    const d1 = D1Client.getInstance();
    if (d1.isRemoteD1Configured()) {
      for (const item of items) {
        const hash = this.computeHash(item);
        const id = `lrn_hist_${hash.substring(0, 16)}`;
        try {
          await d1.executeQuery(
            `INSERT INTO learning_records (
              id, organization_id, learning_type, decision, hypothesis, action,
              audience, offer, channel, result, what, outcome, cause, rule,
              evidence_ref, source_file, date, content_hash, created_at
            ) VALUES (
              ?, 'org_owner_primary', 'HISTORY_INGEST', ?, ?, ?,
              'ALL', 'ALL', 'ALL', ?, ?, ?, ?, ?,
              ?, ?, ?, ?, datetime('now')
            )
            ON CONFLICT(content_hash) DO NOTHING;`,
            [
              id,
              item.what,
              item.cause,
              item.rule,
              item.outcome,
              item.what,
              item.outcome,
              item.cause,
              item.rule,
              item.evidence_ref,
              item.source_file,
              item.date,
              hash
            ],
            true,
            'P0'
          );
        } catch {}
      }
    }

    const counts = this.getRowCountsByOutcome();

    return {
      totalConsidered: items.length,
      inserted,
      skippedDuplicates: skipped,
      countsByOutcome: counts
    };
  }

  /**
   * Retrieves row counts grouped by outcome.
   */
  public getRowCountsByOutcome(): { WORKED: number; FAILED: number; UNKNOWN: number } {
    const db = getDb();
    const rows = db.prepare(`
      SELECT outcome, COUNT(*) as count
      FROM learning_records
      WHERE outcome IS NOT NULL
      GROUP BY outcome
    `).all() as Array<{ outcome: string; count: number }>;

    const result = { WORKED: 0, FAILED: 0, UNKNOWN: 0 };
    for (const r of rows) {
      if (r.outcome === 'WORKED') result.WORKED = r.count;
      else if (r.outcome === 'FAILED') result.FAILED = r.count;
      else if (r.outcome === 'UNKNOWN') result.UNKNOWN = r.count;
    }
    return result;
  }
}
