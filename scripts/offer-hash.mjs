import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const targetFile = path.resolve(process.cwd(), 'owner', 'OWN_OFFER.md');
if (!fs.existsSync(targetFile)) {
  console.error(`ERROR: Target offer file not found: ${targetFile}`);
  process.exit(1);
}

const content = fs.readFileSync(targetFile);
const hash = crypto.createHash('sha256').update(content).digest('hex');
console.log(hash);
