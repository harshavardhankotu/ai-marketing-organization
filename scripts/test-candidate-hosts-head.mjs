const HOSTS = [
  'phomemo.com',
  'www.phomemo.com',
  'everycom.in',
  'www.everycom.in',
  'tvs-e.in',
  'www.tvs-e.in',
  'tvs-electronics.com',
  'www.tvs-electronics.com',
  'zebra.com',
  'www.zebra.com',
  'epson.co.in',
  'www.epson.co.in',
  'epson.com',
  'brother.in',
  'www.brother.in'
];

async function checkHost(host) {
  const url = `https://${host}`;
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(30000),
      redirect: 'follow'
    });
    return { host, url, status: res.status, ok: res.ok, statusText: res.statusText };
  } catch (err) {
    // If HEAD is rejected with 403/405, try GET with range or catch network/SSL error
    return { host, url, status: 'ERROR', ok: false, error: err.message };
  }
}

async function run() {
  console.log('=== CANDIDATE MANUFACTURER HOSTS HTTP HEAD AUDIT ===\n');
  const results = [];
  for (const host of HOSTS) {
    const r = await checkHost(host);
    results.push(r);
    console.log(`[${r.status}] ${r.host} -> ${r.ok ? 'REACHABLE' : 'FAILED'} ${r.error ? `(${r.error})` : ''}`);
  }

  console.log('\n--- SUMMARY ---');
  const passing = results.filter(r => r.ok || (typeof r.status === 'number' && r.status < 500));
  const failing = results.filter(r => !r.ok && (typeof r.status !== 'number' || r.status >= 500));

  console.log(`Passing hosts (${passing.length}):`, passing.map(r => `${r.host} (${r.status})`));
  console.log(`Failing hosts (${failing.length}):`, failing.map(r => `${r.host} (${r.status || r.error})`));
}

run();
