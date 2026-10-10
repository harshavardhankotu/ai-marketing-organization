import fs from 'fs';
import { execSync } from 'child_process';

async function main() {
  console.log('=== STEP 1d: HERMETIC TEST ZERO-SPEND PROOF ===\n');

  const envText = fs.readFileSync('.env.local', 'utf8');
  const tvMatch = envText.match(/^TAVILY_API_KEY=(.*)$/m);
  const fcMatch = envText.match(/^FIRECRAWL_API_KEY=(.*)$/m);
  const gmMatch = envText.match(/^GEMINI_API_KEY=(.*)$/m);

  if (!tvMatch || !fcMatch) {
    throw new Error('CONFIG_ERROR: Real keys missing in .env.local for verification.');
  }

  const tvKey = tvMatch[1].trim();
  const fcKey = fcMatch[1].trim();
  const gmKey = gmMatch ? gmMatch[1].trim() : '';

  // 1. Tavily & Firecrawl BEFORE
  console.log('[1/4] Fetching provider usage BEFORE running test suite...');
  const tvResBefore = await fetch('https://api.tavily.com/usage', {
    headers: { 'Authorization': 'Bearer ' + tvKey }
  });
  const tvDataBefore = await tvResBefore.json();
  const tvUsageBefore = tvDataBefore.key?.usage ?? tvDataBefore.account?.plan_usage;
  console.log('Tavily usage BEFORE:', JSON.stringify(tvDataBefore));

  const fcResBefore = await fetch('https://api.firecrawl.dev/v2/team/credit-usage', {
    headers: { 'Authorization': 'Bearer ' + fcKey }
  });
  const fcDataBefore = await fcResBefore.json();
  const fcRemainingBefore = fcDataBefore.data?.remainingCredits ?? fcDataBefore.data?.remaining_credits;
  console.log('Firecrawl usage BEFORE:', JSON.stringify(fcDataBefore));

  // 2. Run test suite WITH real keys explicitly set in process environment
  console.log('\n[2/4] Running full test suite with real keys present in shell environment...');
  const testEnv = {
    ...process.env,
    TAVILY_API_KEY: tvKey,
    FIRECRAWL_API_KEY: fcKey,
    GEMINI_API_KEY: gmKey
  };

  const testOutput = execSync('npm test', {
    env: testEnv,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  console.log('Test suite completed successfully:');
  const summaryLine = testOutput.split('\n').filter(l => l.includes('Test Files') || l.includes('Tests ')).join('\n');
  console.log(summaryLine || 'All tests passed.');

  // 3. Tavily & Firecrawl AFTER
  console.log('\n[3/4] Fetching provider usage AFTER running test suite...');
  const tvResAfter = await fetch('https://api.tavily.com/usage', {
    headers: { 'Authorization': 'Bearer ' + tvKey }
  });
  const tvDataAfter = await tvResAfter.json();
  const tvUsageAfter = tvDataAfter.key?.usage ?? tvDataAfter.account?.plan_usage;
  console.log('Tavily usage AFTER:', JSON.stringify(tvDataAfter));

  const fcResAfter = await fetch('https://api.firecrawl.dev/v2/team/credit-usage', {
    headers: { 'Authorization': 'Bearer ' + fcKey }
  });
  const fcDataAfter = await fcResAfter.json();
  const fcRemainingAfter = fcDataAfter.data?.remainingCredits ?? fcDataAfter.data?.remaining_credits;
  console.log('Firecrawl usage AFTER:', JSON.stringify(fcDataAfter));

  // 4. Verification & Assertions
  console.log('\n[4/4] Comparing deltas...');
  const tavilyDelta = tvUsageAfter - tvUsageBefore;
  const firecrawlDelta = fcRemainingBefore - fcRemainingAfter; // credits consumed

  console.log(`Tavily: Before=${tvUsageBefore}, After=${tvUsageAfter}, Delta=${tavilyDelta}`);
  console.log(`Firecrawl Remaining: Before=${fcRemainingBefore}, After=${fcRemainingAfter}, Delta=${firecrawlDelta}`);

  if (tavilyDelta !== 0) {
    throw new Error(`FAIL: Tavily credits were consumed during test run! Delta = ${tavilyDelta}`);
  }
  if (firecrawlDelta !== 0) {
    throw new Error(`FAIL: Firecrawl credits were consumed during test run! Delta = ${firecrawlDelta}`);
  }

  console.log('\n✅ PASS: Zero provider credits consumed. Hermetic test isolation verified.');
}

main().catch(err => {
  console.error('\n❌ ZERO SPEND VERIFICATION FAILED:', err.message);
  process.exit(1);
});
