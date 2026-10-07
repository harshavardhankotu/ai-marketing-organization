import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendDist = path.resolve(rootDir, 'packages/frontend/dist');

async function main() {
  console.log('=== [PREPARE-DEPLOY] Assembling Static Distribution for Firebase Hosting ===');

  // 1. Check for published guides in production D1
  console.log('\n[1/3] Querying Cloudflare D1 for published guides...');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
  const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';
  const cfToken = process.env.CLOUDFLARE_D1_API_TOKEN;

  if (!cfToken) {
    throw new Error('CONFIG_ERROR: CLOUDFLARE_D1_API_TOKEN environment variable is required to query production D1.');
  }

  let publishedGuides = [];
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sql: "SELECT * FROM commission_content_assets WHERE status = 'PUBLISHED';"
      })
    });
    const data = await res.json();
    publishedGuides = data.result?.[0]?.results || [];
  } catch (err) {
    console.error('[PREPARE-DEPLOY] Failed to query production D1:', err.message);
    throw err;
  }

  if (!publishedGuides || publishedGuides.length === 0) {
    console.error('\n❌ [PREPARE-DEPLOY ERROR]: NO_PUBLISHED_GUIDE: No published guides found in production D1.');
    console.error('Deployment cannot proceed without at least one published commercial guide in Cloudflare D1.');
    process.exit(1);
  }

  console.log(`✓ Found ${publishedGuides.length} PUBLISHED guide(s) in production D1.`);

  // 2. Clean distribution folder to isolate public static files and exclude internal React SPA bundle
  console.log('\n[2/3] Cleaning distribution directory to exclude internal React dashboard bundle...');
  if (fs.existsSync(frontendDist)) {
    fs.rmSync(frontendDist, { recursive: true, force: true });
  }
  fs.mkdirSync(frontendDist, { recursive: true });

  // 3. Resolve public site configuration without hardcoded fixtures
  const { StaticSiteGenerator } = await import('../packages/backend/dist/commission/static-site-generator.js');
  const generator = StaticSiteGenerator.getInstance();

  console.log('\n[3/3] Rendering static landing page, guides, and legal pages...');
  const buildResult = await generator.build({
    outputDir: frontendDist
  });

  // Verify that the React dashboard app bundle is NOT present in the public distribution
  const assetsDir = path.join(frontendDist, 'assets');
  if (fs.existsSync(assetsDir)) {
    console.warn('⚠️ Found assets directory in public dist. Removing internal bundle...');
    fs.rmSync(assetsDir, { recursive: true, force: true });
  }

  console.log(`\n✓ Static site assembled successfully:`);
  console.log(`  - Target directory: ${buildResult.outputDir}`);
  console.log(`  - Guides rendered: ${buildResult.guidesRendered}`);
  console.log(`  - Total files generated: ${buildResult.filesGenerated.length}`);
  console.log(`  - Internal React dashboard SPA: EXCLUDED`);

  console.log('\n=== [PREPARE-DEPLOY] Ready for Firebase Hosting deployment ===');
  console.log('Deploy command: firebase deploy --only hosting');
}

main().catch(err => {
  console.error('\n[PREPARE-DEPLOY ERROR]:', err.message);
  process.exit(1);
});
