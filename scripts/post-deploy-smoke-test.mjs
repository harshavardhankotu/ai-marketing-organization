import fs from 'fs';

const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://gen-lang-client-0916255372.web.app').replace(/\/$/, '');

export async function runSmokeTest(targetUrl = siteUrl, fetchFn = fetch) {
  console.log(`=== POST-DEPLOY SMOKE TEST: ${targetUrl} ===`);
  const results = {
    robotsOk: false,
    sitemapOk: false,
    catalogOk: false,
    disclosurePresent: false
  };

  // 1. Verify robots.txt
  console.log('1. Checking robots.txt...');
  try {
    const res = await fetchFn(`${targetUrl}/robots.txt`);
    results.robotsOk = res.ok;
    console.log(res.ok ? '✓ robots.txt available' : `! robots.txt returned HTTP ${res.status}`);
  } catch (e) {
    console.warn(`! robots.txt fetch notice: ${e.message}`);
  }

  // 2. Verify sitemap.xml
  console.log('2. Checking sitemap.xml...');
  try {
    const res = await fetchFn(`${targetUrl}/sitemap.xml`);
    results.sitemapOk = res.ok;
    console.log(res.ok ? '✓ sitemap.xml available' : `! sitemap.xml returned HTTP ${res.status}`);
  } catch (e) {
    console.warn(`! sitemap.xml fetch notice: ${e.message}`);
  }

  // 3. Verify public catalog & affiliate disclosure
  console.log('3. Checking guide catalog & affiliate disclosure...');
  try {
    const res = await fetchFn(`${targetUrl}/guides/index.html`);
    if (res.ok) {
      results.catalogOk = true;
      const html = await res.text();
      results.disclosurePresent = html.includes('affiliate') || html.includes('commission');
      console.log(`✓ Guide catalog loaded (Affiliate disclosure present: ${results.disclosurePresent})`);
    } else {
      console.warn(`! Guide catalog returned HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`! Guide catalog fetch notice: ${e.message}`);
  }

  console.log('=== SMOKE TEST COMPLETE ===');
  return results;
}

if (process.argv[1] && process.argv[1].endsWith('post-deploy-smoke-test.mjs')) {
  runSmokeTest().catch(err => {
    console.error('Smoke test execution notice:', err.message);
  });
}
