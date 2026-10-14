import fs from 'fs';

function getSecret(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env.admin_secret', '.env.deploy_secrets']) {
    if (fs.existsSync(f)) {
      const match = fs.readFileSync(f, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
      if (match && match[1].trim()) return match[1].trim();
    }
  }
  return null;
}

const apiKey = getSecret('RENDER_API_KEY');
if (!apiKey) {
  console.error('No RENDER_API_KEY found');
  process.exit(1);
}

async function main() {
  const res = await fetch('https://api.render.com/v1/services/srv-darecoc9v7es73ea8t2g/deploys?limit=5', {
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Accept': 'application/json'
    }
  });

  const data = await res.json();
  console.log('=== RENDER DEPLOYS ===');
  for (const item of data) {
    const d = item.deploy || item;
    console.log(`Deploy ID: ${d.id}`);
    console.log(`Commit: ${d.commit?.id || d.commitId} (${d.commit?.message?.trim() || ''})`);
    console.log(`Trigger: ${d.trigger}`);
    console.log(`Status: ${d.status}`);
    console.log(`CreatedAt: ${d.createdAt}`);
    console.log(`FinishedAt: ${d.finishedAt}`);
    console.log('---');
  }
}

main().catch(console.error);
