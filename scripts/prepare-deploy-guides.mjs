import fs from 'fs';
import path from 'path';

export async function prepareDeployGuides(options = {}) {
  const fetchFn = options.fetchFn || fetch;
  const isDryRun = Boolean(options.dryRun);

  console.log('=== PREPARE DEPLOY GUIDES ===');

  let publishedGuides = [];

  // Query D1 for published guides
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

  if (cfToken && accountId) {
    try {
      const res = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sql: "SELECT id, title, slug, content_markdown as body, created_at FROM commission_content_assets WHERE status = 'PUBLISHED' ORDER BY created_at DESC;"
        })
      });
      const data = await res.json();
      if (data.success && data.result?.[0]?.results) {
        publishedGuides = data.result[0].results;
      }
    } catch (err) {
      console.warn('Could not query remote D1:', err.message);
    }
  }

  // If in dryRun and no guides found, options may supply fixture
  if (publishedGuides.length === 0 && options.mockGuides) {
    publishedGuides = options.mockGuides;
  }

  // Rule: Must fail with NO_PUBLISHED_GUIDE when none exist
  if (publishedGuides.length === 0) {
    throw new Error('NO_PUBLISHED_GUIDE: Zero published guides found in database. Deployment halted.');
  }

  console.log(`Found ${publishedGuides.length} PUBLISHED guide(s).`);

  const publicDir = path.resolve('public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // Step 4d: IndexNow key file
  const indexNowKey = process.env.INDEXNOW_KEY || 'indexnow-key-38f9d0c2';
  fs.writeFileSync(path.join(publicDir, `${indexNowKey}.txt`), indexNowKey, 'utf8');

  // Step 4e: Google Search Console verification meta tag
  const gscVerification = process.env.GOOGLE_SITE_VERIFICATION?.trim() || '';
  const gscMetaTag = gscVerification ? `<meta name="google-site-verification" content="${gscVerification}" />\n` : '';

  // Generate static index.html
  const guideLinks = publishedGuides.map(g => `<li><a href="/guides/${g.slug}.html">${g.title}</a></li>`).join('\n');
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${gscMetaTag}  <title>Objective Product Buyer Guides</title>
</head>
<body>
  <h1>Objective Product Buyer Guides</h1>
  <p>Disclosure: As an Amazon Associate I earn from qualifying purchases. This catalog contains affiliate search links.</p>
  <ul>
    ${guideLinks}
  </ul>
</body>
</html>`;

  fs.writeFileSync(path.join(publicDir, 'index.html'), indexHtml, 'utf8');

  // Generate guide pages
  const guidesDir = path.join(publicDir, 'guides');
  if (!fs.existsSync(guidesDir)) {
    fs.mkdirSync(guidesDir, { recursive: true });
  }

  for (const g of publishedGuides) {
    const guideHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${gscMetaTag}  <title>${g.title}</title>
</head>
<body>
  <div class="guide-content">
    ${g.body || g.title}
  </div>
</body>
</html>`;
    fs.writeFileSync(path.join(guidesDir, `${g.slug}.html`), guideHtml, 'utf8');
  }

  // Generate sitemap.xml
  const siteUrl = process.env.PUBLIC_SITE_URL || 'https://aimarketing.org';
  const urls = [
    `${siteUrl}/`,
    ...publishedGuides.map(g => `${siteUrl}/guides/${g.slug}.html`)
  ];

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.map(u => `<url><loc>${u}</loc></url>`).join('\n  ')}
</urlset>`;
  fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), sitemapXml, 'utf8');

  // Step 4d: IndexNow submission payload
  const host = new URL(siteUrl).host;
  const indexNowPayload = {
    host,
    key: indexNowKey,
    keyLocation: `${siteUrl}/${indexNowKey}.txt`,
    urlList: urls
  };

  if (isDryRun) {
    console.log('[DRY RUN] Deploy command: npx firebase deploy --only hosting');
    console.log('[DRY RUN] IndexNow payload:', JSON.stringify(indexNowPayload, null, 2));
  }

  return {
    publishedCount: publishedGuides.length,
    indexNowPayload,
    sitemapUrls: urls
  };
}

if (process.argv[1] && process.argv[1].endsWith('prepare-deploy-guides.mjs')) {
  prepareDeployGuides({ dryRun: process.argv.includes('--dry-run') }).catch(err => {
    console.error(`❌ PREPARE DEPLOY FAILED: ${err.message}`);
    process.exit(1);
  });
}
