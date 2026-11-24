/**
 * Static Owner Tool Page Emitter (Pass 2 — Task 3)
 *
 * Writes the 4 owner-facing diagnostic pages into:
 * 1. packages/frontend/dist/tools/<slug>/index.html  (Firebase Hosting deploy directory per firebase.json)
 * 2. public/tools/<slug>/index.html                  (static public directory)
 *
 * Uses the compiled backend template module as the single source of truth so static and SSR HTML stay synced.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function main() {
  const compiledModulePath = path.resolve(
    repoRoot,
    'packages/backend/dist/tools/site-audit/owner-tool-pages.js'
  );
  const compiledSiteAuditPath = path.resolve(
    repoRoot,
    'packages/backend/dist/tools/site-audit/site-audit-page.js'
  );

  if (!fs.existsSync(compiledModulePath)) {
    console.error(
      `[build-static-owner-tools] Missing compiled template module: ${compiledModulePath}. Run backend build first.`
    );
    process.exit(1);
  }

  const mod = await import(pathToFileURL(compiledModulePath).href);
  const { OWNER_TOOL_SLUGS, renderOwnerToolPage } = mod;

  let renderSiteAuditPage = null;
  if (fs.existsSync(compiledSiteAuditPath)) {
    const siteAuditMod = await import(pathToFileURL(compiledSiteAuditPath).href);
    renderSiteAuditPage = siteAuditMod.renderSiteAuditPage;
  }

  const apiBaseUrl = (
    process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com'
  )
    .trim()
    .replace(/\/+$/, '');
  const razorpayFallbackUrl = (process.env.RAZORPAY_HOSTED_PAYMENT_LINK_URL || '').trim() || null;

  const targetRoots = [
    path.resolve(repoRoot, 'packages/frontend/dist/tools'),
    path.resolve(repoRoot, 'public/tools')
  ];

  let emittedCount = 0;
  for (const targetRoot of targetRoots) {
    if (renderSiteAuditPage) {
      const siteAuditDir = path.join(targetRoot, 'site-audit');
      fs.mkdirSync(siteAuditDir, { recursive: true });
      const siteAuditHtml = renderSiteAuditPage();
      fs.writeFileSync(path.join(siteAuditDir, 'index.html'), siteAuditHtml, 'utf8');
      emittedCount++;
    }

    for (const slug of OWNER_TOOL_SLUGS) {
      const outDir = path.join(targetRoot, slug);
      fs.mkdirSync(outDir, { recursive: true });
      const html = renderOwnerToolPage(slug, {
        apiBaseUrl,
        canonicalOrigin: apiBaseUrl,
        razorpayFallbackUrl
      });
      const outFile = path.join(outDir, 'index.html');
      fs.writeFileSync(outFile, html, 'utf8');
      emittedCount++;
    }
  }

  console.log(
    `[build-static-owner-tools] Emitted ${emittedCount} static HTML files across packages/frontend/dist/tools/* and public/tools/*.`
  );
}

main().catch((err) => {
  console.error('[build-static-owner-tools] Failed:', err);
  process.exit(1);
});
