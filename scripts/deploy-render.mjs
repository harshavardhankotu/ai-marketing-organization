import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function verifyCiGreenBeforeDeploy(options = {}) {
  const headSha = options.headSha || execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const repo = options.repo || 'harshavardhankotu/ai-marketing-organization';
  const fetchFn = options.fetchFn || fetch;

  const url = `https://api.github.com/repos/${repo}/actions/runs?head_sha=${headSha}&per_page=5`;
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'deploy-guard/1.0' }
  });

  if (!res.ok) {
    throw new Error(`CI_CHECK_FAILED: Could not retrieve GitHub Actions runs (HTTP ${res.status}). Refusing to deploy.`);
  }

  const data = await res.json();
  const runs = (data.workflow_runs || []).filter(r => r.name === 'CI & Deployment Pipeline' || r.name === 'CI');

  if (runs.length === 0) {
    throw new Error(`CI_GATE_BLOCKED: No CI workflow run found for commit ${headSha}. CI must execute and pass before deploy.`);
  }

  const latestRun = runs[0];
  if (latestRun.conclusion !== 'success') {
    throw new Error(`CI_GATE_BLOCKED: Latest CI run for HEAD (${headSha}) concluded with '${latestRun.conclusion}' (status: ${latestRun.status}). Refusing to deploy with API key while CI is red.`);
  }

  return { allowed: true, runId: latestRun.id, headSha };
}

function getSecret(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env.admin_secret']) {
    if (fs.existsSync(f)) {
      const match = fs.readFileSync(f, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
      if (match && match[1].trim()) return match[1].trim();
    }
  }
  return null;
}

async function main() {
  console.log('=== RENDER PRODUCTION DEPLOY GUARD ===');
  const headSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  console.log(`Checking CI status for Git HEAD: ${headSha}...`);

  const check = await verifyCiGreenBeforeDeploy({ headSha });
  console.log(`✅ CI Gate Passed: Workflow run ${check.runId} concluded 'success'.`);

  const apiKey = getSecret('RENDER_API_KEY');
  if (!apiKey) {
    throw new Error('CONFIG_ERROR: RENDER_API_KEY is not configured in environment or .env.local.');
  }

  console.log('Triggering Render deploy via API...');
  const res = await fetch('https://api.render.com/v1/services/srv-darecoc9v7es73ea8t2g/deploys', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ clearCache: 'do_not_clear' })
  });

  if (!res.ok) {
    throw new Error(`Render API deploy trigger failed with HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  console.log('Deploy triggered successfully:', JSON.stringify(data, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('deploy-render.mjs')) {
  main().catch(err => {
    console.error(`❌ DEPLOY FAILED: ${err.message}`);
    process.exit(1);
  });
}
