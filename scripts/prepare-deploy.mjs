import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendDist = path.resolve(rootDir, 'packages/frontend/dist');

async function main() {
  console.log('=== [PREPARE-DEPLOY] Assembling Unified Static + React Distribution ===');

  // 1. Build Frontend React Bundle
  console.log('\n[1/3] Building Frontend React SPA bundle via Vite...');
  execSync('npm run build --workspace=packages/frontend', {
    cwd: rootDir,
    stdio: 'inherit'
  });

  if (!fs.existsSync(frontendDist)) {
    throw new Error(`Frontend build did not create ${frontendDist}`);
  }
  console.log(`✓ Frontend React bundle built at ${frontendDist}`);

  // 2. Set Public Site Variables (from environment or non-secret public values)
  process.env.PUBLIC_SITE_NAME = process.env.PUBLIC_SITE_NAME || 'India Commercial Review';
  process.env.PUBLIC_AUTHOR_NAME = process.env.PUBLIC_AUTHOR_NAME || 'Editorial Review Staff';
  process.env.PUBLIC_CONTACT_EMAIL = process.env.PUBLIC_CONTACT_EMAIL || 'editorial@ai-marketing-platform-core.web.app';
  process.env.PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || 'https://ai-marketing-platform-core.web.app';

  // 3. Run Static Site Generator to output HTML guides, legal pages, robots, sitemap
  console.log('\n[2/3] Rendering static guides and legal pages into distribution folder...');
  const { StaticSiteGenerator } = await import('../packages/backend/dist/commission/static-site-generator.js');
  const generator = StaticSiteGenerator.getInstance();

  const buildResult = await generator.build({
    outputDir: frontendDist
  });

  console.log(`✓ Static site generated successfully:`);
  console.log(`  - Target directory: ${buildResult.outputDir}`);
  console.log(`  - Guides rendered: ${buildResult.guidesRendered}`);
  console.log(`  - Total files generated: ${buildResult.filesGenerated.length}`);

  // 4. Verify Assembled Bundle
  console.log('\n[3/3] Verifying assembled distribution contents:');
  const expectedEntries = [
    'index.html',
    'sitemap.xml',
    'robots.txt',
    'about/index.html',
    'contact/index.html',
    'privacy/index.html',
    'terms/index.html',
    'disclosure/index.html'
  ];

  for (const entry of expectedEntries) {
    const fullPath = path.join(frontendDist, entry);
    if (!fs.existsSync(fullPath)) {
      console.warn(`  [MISSING] ${entry}`);
    } else {
      console.log(`  [OK] ${entry}`);
    }
  }

  console.log('\n=== [PREPARE-DEPLOY] Ready for Firebase Hosting deployment ===');
}

main().catch(err => {
  console.error('\n[PREPARE-DEPLOY ERROR]:', err.message);
  process.exit(1);
});
