#!/usr/bin/env node
/**
 * sitefix-check — SiteFix Launch Gate Zero-Install Local CLI
 *
 * Runs deterministic pre-deployment website QA LOCALLY using @ai-marketing/sitefix-core
 * (zero Render cold-start latency, zero backend scan calls burned).
 * Uses the backend API ONLY when `--unlock <orderToken>` is passed to download a paid Fix-Pack.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SiteAuditScanner,
  SiteAuditFixPackGenerator,
  SecureFetchError,
  getRecheckCheckId,
  type AuditFinding,
  type SiteAuditResult,
  type FixPackDeliverable
} from '@ai-marketing/sitefix-core';

export const DEFAULT_SITEFIX_API_URL = 'https://ai-marketing-organization.onrender.com';

export interface CliAuditFinding {
  id: string;
  category: string;
  title: string;
  status: string;
  severity: string;
  location?: string;
  evidence?: string;
  recommendation?: string;
}

export interface CliAuditResult {
  auditId: string;
  url: string;
  scannedAt?: string;
  overallStatus: string;
  score: number;
  scoreExplanation?: string;
  findings: CliAuditFinding[];
  metrics?: {
    httpStatus?: number;
    responseTimeMs?: number;
    hasRobotsTxt?: boolean;
    hasSitemap?: boolean;
    jsonLdTypesFound?: string[];
  };
  preview?: {
    title?: string;
    metaDescription?: string;
    canonicalUrl?: string;
    ogTitle?: string;
    ogImage?: string;
    fixPackSnippetPreview?: string;
  };
}

export type SiteFixSource = 'cli' | 'action' | 'web' | 'mcp';

export function normalizeSource(raw: string | undefined | null, fallback: SiteFixSource = 'cli'): SiteFixSource {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'cli' || clean === 'action' || clean === 'web' || clean === 'mcp') {
    return clean;
  }
  return fallback;
}

export interface ParsedCliArgs {
  url: string | null;
  apiUrl: string;
  source: SiteFixSource;
  confirmAuthorized: boolean;
  failOnCritical: boolean;
  json: boolean;
  summaryFile: string | null;
  unlockToken: string | null;
  outDir: string | null;
  htmlFile: string | null;
  help: boolean;
}

export function parseCliArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): ParsedCliArgs {
  let url: string | null = null;
  let apiUrl = (env.SITEFIX_API_URL || DEFAULT_SITEFIX_API_URL).replace(/\/+$/, '');
  let source: SiteFixSource = normalizeSource(env.SITEFIX_SOURCE, 'cli');
  let confirmAuthorized = String(env.SITEFIX_CONFIRM_AUTHORIZED || '').trim().toLowerCase() === 'true';
  let failOnCritical = false;
  let json = false;
  let summaryFile: string | null = null;
  let unlockToken: string | null = null;
  let outDir: string | null = null;
  let htmlFile: string | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--confirm-authorized') {
      confirmAuthorized = true;
    } else if (arg.startsWith('--confirm-authorized=')) {
      confirmAuthorized = arg.slice('--confirm-authorized='.length).trim().toLowerCase() === 'true';
    } else if (arg === '--fail-on-critical') {
      failOnCritical = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--source' && argv[i + 1]) {
      source = normalizeSource(argv[++i], 'cli');
    } else if (arg.startsWith('--source=')) {
      source = normalizeSource(arg.slice('--source='.length), 'cli');
    } else if (arg === '--api-url' && argv[i + 1]) {
      apiUrl = argv[++i].trim().replace(/\/+$/, '');
    } else if (arg.startsWith('--api-url=')) {
      apiUrl = arg.slice('--api-url='.length).trim().replace(/\/+$/, '');
    } else if (arg === '--summary-file' && argv[i + 1]) {
      summaryFile = argv[++i].trim();
    } else if (arg.startsWith('--summary-file=')) {
      summaryFile = arg.slice('--summary-file='.length).trim();
    } else if (arg === '--unlock' && argv[i + 1]) {
      unlockToken = argv[++i].trim();
    } else if (arg.startsWith('--unlock=')) {
      unlockToken = arg.slice('--unlock='.length).trim();
    } else if (arg === '--out' && argv[i + 1]) {
      outDir = argv[++i].trim();
    } else if (arg.startsWith('--out=')) {
      outDir = arg.slice('--out='.length).trim();
    } else if (arg === '--html-file' && argv[i + 1]) {
      htmlFile = argv[++i].trim();
    } else if (arg.startsWith('--html-file=')) {
      htmlFile = arg.slice('--html-file='.length).trim();
    } else if (!arg.startsWith('-') && !url) {
      url = arg.trim();
    }
  }

  return {
    url,
    apiUrl,
    source,
    confirmAuthorized,
    failOnCritical,
    json,
    summaryFile,
    unlockToken,
    outDir,
    htmlFile,
    help
  };
}

export function buildCheckoutUrl(
  targetUrl: string,
  apiUrl: string = DEFAULT_SITEFIX_API_URL,
  source: SiteFixSource = 'cli'
): string {
  const base = apiUrl.replace(/\/+$/, '');
  return `${base}/tools/site-audit?url=${encodeURIComponent(targetUrl)}&source=${encodeURIComponent(source)}`;
}

export function getCheckId(findingId: string): string {
  return getRecheckCheckId(findingId);
}

export function countCriticalDefects(findings: CliAuditFinding[]): number {
  return (findings || []).filter(
    f => String(f.status || '').toUpperCase() === 'ISSUE' && String(f.severity || '').toUpperCase() === 'CRITICAL'
  ).length;
}

export function countFailedChecks(findings: CliAuditFinding[]): number {
  return (findings || []).filter(f => {
    const st = String(f.status || '').toUpperCase();
    return st === 'ISSUE' || st === 'WARNING';
  }).length;
}

function padCell(value: string, width: number): string {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= width) return clean.padEnd(width, ' ');
  return clean.slice(0, Math.max(1, width - 1)) + '…';
}

export interface FixPackPreviewSummary {
  headMetadataPreview: string;
  missingFieldsCount: number;
  disclosure: string;
}

export function buildFixPackPreview(audit: SiteAuditResult): FixPackPreviewSummary {
  const generator = new SiteAuditFixPackGenerator();
  const pack = generator.generateFixPack(audit);
  const headLines = pack.headMetadataSnippet.split('\n').slice(0, 8).join('\n');
  return {
    headMetadataPreview: headLines,
    missingFieldsCount: pack.missingFieldsRequiringOwnerInput?.length ?? 0,
    disclosure: pack.disclosure
  };
}

export function formatAuditTable(
  result: CliAuditResult,
  apiUrl: string = DEFAULT_SITEFIX_API_URL,
  source: SiteFixSource = 'cli',
  fixPackPreview?: FixPackPreviewSummary
): string {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const criticalCount = countCriticalDefects(findings);
  const failedCount = countFailedChecks(findings);
  const checkoutUrl = buildCheckoutUrl(result.url, apiUrl, source);

  const lines: string[] = [];
  lines.push('');
  lines.push('SiteFix Launch Gate — Local Pre-Deployment Website QA');
  lines.push('='.repeat(78));
  lines.push(`URL:      ${result.url}`);
  lines.push(`Audit ID: ${result.auditId} (Execution: LOCAL — Zero Backend Latency)`);
  lines.push(`Score:    ${result.score}/100 (${result.overallStatus}) | Failed Checks: ${failedCount} | Critical: ${criticalCount}`);
  if (result.metrics) {
    lines.push(
      `Crawl:    HTTP ${result.metrics.httpStatus ?? 'N/A'} | robots.txt: ${result.metrics.hasRobotsTxt ? 'YES' : 'NO'} | sitemap.xml: ${result.metrics.hasSitemap ? 'YES' : 'NO'} | JSON-LD: ${(result.metrics.jsonLdTypesFound || []).join(', ') || 'None'}`
    );
  }
  const checkIdWidth = Math.max(28, ...findings.map(f => getCheckId(f.id).length));
  const rowWidth = Math.max(78, 8 + 3 + 8 + 3 + checkIdWidth + 3 + 26);

  lines.push('-'.repeat(rowWidth));
  lines.push(
    `${padCell('STATUS', 8)} | ${padCell('SEVERITY', 8)} | ${padCell('CHECK ID', checkIdWidth)} | ${padCell('FINDING', 26)}`
  );
  lines.push('-'.repeat(rowWidth));

  for (const f of findings) {
    lines.push(
      `${padCell(f.status, 8)} | ${padCell(f.severity, 8)} | ${padCell(getCheckId(f.id), checkIdWidth)} | ${padCell(f.title, 26)}`
    );
  }

  lines.push('-'.repeat(rowWidth));
  if (fixPackPreview?.headMetadataPreview) {
    lines.push('Fix-Pack Preview (Observed Facts Only — Unknown Fields Remain Placeholders):');
    lines.push(fixPackPreview.headMetadataPreview);
    lines.push('-'.repeat(rowWidth));
  }
  lines.push(
    `Unlock ₹499 Copy-Paste Fix-Pack (SKU: SITEFIX_AI_PACK_V1) + Included Verification Recheck:`
  );
  lines.push(`  ${checkoutUrl}`);
  lines.push(`After payment, download directly via CLI:`);
  lines.push(`  npx sitefix-check --unlock <orderToken> --out ./sitefix-pack`);
  lines.push('');
  return lines.join('\n');
}

export function formatMarkdownSummary(
  result: CliAuditResult,
  apiUrl: string = DEFAULT_SITEFIX_API_URL,
  source: SiteFixSource = 'cli',
  fixPackPreview?: FixPackPreviewSummary
): string {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const criticalCount = countCriticalDefects(findings);
  const failedCount = countFailedChecks(findings);
  const checkoutUrl = buildCheckoutUrl(result.url, apiUrl, source);
  const statusBadge =
    criticalCount > 0 ? 'FAIL (Critical Defects Found)' : failedCount > 0 ? 'WARN (Non-Critical Issues)' : 'PASS';

  const escapeMd = (v: string) => String(v || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

  const rows = findings.map(
    f =>
      `| ${escapeMd(f.status)} | ${escapeMd(f.severity)} | \`${escapeMd(getCheckId(f.id))}\` | ${escapeMd(f.title)} | ${escapeMd(f.evidence || '')} |`
  );

  const previewSection = fixPackPreview?.headMetadataPreview
    ? [
        '',
        '### Fix-Pack Preview',
        '```html',
        fixPackPreview.headMetadataPreview,
        '```'
      ]
    : [];

  return [
    `## SiteFix Launch Gate — Pre-Deployment Website QA`,
    '',
    `- **Target URL:** ${result.url}`,
    `- **Execution Mode:** Local (\`@ai-marketing/sitefix-core\`)`,
    `- **Gate Status:** **${statusBadge}**`,
    `- **Score:** \`${result.score}/100\` (${result.overallStatus})`,
    `- **Failed Checks:** \`${failedCount}\` (Critical: \`${criticalCount}\`)`,
    `- **Audit ID:** \`${result.auditId}\``,
    '',
    `| Status | Severity | Check ID | Finding | Evidence |`,
    `| --- | --- | --- | --- | --- |`,
    ...rows,
    ...previewSection,
    '',
    `### Fix All Defects + Verify Post-Deploy`,
    `Unlock the deterministic copy-paste **₹499 SiteFix Fix-Pack** (\`SITEFIX_AI_PACK_V1\`) + **included post-fix verification recheck**:`,
    `${checkoutUrl}`,
    ''
  ].join('\n');
}

export interface RunSitefixCheckResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  audit?: CliAuditResult;
  fixPackPreview?: FixPackPreviewSummary;
  unlockedDeliverable?: FixPackDeliverable;
  criticalCount: number;
  failedChecks: number;
  checkoutUrl?: string;
}

export const AUTHORIZATION_REQUIRED_MESSAGE =
  'Authorization required: pass --confirm-authorized to confirm you own or are authorized to audit the target URL.';

async function handleUnlockFixPack(
  parsed: ParsedCliArgs,
  fetchImpl: typeof fetch
): Promise<RunSitefixCheckResult> {
  const token = String(parsed.unlockToken || '').trim();
  if (!token) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: 'Missing order token for --unlock.\n',
      criticalCount: 0,
      failedChecks: 0
    };
  }

  const endpoint = `${parsed.apiUrl}/api/v1/offer/download/${encodeURIComponent(token)}`;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': parsed.source === 'action' ? 'sitefix-launch-gate-action/1.0.0' : 'sitefix-check-cli/1.0.0',
        'X-SiteFix-Source': parsed.source
      }
    });
  } catch (err: any) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Failed to reach SiteFix unlock endpoint (${endpoint}): ${err?.message || String(err)}\n`,
      criticalCount: 0,
      failedChecks: 0
    };
  }

  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok || !payload?.success || !payload?.deliverable) {
    const errMsg = payload?.error || `HTTP ${response.status}`;
    return {
      exitCode: 2,
      stdout: '',
      stderr: `SiteFix unlock failed (${response.status}): ${errMsg}\n`,
      criticalCount: 0,
      failedChecks: 0
    };
  }

  const deliverable = payload.deliverable as FixPackDeliverable;

  if (parsed.outDir) {
    fs.mkdirSync(parsed.outDir, { recursive: true });
    fs.writeFileSync(path.join(parsed.outDir, 'head-metadata.html'), deliverable.headMetadataSnippet || '', 'utf8');
    fs.writeFileSync(path.join(parsed.outDir, 'open-graph.html'), deliverable.openGraphSnippet || '', 'utf8');
    fs.writeFileSync(path.join(parsed.outDir, 'twitter-card.html'), deliverable.twitterCardSnippet || '', 'utf8');
    fs.writeFileSync(path.join(parsed.outDir, 'schema-jsonld.html'), deliverable.schemaJsonLdSnippet || '', 'utf8');
    if (deliverable.robotsTxtSnippet) {
      fs.writeFileSync(path.join(parsed.outDir, 'robots.txt'), deliverable.robotsTxtSnippet, 'utf8');
    }
    if (deliverable.sitemapXmlSnippet) {
      fs.writeFileSync(path.join(parsed.outDir, 'sitemap.xml'), deliverable.sitemapXmlSnippet, 'utf8');
    }
    fs.writeFileSync(path.join(parsed.outDir, 'checklist.md'), deliverable.checklistMarkdown || '', 'utf8');
    fs.writeFileSync(path.join(parsed.outDir, 'fix-pack.json'), JSON.stringify(deliverable, null, 2), 'utf8');
  }

  const stdout = parsed.json
    ? JSON.stringify({ success: true, outDir: parsed.outDir, deliverable }, null, 2) + '\n'
    : [
        '',
        'SiteFix Paid Fix-Pack Unlocked (SKU: SITEFIX_AI_PACK_V1)',
        '='.repeat(78),
        `Target URL: ${deliverable.targetUrl}`,
        `Audit ID:   ${deliverable.auditId}`,
        parsed.outDir ? `Written to: ${path.resolve(parsed.outDir)}` : 'Output:     stdout (pass --out <dir> to write files)',
        '',
        deliverable.headMetadataSnippet,
        '',
        deliverable.openGraphSnippet,
        '',
        deliverable.schemaJsonLdSnippet,
        ''
      ].join('\n');

  return {
    exitCode: 0,
    stdout,
    stderr: '',
    unlockedDeliverable: deliverable,
    criticalCount: 0,
    failedChecks: 0
  };
}

export async function runSitefixCheck(
  argv: string[],
  fetchImpl?: typeof fetch,
  env: Record<string, string | undefined> = process.env
): Promise<RunSitefixCheckResult> {
  const parsed = parseCliArgs(argv, env);

  if (parsed.help || (!parsed.url && !parsed.unlockToken)) {
    const usage = [
      'Usage:',
      '  npx sitefix-check <url> --confirm-authorized [--source cli|action] [--fail-on-critical] [--json] [--summary-file <path>]',
      '  npx sitefix-check --unlock <orderToken> [--out <dir>] [--api-url <url>] [--json]',
      '',
      'Local Zero-Latency Execution:',
      '  Scans execute locally using @ai-marketing/sitefix-core (zero Render cold starts).',
      '  Backend API is contacted ONLY when --unlock <orderToken> is used after payment.',
      '',
      'Required (for scans):',
      '  --confirm-authorized Confirm you own or are authorized to audit the target URL (or set SITEFIX_CONFIRM_AUTHORIZED=true)',
      '',
      'Options:',
      '  --source <src>       Attribution source for checkout link: cli | action | web | mcp (default: cli)',
      '  --fail-on-critical   Exit with code 1 if any CRITICAL defect is detected',
      '  --html-file <path>   Scan a local pre-deploy HTML file against the canonical target <url>',
      '  --unlock <token>     Download a paid ₹499 Fix-Pack using your verified delivery token',
      '  --out <dir>          Write unlocked Fix-Pack snippets & checklist files to <dir>',
      `  --api-url <url>      Override SiteFix base URL for checkout & --unlock (default: ${DEFAULT_SITEFIX_API_URL})`,
      '  --json               Print structured JSON report to stdout',
      '  --summary-file <p>   Append Markdown pass/fail report (e.g. $GITHUB_STEP_SUMMARY)',
      '  -h, --help           Show help'
    ].join('\n');
    return {
      exitCode: parsed.help ? 0 : 2,
      stdout: parsed.help ? usage + '\n' : '',
      stderr: parsed.help ? '' : usage + '\n',
      criticalCount: 0,
      failedChecks: 0
    };
  }

  // Paid Fix-Pack download mode (ONLY path that calls backend API)
  if (parsed.unlockToken) {
    return handleUnlockFixPack(parsed, fetchImpl ?? fetch);
  }

  if (!parsed.confirmAuthorized) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${AUTHORIZATION_REQUIRED_MESSAGE}\n`,
      criticalCount: 0,
      failedChecks: 0
    };
  }

  let normalizedUrl = parsed.url!;
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  let audit: SiteAuditResult;
  try {
    const scanner = new SiteAuditScanner({
      fetchImpl,
      skipDnsForInjectedFetch: Boolean(fetchImpl),
      defaultFetchOptions: {
        timeoutMs: 5000,
        maxSizeBytes: 1024 * 1024,
        userAgent:
          parsed.source === 'action'
            ? 'sitefix-launch-gate-action/1.0.0 (+https://ai-marketing-organization.onrender.com/tools/site-audit)'
            : 'sitefix-check-cli/1.0.0 (+https://ai-marketing-organization.onrender.com/tools/site-audit)'
      }
    });

    if (parsed.htmlFile) {
      const htmlBody = fs.readFileSync(parsed.htmlFile, 'utf8');
      audit = await scanner.scanUrl(
        {
          url: normalizedUrl,
          websiteType: 'DEVELOPER_LAUNCH_QA',
          userConfirmedOwnership: true
        },
        {
          url: normalizedUrl,
          finalUrl: normalizedUrl,
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: htmlBody,
          timingMs: 1,
          bytesReceived: Buffer.byteLength(htmlBody, 'utf8'),
          contentType: 'text/html; charset=utf-8',
          redirectChain: [normalizedUrl]
        }
      );
    } else {
      audit = await scanner.scanUrl({
        url: normalizedUrl,
        websiteType: 'DEVELOPER_LAUNCH_QA',
        userConfirmedOwnership: true
      });
    }
  } catch (err: any) {
    const message =
      err instanceof SecureFetchError ? `${err.code}: ${err.message}` : err?.message || String(err);
    return {
      exitCode: 2,
      stdout: '',
      stderr: `SiteFix local scan failed: ${message}\n`,
      criticalCount: 0,
      failedChecks: 0
    };
  }

  const fixPackPreview = buildFixPackPreview(audit);
  const criticalCount = countCriticalDefects(audit.findings);
  const failedChecks = countFailedChecks(audit.findings);
  const checkoutUrl = buildCheckoutUrl(audit.url || normalizedUrl, parsed.apiUrl, parsed.source);

  if (parsed.summaryFile) {
    const md = formatMarkdownSummary(audit, parsed.apiUrl, parsed.source, fixPackPreview);
    fs.appendFileSync(parsed.summaryFile, md, 'utf8');
  }

  const stdout = parsed.json
    ? JSON.stringify(
        {
          auditId: audit.auditId,
          url: audit.url,
          executionMode: 'LOCAL',
          source: parsed.source,
          score: audit.score,
          overallStatus: audit.overallStatus,
          failedChecks,
          criticalCount,
          canonicalSku: 'SITEFIX_AI_PACK_V1',
          checkoutUrl,
          fixPackPreview,
          findings: audit.findings.map((f: AuditFinding) => ({ ...f, checkId: getCheckId(f.id) }))
        },
        null,
        2
      ) + '\n'
    : formatAuditTable(audit, parsed.apiUrl, parsed.source, fixPackPreview);

  const exitCode = parsed.failOnCritical && criticalCount > 0 ? 1 : 0;

  return {
    exitCode,
    stdout,
    stderr: exitCode === 1 ? `SiteFix Launch Gate failed: ${criticalCount} CRITICAL defect(s) found.\n` : '',
    audit,
    fixPackPreview,
    criticalCount,
    failedChecks,
    checkoutUrl
  };
}

function isInvokedDirectly(): boolean {
  if (typeof process === 'undefined' || !Array.isArray(process.argv) || !process.argv[1]) {
    return false;
  }
  try {
    const resolvedArgv = fs.realpathSync(process.argv[1]);
    return import.meta.url === pathToFileURL(resolvedArgv).href;
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  }
}

if (isInvokedDirectly()) {
  runSitefixCheck(process.argv.slice(2))
    .then(res => {
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
      process.exit(res.exitCode);
    })
    .catch(err => {
      process.stderr.write(`Fatal sitefix-check error: ${err?.message || String(err)}\n`);
      process.exit(2);
    });
}
