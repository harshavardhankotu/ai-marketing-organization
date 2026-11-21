#!/usr/bin/env node
/**
 * sitefix-check — SiteFix Launch Gate Zero-Install CLI
 * Calls POST <apiUrl>/api/v1/tools/site-audit/scan to run deterministic pre-deployment QA
 * (HTML metadata, Open Graph, Schema.org JSON-LD, robots.txt, sitemap.xml).
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
}

export interface ParsedCliArgs {
  url: string | null;
  apiUrl: string;
  confirmAuthorized: boolean;
  failOnCritical: boolean;
  json: boolean;
  summaryFile: string | null;
  help: boolean;
}

export function parseCliArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): ParsedCliArgs {
  let url: string | null = null;
  let apiUrl = (env.SITEFIX_API_URL || DEFAULT_SITEFIX_API_URL).replace(/\/+$/, '');
  let confirmAuthorized = String(env.SITEFIX_CONFIRM_AUTHORIZED || '').trim().toLowerCase() === 'true';
  let failOnCritical = false;
  let json = false;
  let summaryFile: string | null = null;
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
    } else if (arg === '--api-url' && argv[i + 1]) {
      apiUrl = argv[++i].trim().replace(/\/+$/, '');
    } else if (arg.startsWith('--api-url=')) {
      apiUrl = arg.slice('--api-url='.length).trim().replace(/\/+$/, '');
    } else if (arg === '--summary-file' && argv[i + 1]) {
      summaryFile = argv[++i].trim();
    } else if (arg.startsWith('--summary-file=')) {
      summaryFile = arg.slice('--summary-file='.length).trim();
    } else if (!arg.startsWith('-') && !url) {
      url = arg.trim();
    }
  }

  return { url, apiUrl, confirmAuthorized, failOnCritical, json, summaryFile, help };
}

export function buildCheckoutUrl(targetUrl: string, apiUrl: string = DEFAULT_SITEFIX_API_URL): string {
  const base = apiUrl.replace(/\/+$/, '');
  return `${base}/tools/site-audit?url=${encodeURIComponent(targetUrl)}`;
}

export function getCheckId(findingId: string): string {
  const clean = String(findingId || '').trim();
  if (!clean) return 'check_unknown';
  return clean.startsWith('check_') ? clean : `check_${clean}`;
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

export function formatAuditTable(result: CliAuditResult, apiUrl: string = DEFAULT_SITEFIX_API_URL): string {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const criticalCount = countCriticalDefects(findings);
  const failedCount = countFailedChecks(findings);
  const checkoutUrl = buildCheckoutUrl(result.url, apiUrl);

  const lines: string[] = [];
  lines.push('');
  lines.push('SiteFix Launch Gate — Pre-Deployment Website QA');
  lines.push('='.repeat(78));
  lines.push(`URL:      ${result.url}`);
  lines.push(`Audit ID: ${result.auditId}`);
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
  lines.push(
    `Unlock ₹499 Copy-Paste Fix-Pack (SKU: SITEFIX_AI_PACK_V1) + Included Verification Recheck:`
  );
  lines.push(`  ${checkoutUrl}`);
  lines.push('');
  return lines.join('\n');
}

export function formatMarkdownSummary(result: CliAuditResult, apiUrl: string = DEFAULT_SITEFIX_API_URL): string {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const criticalCount = countCriticalDefects(findings);
  const failedCount = countFailedChecks(findings);
  const checkoutUrl = buildCheckoutUrl(result.url, apiUrl);
  const statusBadge = criticalCount > 0 ? 'FAIL (Critical Defects Found)' : failedCount > 0 ? 'WARN (Non-Critical Issues)' : 'PASS';

  const escapeMd = (v: string) => String(v || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

  const rows = findings.map(
    f =>
      `| ${escapeMd(f.status)} | ${escapeMd(f.severity)} | \`${escapeMd(getCheckId(f.id))}\` | ${escapeMd(f.title)} | ${escapeMd(f.evidence || '')} |`
  );

  return [
    `## SiteFix Launch Gate — Pre-Deployment Website QA`,
    '',
    `- **Target URL:** ${result.url}`,
    `- **Gate Status:** **${statusBadge}**`,
    `- **Score:** \`${result.score}/100\` (${result.overallStatus})`,
    `- **Failed Checks:** \`${failedCount}\` (Critical: \`${criticalCount}\`)`,
    `- **Audit ID:** \`${result.auditId}\``,
    '',
    `| Status | Severity | Check ID | Finding | Evidence |`,
    `| --- | --- | --- | --- | --- |`,
    ...rows,
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
  criticalCount: number;
  failedChecks: number;
  checkoutUrl?: string;
}

export const AUTHORIZATION_REQUIRED_MESSAGE =
  'Authorization required: pass --confirm-authorized to confirm you own or are authorized to audit the target URL.';

export async function runSitefixCheck(
  argv: string[],
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env
): Promise<RunSitefixCheckResult> {
  const parsed = parseCliArgs(argv, env);

  if (parsed.help || !parsed.url) {
    const usage = [
      'Usage: npx sitefix-check <url> --confirm-authorized [--fail-on-critical] [--api-url <url>] [--json] [--summary-file <path>]',
      '',
      'Required:',
      '  --confirm-authorized Confirm you own or are authorized to audit the target URL (or set SITEFIX_CONFIRM_AUTHORIZED=true)',
      '',
      'Options:',
      '  --fail-on-critical   Exit with code 1 if any CRITICAL defect is detected',
      `  --api-url <url>      Override API base URL (default: ${DEFAULT_SITEFIX_API_URL})`,
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

  if (!parsed.confirmAuthorized) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${AUTHORIZATION_REQUIRED_MESSAGE}\n`,
      criticalCount: 0,
      failedChecks: 0
    };
  }

  let normalizedUrl = parsed.url;
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const endpoint = `${parsed.apiUrl}/api/v1/tools/site-audit/scan`;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'sitefix-check-cli/1.0.0'
      },
      body: JSON.stringify({
        url: normalizedUrl,
        websiteType: 'DEVELOPER_LAUNCH_QA',
        userConfirmedOwnership: parsed.confirmAuthorized
      })
    });
  } catch (err: any) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `SiteFix API request failed (${endpoint}): ${err?.message || String(err)}\n`,
      criticalCount: 0,
      failedChecks: 0
    };
  }

  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok || !payload?.success || !payload?.result) {
    const errMsg = payload?.error || `HTTP ${response.status}`;
    return {
      exitCode: 2,
      stdout: '',
      stderr: `SiteFix scan failed: ${errMsg}\n`,
      criticalCount: 0,
      failedChecks: 0
    };
  }

  const audit: CliAuditResult = payload.result;
  const criticalCount = countCriticalDefects(audit.findings);
  const failedChecks = countFailedChecks(audit.findings);
  const checkoutUrl = buildCheckoutUrl(audit.url || normalizedUrl, parsed.apiUrl);

  if (parsed.summaryFile) {
    const md = formatMarkdownSummary(audit, parsed.apiUrl);
    fs.appendFileSync(parsed.summaryFile, md, 'utf8');
  }

  const stdout = parsed.json
    ? JSON.stringify(
        {
          auditId: audit.auditId,
          url: audit.url,
          score: audit.score,
          overallStatus: audit.overallStatus,
          failedChecks,
          criticalCount,
          canonicalSku: 'SITEFIX_AI_PACK_V1',
          checkoutUrl,
          findings: audit.findings.map(f => ({ ...f, checkId: getCheckId(f.id) }))
        },
        null,
        2
      ) + '\n'
    : formatAuditTable(audit, parsed.apiUrl);

  const exitCode = parsed.failOnCritical && criticalCount > 0 ? 1 : 0;

  return {
    exitCode,
    stdout,
    stderr: exitCode === 1 ? `SiteFix Launch Gate failed: ${criticalCount} CRITICAL defect(s) found.\n` : '',
    audit,
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
