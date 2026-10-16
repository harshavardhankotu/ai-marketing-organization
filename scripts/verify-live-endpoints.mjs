async function check(url, name) {
  console.log(`\n======================================================`);
  console.log(`RAW LIVE CHECK: ${name} (${url})`);
  console.log(`------------------------------------------------------`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s max timeout
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    console.log(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(text.substring(0, 1000));
    }
  } catch (err) {
    console.error(`ERROR fetching ${url}: ${err.message}`);
  }
}

async function main() {
  const base = 'https://ai-marketing-organization.onrender.com';
  await check(`${base}/api/v1/health`, 'GET /api/v1/health');
  await check(`${base}/owner/facts-status`, 'GET /owner/facts-status');
  await check(`${base}/api/v1/commission/funnel`, 'GET /api/v1/commission/funnel');
  await check(`${base}/owner/today`, 'GET /owner/today');
  await check(`${base}/offer`, 'GET /offer');
  await check(`${base}/api/v1/agents/divisions`, 'GET /api/v1/agents/divisions');
}

main().catch(err => console.error(err));
