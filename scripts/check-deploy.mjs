import fs from 'fs';

function getSecret(key) {
  for (const candidate of ['.env.deploy_secrets', '.env.local']) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, 'utf8');
      const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
      if (match && match[1].trim()) return match[1].trim();
    }
  }
  return null;
}

const renderKey = getSecret('RENDER_API_KEY');

async function main() {
  const resR = await fetch('https://api.render.com/v1/services/srv-darecoc9v7es73ea8t2g/deploys?limit=1', {
    headers: { 'Authorization': `Bearer ${renderKey}`, 'Accept': 'application/json' }
  });
  const deploys = await resR.json();
  const d = deploys[0]?.deploy;

  const resG = await fetch('https://api.github.com/repos/harshavardhankotu/ai-marketing-organization/actions/runs?per_page=2', {
    headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'agent-ci-check' }
  });
  const dataG = await resG.json();
  const ciRun = dataG.workflow_runs?.find(r => r.name === 'CI & Deployment Pipeline');

  console.log(JSON.stringify({
    ci: {
      status: ciRun?.status,
      conclusion: ciRun?.conclusion,
      head_sha: ciRun?.head_sha?.substring(0, 7),
      html_url: ciRun?.html_url
    },
    render: {
      id: d?.id,
      commit: d?.commit?.id?.substring(0, 7),
      status: d?.status,
      createdAt: d?.createdAt,
      updatedAt: d?.updatedAt
    }
  }, null, 2));
}

main().catch(err => console.error(err));
