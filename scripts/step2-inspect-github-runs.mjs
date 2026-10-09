async function run() {
  const url = 'https://api.cloudflare.com/client/v4/...'; // Not D1
  const res = await fetch('https://api.github.com/repos/harshavardhankotu/ai-marketing-organization/actions/runs?per_page=10', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const data = await res.json();
  const runs = data.workflow_runs || [];
  console.log(`Found ${runs.length} workflow runs:\n`);

  for (const r of runs) {
    console.log(`Run ID: ${r.id}`);
    console.log(`Name: ${r.name}`);
    console.log(`Head SHA: ${r.head_sha}`);
    console.log(`Head Commit Message: ${r.head_commit?.message?.split('\n')[0]}`);
    console.log(`Status: ${r.status}`);
    console.log(`Conclusion: ${r.conclusion}`);
    console.log(`HTML URL: ${r.html_url}`);

    // Fetch jobs for this run
    const jobsRes = await fetch(r.jobs_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (jobsRes.ok) {
      const jobsData = await jobsRes.json();
      console.log('Jobs:');
      for (const j of jobsData.jobs || []) {
        console.log(`  - [${j.conclusion || j.status}] ${j.name}`);
        if (j.steps) {
          for (const s of j.steps) {
            console.log(`      * [${s.conclusion || s.status}] ${s.name}`);
          }
        }
      }
    }
    console.log('------------------------------------------------------------\n');
  }
}

run().catch(console.error);
