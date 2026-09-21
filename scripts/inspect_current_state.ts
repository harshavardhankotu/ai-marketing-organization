import { getDb } from '../packages/backend/src/db/client.js';
import { seedDatabase } from '../packages/backend/src/db/seed.js';

seedDatabase();
const db = getDb();

console.log('=== REALITY AUDIT ===');
const transactions = db.prepare('SELECT count(*) as count, coalesce(sum(amount_inr), 0) as sum, classification FROM transactions GROUP BY classification').all();
console.log('Transactions:', transactions);

const journeys = db.prepare('SELECT stage, classification, count(*) as count FROM customer_journeys GROUP BY stage, classification').all();
console.log('Customer Journeys:', journeys);

const appointments = db.prepare('SELECT count(*) as count, clinic_confirmation FROM appointments GROUP BY clinic_confirmation').all();
console.log('Appointments:', appointments);

const plans = db.prepare('SELECT count(*) as count, coalesce(sum(quoted_amount_inr), 0) as quotes, coalesce(sum(paid_amount_inr), 0) as paid FROM treatment_plans').all();
console.log('Treatment Plans:', plans);

const gbp = db.prepare('SELECT * FROM gbp_interactions').all();
console.log('GBP Interactions:', gbp);

const traffic = db.prepare('SELECT traffic_evidence_status, count(*) as count FROM traffic_sessions GROUP BY traffic_evidence_status').all();
console.log('Traffic Sessions:', traffic);
