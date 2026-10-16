import fs from 'fs';

for (const envFile of ['.env.local', '.env.deploy_secrets']) {
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    }
  }
}

const renderKey = process.env.RENDER_API_KEY;
if (!renderKey) {
  console.error('No RENDER_API_KEY');
  process.exit(1);
}

async function run() {
  const res = await fetch('https://api.render.com/v1/services?limit=10', {
    headers: { 'Authorization': `Bearer ${renderKey}` }
  });
  const services = await res.json();
  const service = services.find((s) => s.service?.repo?.includes('ai-marketing-organization') || s.service?.name?.includes('ai-marketing-organization'))?.service;

  if (!service) {
    console.log('No matching service found. Available:', services.map(s => ({ id: s.service?.id, name: s.service?.name, repo: s.service?.repo })));
    return;
  }

  console.log('Render Service:', {
    id: service.id,
    name: service.name,
    repo: service.repo,
    branch: service.branch,
    autoDeploy: service.autoDeploy,
    updatedAt: service.updatedAt
  });

  const depRes = await fetch(`https://api.render.com/v1/services/${service.id}/deploys?limit=5`, {
    headers: { 'Authorization': `Bearer ${renderKey}` }
  });
  const deploys = await depRes.json();
  console.log('\nRecent Deploys:');
  for (const d of deploys) {
    const dep = d.deploy;
    console.log({
      id: dep.id,
      commit: dep.commit?.id?.slice(0, 7),
      commitMessage: dep.commit?.message?.trim()?.split('\n')[0],
      status: dep.status,
      trigger: dep.trigger,
      createdAt: dep.createdAt,
      finishedAt: dep.finishedAt
    });
  }
}

run().catch(console.error);
