import { loadLocalEnvFile } from './config/env.js';
loadLocalEnvFile();

import { GoogleSearchClient } from './research/google-search-client.js';
import { MarketResearchPipeline } from './research/market-research-pipeline.js';
import { getDb } from './db/client.js';
import { seedDatabase } from './db/seed.js';

async function main() {
  console.log('Loading database...');
  seedDatabase({ withTestFixtures: true });

  console.log('Environment keys loaded:');
  console.log('GEMINI_API_KEY present:', Boolean(process.env.GEMINI_API_KEY));
  console.log('GOOGLE_SEARCH_API_KEY present:', Boolean(process.env.GOOGLE_SEARCH_API_KEY));
  console.log('GOOGLE_SEARCH_CX present:', Boolean(process.env.GOOGLE_SEARCH_CX));

  const client = GoogleSearchClient.getInstance();
  console.log('\n--- Testing Live Google Custom Search API ---');
  try {
    const res = await client.search('dental clinic Banjara Hills Hyderabad reviews');
    console.log('Search success!');
    console.log('Results Count:', res.resultsCount);
    console.log('First 2 items:');
    res.items.slice(0, 2).forEach((it, i) => {
      console.log(`[${i + 1}] ${it.title} -> ${it.link}`);
      console.log(`    Snippet: ${it.snippet.substring(0, 100)}...`);
    });

    const db = getDb();
    const logRow = db.prepare('SELECT * FROM search_queries_log WHERE id = ?').get(res.logId) as any;
    console.log('\n--- Raw Logged Row from search_queries_log ---');
    console.log('Log ID:', logRow.id);
    console.log('Endpoint:', logRow.endpoint_url);
    console.log('Status Code:', logRow.status_code);
    console.log('Latency:', logRow.latency_ms, 'ms');
    console.log('Is Cached:', logRow.is_cached);
    console.log('Results Count:', logRow.results_count);
    console.log('Raw JSON preview:', logRow.raw_response_json.substring(0, 250) + '...');
  } catch (err: any) {
    console.error('Search error:', err.message);
  }

  console.log('\n--- Testing Live Gemini API ---');
  try {
    const { GeminiProvider } = await import('./ai/gemini-provider.js');
    const gemini = new GeminiProvider();
    const result = await gemini.generateStructured<{ answer: string; reason: string }>({
      agentId: 'mkt-01',
      systemInstruction: 'You are a marketing strategist.',
      prompt: 'Suggest a single core marketing principle for local clinics. Respond with { "answer": "...", "reason": "..." }',
      thinkingLevel: 'low',
      skipCache: true
    });
    console.log('Gemini success!');
    console.log('Structured Data:', result.data);
    console.log('Execution Type:', result.executionType);
    console.log('Model:', result.model);
    console.log('Token Count:', result.tokenCount);
    console.log('Latency:', result.telemetry.latencyMs, 'ms');
  } catch (err: any) {
    console.error('Gemini error:', err.message);
  }
}

main().catch(console.error);
