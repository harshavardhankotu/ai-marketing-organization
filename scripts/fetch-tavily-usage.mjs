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

const tavilyKey = getSecret('TAVILY_API_KEY');

async function main() {
  const res = await fetch('https://api.tavily.com/usage', {
    headers: { 'Authorization': `Bearer ${tavilyKey}` }
  });
  const data = await res.json();
  console.log(JSON.stringify(data));
}

main().catch(err => console.error(err));
