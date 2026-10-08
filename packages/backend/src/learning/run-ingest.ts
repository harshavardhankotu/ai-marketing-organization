import { HistoryIngestService } from './history-ingest.js';
import { loadLocalEnvFile } from '../config/env.js';

loadLocalEnvFile();

async function main() {
  console.log('=== Starting History Ingest into learning_records ===');
  const service = HistoryIngestService.getInstance();
  const res = await service.ingest();

  console.log('\n--- INGESTION RESULTS ---');
  console.log(`Total facts considered:   ${res.totalConsidered}`);
  console.log(`Newly inserted rows:      ${res.inserted}`);
  console.log(`Skipped duplicates:       ${res.skippedDuplicates}`);
  console.log('\n--- ROW COUNTS BY OUTCOME ---');
  console.log(`WORKED:  ${res.countsByOutcome.WORKED}`);
  console.log(`FAILED:  ${res.countsByOutcome.FAILED}`);
  console.log(`UNKNOWN: ${res.countsByOutcome.UNKNOWN}`);
  console.log('Total:   ' + (res.countsByOutcome.WORKED + res.countsByOutcome.FAILED + res.countsByOutcome.UNKNOWN));
  console.log('=====================================================');
}

main().catch(err => {
  console.error('INGESTION ERROR:', err);
  process.exit(1);
});
