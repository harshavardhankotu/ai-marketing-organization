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
const serviceId = 'srv-darecoc9v7es73ea8t2g';

async function run() {
  console.log('Patching Render service to set autoDeploy = "no"...');
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      autoDeploy: 'no'
    })
  });

  if (!res.ok) {
    console.error(`Failed to patch Render service: HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const updated = await res.json();
  console.log('Successfully updated Render service:');
  console.log('Service ID:', updated.id);
  console.log('Service Name:', updated.name);
  console.log('AutoDeploy setting:', updated.autoDeploy);
}

run().catch(console.error);
