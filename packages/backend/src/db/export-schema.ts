import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCHEMA_SQL } from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputPath = path.resolve(__dirname, '../../schema.sql');
fs.writeFileSync(outputPath, SCHEMA_SQL.trim() + '\n', 'utf-8');
console.log(`Schema successfully exported to ${outputPath}`);
