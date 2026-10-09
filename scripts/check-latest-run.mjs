async function check() {
  const res = await fetch('https://api.github.com/repos/harshavardhankotu/ai-marketing-organization/actions/runs?per_page=3', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const data = await res.json();
  const runs = data.workflow_runs || [];
  for (const r of runs) {
    console.log(`Run ID: ${r.id}`);
    console.log(`Name: ${r.name}`);
    console.log(`Head SHA: ${r.head_sha}`);
    console.log(`Status: ${r.status}`);
    console.log(`Conclusion: ${r.conclusion}`);
    console.log(`HTML URL: ${r.html_url}`);
    const jobsRes = await fetch(r.jobs_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (jobsRes.ok) {
      const jobsData = await jobsRes.json();
      for (const j of jobsData.jobs || []) {
        console.log(`  Job: [${j.conclusion || j.status}] ${j.name}`);
        for (const s of j.steps || []) {
          console.log(`    Step: [${s.conclusion || s.status}] ${s.name}`);
        }
      }
    }
    console.log('---');
  }
}
check().catch(console.error);
