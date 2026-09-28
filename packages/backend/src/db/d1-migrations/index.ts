import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { D1Client } from '../d1-client.js';
import { getDb } from '../client.js';
import { isProduction } from '../../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function applyD1Migrations(): Promise<{ applied: string[]; errors: string[] }> {
  const applied: string[] = [];
  const errors: string[] = [];

  const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const d1 = D1Client.getInstance();
  const isProd = isProduction() && d1.isRemoteD1Configured();
  const db = !isProd ? getDb() : null;

  for (const file of files) {
    const filePath = path.join(__dirname, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const statements = content
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      try {
        if (isProd) {
          await d1.executeQuery(stmt, [], true, 'P0');
        } else if (db) {
          db.exec(stmt);
        }
      } catch (err: any) {
        // Idempotent migration: ignore duplicate column or table already exists errors
        const msg = String(err.message || '');
        if (
          msg.includes('duplicate column') ||
          msg.includes('already exists') ||
          msg.includes('UNIQUE constraint')
        ) {
          // Expected on re-run
          continue;
        }
        errors.push(`${file}: ${msg}`);
      }
    }
    applied.push(file);
  }

  return { applied, errors };
}
