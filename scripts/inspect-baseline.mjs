import fs from 'fs';
import path from 'path';

function inspectRoutes() {
  const content = fs.readFileSync('packages/backend/src/routes/api.ts', 'utf8');
  const routeRegex = /apiRouter\.(get|post|put|delete)\(['"]([^'"]+)['"]/g;
  const matches = [];
  let m;
  while ((m = routeRegex.exec(content)) !== null) {
    matches.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return matches;
}

const routes = inspectRoutes();
console.log(`Total API routes defined: ${routes.length}`);
console.log("\n--- Public Deals, Tools, Feeds, Sitemaps & Revenue Routes ---");
const publicMatches = routes.filter(r => 
  r.includes('deal') || r.includes('rss') || r.includes('sitemap') || 
  r.includes('tool') || r.includes('revenue') || r.includes('guide') || 
  r.includes('offer') || r.includes('payment') || r.includes('audit')
);
console.log(publicMatches.join('\n'));
