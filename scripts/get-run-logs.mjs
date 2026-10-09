async function getLogs() {
  const runId = 37865456742;
  const jobsRes = await fetch(`https://api.github.com/repos/harshavardhankotu/ai-marketing-organization/actions/runs/${runId}/jobs`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const jobsData = await jobsRes.json();
  const job = jobsData.jobs?.[0];
  console.log(`Job ID: ${job?.id}`);
  console.log(`Job Status: ${job?.status}, Conclusion: ${job?.conclusion}`);
  for (const s of job?.steps || []) {
    console.log(`  Step: [${s.conclusion}] ${s.name}`);
  }
}
getLogs().catch(console.error);
