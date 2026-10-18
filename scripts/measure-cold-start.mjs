async function measure() {
  console.log('=== MEASURING COLD START (3 GET REQUESTS, 30s TIMEOUT) ===');
  for (let i = 1; i <= 3; i++) {
    const start = Date.now();
    try {
      const res = await fetch('https://ai-marketing-organization.onrender.com/api/health', {
        signal: AbortSignal.timeout(30000)
      });
      const elapsed = Date.now() - start;
      const data = await res.json().catch(() => ({}));
      console.log(`Request #${i}: HTTP ${res.status}, Elapsed: ${elapsed}ms, Payload: ${JSON.stringify(data)}`);
    } catch (err) {
      const elapsed = Date.now() - start;
      console.log(`Request #${i}: Error after ${elapsed}ms: ${err.message}`);
    }
    if (i < 3) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

measure();
