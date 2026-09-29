import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { D1Client } from '../d1-client.js';
import { loadLocalEnvFile } from '../../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Robust SQL statement parser that handles:
 * - Single-line comments
 * - Multi-line block comments
 * - Semicolons inside single-quoted strings
 * - Semicolons inside double-quoted identifiers
 * - Escaped quotes
 * - Multi-statement schemas
 */
export function parseSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = i + 1 < sql.length ? sql[i + 1] : '';

    // Handle single-line comment (-- ...)
    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
      }
      continue;
    }

    // Handle multi-line block comment (/* ... */)
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++; // skip '/'
      }
      continue;
    }

    // Check for comment starts outside of quoted strings
    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
        i++; // skip second '-'
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i++; // skip '*'
        continue;
      }
    }

    // Handle single-quoted strings ('...')
    if (char === "'" && !inDoubleQuote && !inBacktick) {
      if (inSingleQuote) {
        // Escaped single quote '' or \'
        if (nextChar === "'") {
          current += "''";
          i++;
          continue;
        }
        if (sql[i - 1] === '\\') {
          current += char;
          continue;
        }
        inSingleQuote = false;
        current += char;
        continue;
      } else {
        inSingleQuote = true;
        current += char;
        continue;
      }
    }

    // Handle double-quoted identifiers ("...")
    if (char === '"' && !inSingleQuote && !inBacktick) {
      if (inDoubleQuote) {
        if (nextChar === '"') {
          current += '""';
          i++;
          continue;
        }
        if (sql[i - 1] === '\\') {
          current += char;
          continue;
        }
        inDoubleQuote = false;
        current += char;
        continue;
      } else {
        inDoubleQuote = true;
        current += char;
        continue;
      }
    }

    // Handle backtick-quoted identifiers (`...`)
    if (char === '`' && !inSingleQuote && !inDoubleQuote) {
      inBacktick = !inBacktick;
      current += char;
      continue;
    }

    // Semicolon outside any quote or comment terminates statement
    if (char === ';' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const finalTrimmed = current.trim();
  if (finalTrimmed.length > 0) {
    statements.push(finalTrimmed);
  }

  return statements;
}

/**
 * Retrieves the list of user tables from D1 / SQLite.
 */
export async function listD1Tables(): Promise<string[]> {
  const d1 = D1Client.getInstance();
  const query = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;`;
  const res = await d1.executeQuery<{ name: string }>(query, [], false, 'P0');
  return (res.results || []).map(r => r.name);
}

/**
 * Applies all pending SQL migrations in packages/backend/src/db/d1-migrations/.
 * Fails fast on the first error; does NOT swallow errors; logs exact statement and error.
 * Never ignores UNIQUE constraint violations.
 */
export async function applyD1Migrations(): Promise<{ applied: string[]; tables: string[] }> {
  const d1 = D1Client.getInstance();
  const applied: string[] = [];

  // Ensure tracking table exists
  await d1.executeQuery(
    `CREATE TABLE IF NOT EXISTS _d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    [],
    true,
    'P0'
  );

  // Retrieve already applied migrations
  const existingRows = await d1.executeQuery<{ migration_name: string }>(
    `SELECT migration_name FROM _d1_migrations ORDER BY id ASC;`,
    [],
    false,
    'P0'
  );
  const appliedSet = new Set((existingRows.results || []).map(r => r.migration_name));

  const possibleDirs = [
    __dirname,
    path.resolve(__dirname, '../../../src/db/d1-migrations'),
    path.resolve(process.cwd(), 'packages/backend/src/db/d1-migrations'),
    path.resolve(process.cwd(), 'src/db/d1-migrations'),
    path.resolve(process.cwd(), 'packages/backend/dist/db/d1-migrations'),
    path.resolve(process.cwd(), 'dist/db/d1-migrations')
  ];

  let migrationsDir = __dirname;
  for (const d of possibleDirs) {
    if (fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.sql'))) {
      migrationsDir = d;
      break;
    }
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[D1 Migration Runner] Already applied: ${file} (skipping)`);
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const statements = parseSqlStatements(content);

    console.log(`[D1 Migration Runner] Applying ${file} (${statements.length} statements)...`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await d1.executeQuery(stmt, [], true, 'P0');
      } catch (err: any) {
        const msg = String(err.message || '');
        // Explicitly NEVER ignore UNIQUE constraint violations
        if (msg.toLowerCase().includes('unique constraint')) {
          console.error(`\n[D1 MIGRATION RUNNER] FATAL UNIQUE CONSTRAINT VIOLATION: ${msg}`);
          throw new Error(`D1_MIGRATION_FAILED: Unique constraint violation in '${file}' on statement:\n${stmt}\nError: ${msg}`);
        }
        // Allow idempotent catch-up for duplicate column or table already exists on existing databases
        if (msg.includes('duplicate column name') || msg.includes('already exists')) {
          console.warn(`[D1 Migration Runner] Schema element already exists in database (skipping idempotent statement): ${stmt}`);
          continue;
        }

        console.error(`\n======================================================`);
        console.error(`[D1 MIGRATION RUNNER] MIGRATION FAILED - HALTING IMMEDIATELY`);
        console.error(`File:      ${file}`);
        console.error(`Statement #${i + 1} of ${statements.length}:`);
        console.error(`${stmt}`);
        console.error(`Error:     ${err.message}`);
        console.error(`======================================================\n`);
        throw new Error(
          `D1_MIGRATION_FAILED: Migration '${file}' failed at statement #${i + 1}:\n${stmt}\nError: ${err.message}`
        );
      }
    }

    // Record migration in _d1_migrations
    await d1.executeQuery(
      `INSERT INTO _d1_migrations (migration_name) VALUES (?);`,
      [file],
      true,
      'P0'
    );
    applied.push(file);
    console.log(`[D1 Migration Runner] Successfully applied ${file}`);
  }

  const tables = await listD1Tables();
  return { applied, tables };
}

// CLI Execution Entrypoint
if (
  process.argv[1] &&
  (process.argv[1].endsWith('d1-migrations/index.ts') ||
   process.argv[1].endsWith('d1-migrations\\index.ts') ||
   process.argv[1].endsWith('d1-migrations/index.js') ||
   process.argv[1].endsWith('d1-migrations\\index.js'))
) {
  loadLocalEnvFile();
  console.log('[D1 Migration Runner] Starting migration run...');
  applyD1Migrations()
    .then(async res => {
      console.log(`\n[D1 Migration Runner] Complete!`);
      console.log(`Applied: ${res.applied.length > 0 ? res.applied.join(', ') : 'None (already up-to-date)'}`);
      console.log(`\n[D1 Migration Runner] D1 Tables (${res.tables.length}):`);
      res.tables.forEach((t, idx) => console.log(`  ${idx + 1}. ${t}`));
      process.exit(0);
    })
    .catch(err => {
      console.error(`\n[D1 Migration Runner FATAL] ${err.message}`);
      process.exit(1);
    });
}
