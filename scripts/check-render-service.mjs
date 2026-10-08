import fs from 'fs';

function loadAdminSecret() {
  const content = fs.readFileSync('.env.admin_secret', 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('RENDER_API_KEY=')) {
      return trimmed.split('=')[1].trim();
    }
  }
  return null;
}

const apiKey = loadAdminSecret();
if (!apiKey) {
  console.log('RENDER_API_KEY not found in .env.admin_secret');
  process.exit(1);
}

const serviceId = 'srv-darecoc9v7es73ea8t2g';

async function run() {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json'
    }
  });

  if (!res.ok) {
    console.error(`Render API returned HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log('Render Service Details:');
  console.log('ID:', data.id);
  console.log('Name:', data.name);
  console.log('AutoDeploy setting:', data.autoDeploy);
  console.log('Branch:', data.branch);
  console.log('Suspended:', data.suspended);
  console.log('Service Details:', JSON.stringify(data.serviceDetails, null, 2));

  // Check recent deploys
  const deploysRes = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=3`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json'
    }
  });
  if (deploysRes.ok) {
    const deploys = await deploysRes.json();
    console.log('\nRecent Deploys:');
    for (const d of deploys) {
      console.log(`- Deploy ID: ${d.deploy.id}, Status: ${d.deploy.status}, Commit: ${d.deploy.commit?.id?.substring(0, 7) || 'N/A'}, CreatedAt: ${d.deploy.createdAt}`);
    }
  }
}

run().catch(console.error);
