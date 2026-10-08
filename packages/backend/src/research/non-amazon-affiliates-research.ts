import fs from 'fs';
import path from 'path';
import { loadLocalEnvFile } from '../config/env.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';

loadLocalEnvFile();

interface TavilySearchResponse {
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
  response_time?: number;
  usage?: {
    credits?: number;
  };
}

async function runResearch() {
  console.log('=== Step 3: Non-Amazon Indian Affiliate Programs Research ===');
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not configured in environment.');
  }

  const quota = UnifiedQuotaService.getInstance();
  const queries = [
    'top Indian affiliate programs for individuals earnkaro cuelinks vcommission signup KYC payout',
    'vcommission affiliate program individual publisher KYC PAN minimum payout tracking parameter link format',
    'cuelinks affiliate network individual publisher signup KYC payout threshold link format tracking parameter'
  ];

  console.log(`Executing at most ${queries.length} targeted Tavily searches with include_usage=true...\n`);

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    console.log(`[Query ${i + 1}/${queries.length}]: "${q}"`);

    // Reserve P3 quota
    const reservation = quota.reserve('TAVILY', 'P3', 1, `Step 3 Partner research: ${q}`);
    if (!reservation.allowed) {
      console.warn(`Quota reservation blocked: ${reservation.reason}`);
      break;
    }

    const start = Date.now();
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: q,
        search_depth: 'basic',
        max_results: 3,
        include_usage: true
      })
    });

    const elapsed = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Tavily HTTP ${res.status} error (${elapsed}ms):`, errText);
      quota.reconcile(reservation.reservationId, 0, false);
      continue;
    }

    const data = (await res.json()) as TavilySearchResponse;
    const creditsCharged = data.usage?.credits ?? 1;
    quota.reconcile(reservation.reservationId, creditsCharged, true);

    console.log(`Status: 200 OK (${elapsed}ms) | Credits Charged: ${creditsCharged}`);
    console.log(`Results Found: ${data.results?.length || 0}`);

    for (let j = 0; j < (data.results || []).length; j++) {
      const item = data.results[j];
      console.log(`\n  [Citation ${j + 1}] Title: ${item.title}`);
      console.log(`  Source URL: ${item.url}`);
      console.log(`  Excerpt: ${item.content.replace(/\s+/g, ' ').substring(0, 250)}...`);
    }
    console.log('\n------------------------------------------------------------\n');
  }
}

runResearch().catch(err => {
  console.error('RESEARCH SCRIPT FATAL:', err);
  process.exit(1);
});
