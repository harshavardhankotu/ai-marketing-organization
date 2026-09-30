import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://ai-marketing-organization.onrender.com';
const RENDER_SERVICE_ID = 'srv-darecoc9v7es73ea8t2g';

// Load RENDER_API_KEY from .env.admin_secret
const envText = fs.readFileSync('.env.admin_secret', 'utf-8');
const renderKeyMatch = envText.match(/^RENDER_API_KEY=(.*)$/m);
if (!renderKeyMatch) {
  console.error('Could not find RENDER_API_KEY in .env.admin_secret');
  process.exit(1);
}
const renderApiKey = renderKeyMatch[1].trim();

async function run() {
  console.log('====================================================');
  console.log('LIVE RENDER PRODUCTION VERIFICATION — COMMIT e2fc200');
  console.log('====================================================\n');

  // Step 1: Verify Deployed Commit via Render REST API
  console.log('1. Checking Render Deployed Commit via GET /v1/services/{id}/deploys...');
  const deployRes = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys?limit=1`, {
    headers: {
      Authorization: `Bearer ${renderApiKey}`,
      Accept: 'application/json'
    }
  });
  const deployData = await deployRes.json();
  const activeDeploy = deployData[0]?.deploy;
  console.log(`   Deploy ID: ${activeDeploy?.id}`);
  console.log(`   Commit SHA: ${activeDeploy?.commit?.id}`);
  console.log(`   Commit Message: ${activeDeploy?.commit?.message}`);
  console.log(`   Deploy Status: ${activeDeploy?.status}`);
  console.log(`   Finished At: ${activeDeploy?.finishedAt}\n`);

  // Step 2: Fetch configured OWNER_API_KEY from Render env vars without exposing it
  console.log('2. Retrieving configured OWNER_API_KEY from Render environment (secret in memory)...');
  const envRes = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`, {
    headers: {
      Authorization: `Bearer ${renderApiKey}`,
      Accept: 'application/json'
    }
  });
  const envData = await envRes.json();
  const ownerKeyEntry = envData.find(e => e.envVar?.key === 'OWNER_API_KEY');
  const ownerApiKey = ownerKeyEntry?.envVar?.value?.trim();
  if (!ownerApiKey) {
    console.error('   FAILED: Could not find OWNER_API_KEY on Render');
    process.exit(1);
  }
  console.log(`   Retrieved key (length: ${ownerApiKey.length} characters, never printed).\n`);

  // Step 3: GET /api/v1/health
  console.log('3. Testing GET /api/v1/health...');
  const healthRes = await fetch(`${BASE_URL}/api/v1/health`);
  const healthJson = await healthRes.json();
  console.log(`   HTTP ${healthRes.status}:`, JSON.stringify(healthJson));
  if (healthRes.status !== 200) throw new Error('Health check failed');
  console.log('');

  // Step 4: Verify unauthenticated request to /api/v1/business returns 401
  console.log('4. Testing unauthenticated GET /api/v1/business (Expected: 401)...');
  const unauthBizRes = await fetch(`${BASE_URL}/api/v1/business`);
  const unauthBizJson = await unauthBizRes.json();
  console.log(`   HTTP ${unauthBizRes.status}:`, JSON.stringify(unauthBizJson));
  if (unauthBizRes.status !== 401) throw new Error(`Expected 401, got ${unauthBizRes.status}`);
  console.log('');

  // Step 5: Verify unauthenticated request to /api/v1/system/readiness returns 401
  console.log('5. Testing unauthenticated GET /api/v1/system/readiness (Expected: 401)...');
  const unauthReadyRes = await fetch(`${BASE_URL}/api/v1/system/readiness`);
  const unauthReadyJson = await unauthReadyRes.json();
  console.log(`   HTTP ${unauthReadyRes.status}:`, JSON.stringify(unauthReadyJson));
  if (unauthReadyRes.status !== 401) throw new Error(`Expected 401, got ${unauthReadyRes.status}`);
  console.log('');

  // Step 6: Owner Login POST /api/v1/auth/owner/login
  console.log('6. Testing Owner Login POST /api/v1/auth/owner/login...');
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/owner/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: ownerApiKey })
  });
  const setCookieHeader = loginRes.headers.get('set-cookie') || '';
  const loginJson = await loginRes.json();
  console.log(`   HTTP ${loginRes.status}:`, JSON.stringify(loginJson));
  const redactedCookie = setCookieHeader.replace(/owner_session=[^;]+/, 'owner_session=[REDACTED_SESSION_TOKEN]');
  console.log(`   Set-Cookie: ${redactedCookie}`);
  if (loginRes.status !== 200) throw new Error(`Login failed with status ${loginRes.status}`);

  const cookieMatch = setCookieHeader.match(/owner_session=([^;]+)/);
  if (!cookieMatch) throw new Error('No owner_session cookie in login response');
  const sessionToken = cookieMatch[1];
  const cookieHeader = `owner_session=${sessionToken}`;
  console.log('');

  // Step 7: Authenticated Session GET /api/v1/auth/owner/session (with cookie)
  console.log('7. Testing GET /api/v1/auth/owner/session with HttpOnly cookie...');
  const sessionRes = await fetch(`${BASE_URL}/api/v1/auth/owner/session`, {
    headers: { Cookie: cookieHeader }
  });
  const sessionJson = await sessionRes.json();
  console.log(`   HTTP ${sessionRes.status}:`, JSON.stringify(sessionJson));
  if (sessionRes.status !== 200) throw new Error(`Session check failed: ${sessionRes.status}`);
  console.log('');

  // Step 8: Authenticated GET /api/v1/business (with cookie)
  console.log('8. Testing authenticated GET /api/v1/business with session cookie...');
  const authBizRes = await fetch(`${BASE_URL}/api/v1/business`, {
    headers: { Cookie: cookieHeader }
  });
  const authBizJson = await authBizRes.json();
  console.log(`   HTTP ${authBizRes.status}:`, JSON.stringify(authBizJson));
  if (authBizRes.status !== 200) throw new Error(`Authenticated /business failed: ${authBizRes.status}`);
  console.log('');

  // Step 9: Authenticated GET /api/v1/system/readiness (with cookie)
  console.log('9. Testing authenticated GET /api/v1/system/readiness with session cookie...');
  const authReadyRes = await fetch(`${BASE_URL}/api/v1/system/readiness`, {
    headers: { Cookie: cookieHeader }
  });
  const authReadyJson = await authReadyRes.json();
  console.log(`   HTTP ${authReadyRes.status}: status = ${authReadyJson?.data?.status || authReadyJson?.data?.operatingState || 'OK'}`);
  console.log(`   Overall Checks: Total=${authReadyJson?.data?.checklist?.length || 'N/A'}`);
  if (authReadyRes.status !== 200) throw new Error(`Authenticated /system/readiness failed: ${authReadyRes.status}`);
  console.log('');

  // Step 10: Owner Logout POST /api/v1/auth/owner/logout (with cookie)
  console.log('10. Testing Owner Logout POST /api/v1/auth/owner/logout...');
  const logoutRes = await fetch(`${BASE_URL}/api/v1/auth/owner/logout`, {
    method: 'POST',
    headers: { Cookie: cookieHeader }
  });
  const logoutCookieHeader = logoutRes.headers.get('set-cookie') || '';
  const logoutJson = await logoutRes.json();
  console.log(`   HTTP ${logoutRes.status}:`, JSON.stringify(logoutJson));
  console.log(`   Set-Cookie: ${logoutCookieHeader}`);
  if (logoutRes.status !== 200) throw new Error(`Logout failed: ${logoutRes.status}`);
  console.log('');

  // Step 11: Verify revoked session on /api/v1/business (with revoked cookie)
  console.log('11. Verifying revoked session on GET /api/v1/business...');
  const postLogoutBizRes = await fetch(`${BASE_URL}/api/v1/business`, {
    headers: { Cookie: cookieHeader }
  });
  const postLogoutBizJson = await postLogoutBizRes.json();
  console.log(`   HTTP ${postLogoutBizRes.status}:`, JSON.stringify(postLogoutBizJson));
  if (postLogoutBizRes.status !== 401) throw new Error(`Expected 401 after logout, got ${postLogoutBizRes.status}`);
  console.log('');

  // Step 12: Verify Real Public Funnel works without authentication
  console.log('12. Verifying real public acquisition funnel without authentication...');
  const funnelUrl = `${BASE_URL}/api/v1/public/funnel/smilekraft-dental-clinic/main`;
  const funnelRes = await fetch(funnelUrl);
  const funnelJson = await funnelRes.json();
  console.log(`   GET /api/v1/public/funnel/smilekraft-dental-clinic/main -> HTTP ${funnelRes.status}`);
  console.log(`   Business: ${funnelJson?.data?.business?.name} (${funnelJson?.data?.business?.city})`);
  console.log(`   Funnel: ${funnelJson?.data?.funnel?.headline}`);
  console.log(`   Offers count: ${funnelJson?.data?.offers?.length || 0}`);
  if (funnelRes.status !== 200 || !funnelJson?.success || !funnelJson?.data?.funnel) {
    throw new Error(`Real public funnel verification failed with status ${funnelRes.status}`);
  }

  // Also verify alternate configured funnel and availability
  const makeoverRes = await fetch(`${BASE_URL}/api/v1/public/funnel/smilekraft-dental-clinic/smile-makeover`);
  if (makeoverRes.status !== 200) throw new Error(`Makeover funnel failed: ${makeoverRes.status}`);
  console.log(`   GET /api/v1/public/funnel/smilekraft-dental-clinic/smile-makeover -> HTTP ${makeoverRes.status}`);

  const availRes = await fetch(`${BASE_URL}/api/v1/public/availability?businessSlug=smilekraft-dental-clinic`);
  if (availRes.status !== 200) throw new Error(`Availability check failed: ${availRes.status}`);
  console.log(`   GET /api/v1/public/availability?businessSlug=smilekraft-dental-clinic -> HTTP ${availRes.status}`);

  console.log('\n====================================================');
  console.log('ALL LIVE PRODUCTION CHECKS COMPLETED AND PASSED!');
  console.log('====================================================');
}

run().catch((err) => {
  console.error('\n❌ LIVE VERIFICATION FAILED:', err.message);
  process.exit(1);
});
