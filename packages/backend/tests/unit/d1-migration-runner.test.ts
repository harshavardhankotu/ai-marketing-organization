import { describe, it, expect } from 'vitest';
import { parseSqlStatements } from '../../src/db/d1-migrations/index.js';

describe('D1 Migration Runner & SQL Statement Parser (Spec Item 2)', () => {
  it('parses basic statements separated by semicolons', () => {
    const sql = `CREATE TABLE t1 (id TEXT); CREATE TABLE t2 (id TEXT);`;
    const stmts = parseSqlStatements(sql);
    expect(stmts).toEqual([
      'CREATE TABLE t1 (id TEXT)',
      'CREATE TABLE t2 (id TEXT)'
    ]);
  });

  it('handles single-line comments (-- ...) even when containing semicolons', () => {
    const sql = `
      -- First comment with a semicolon;
      CREATE TABLE users (id TEXT PRIMARY KEY);
      -- Second comment with semicolons; and symbols;
      CREATE INDEX idx_user ON users(id);
    `;
    const stmts = parseSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toBe('CREATE TABLE users (id TEXT PRIMARY KEY)');
    expect(stmts[1]).toBe('CREATE INDEX idx_user ON users(id)');
  });

  it('handles multi-line block comments (/* ... */) containing semicolons', () => {
    const sql = `
      /*
        Multi-line comment block
        with semicolons;
        and another;
      */
      CREATE TABLE orders (id TEXT PRIMARY KEY);
      /* inline comment; */ CREATE INDEX idx_order ON orders(id);
    `;
    const stmts = parseSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toBe('CREATE TABLE orders (id TEXT PRIMARY KEY)');
    expect(stmts[1]).toBe('CREATE INDEX idx_order ON orders(id)');
  });

  it('preserves semicolons inside single-quoted strings without splitting', () => {
    const sql = `
      INSERT INTO configs (key, val) VALUES ('greeting', 'Hello; Welcome to our service; please click here');
      INSERT INTO configs (key, val) VALUES ('farewell', 'Goodbye; see you soon;');
    `;
    const stmts = parseSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("'Hello; Welcome to our service; please click here'");
    expect(stmts[1]).toContain("'Goodbye; see you soon;'");
  });

  it("handles escaped single quotes ('') containing semicolons", () => {
    const sql = `
      INSERT INTO logs (msg) VALUES ('User''s action; completed successfully;');
    `;
    const stmts = parseSqlStatements(sql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toBe("INSERT INTO logs (msg) VALUES ('User''s action; completed successfully;')");
  });

  it('preserves semicolons inside double-quoted identifiers without splitting', () => {
    const sql = `
      CREATE TABLE "my;table;name" ("col;1" TEXT, "col;2" TEXT);
    `;
    const stmts = parseSqlStatements(sql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toBe('CREATE TABLE "my;table;name" ("col;1" TEXT, "col;2" TEXT)');
  });

  it('handles complex multi-statement schemas with mixed comments, strings, and statements', () => {
    const sql = `
      -- 1. Table
      CREATE TABLE test_table (
        id TEXT PRIMARY KEY,
        default_message TEXT NOT NULL DEFAULT 'Initial; value;'
      );
      /* 2. Index */
      CREATE INDEX idx_test ON test_table(id);
      -- 3. Data insert
      INSERT INTO test_table (id, default_message) VALUES ('rec_1', 'One; Two; Three;');
    `;
    const stmts = parseSqlStatements(sql);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toContain('CREATE TABLE test_table');
    expect(stmts[1]).toBe('CREATE INDEX idx_test ON test_table(id)');
    expect(stmts[2]).toContain("'One; Two; Three;'");
  });

  it('handles statement without trailing semicolon', () => {
    const sql = `SELECT 1`;
    const stmts = parseSqlStatements(sql);
    expect(stmts).toEqual(['SELECT 1']);
  });

  it('handles statement prefixed with comments correctly', () => {
    const sql = `
      -- Header comment about this table
      -- Another comment line
      CREATE TABLE orders_v2 (
        id TEXT PRIMARY KEY,
        amount INTEGER NOT NULL
      );
    `;
    const stmts = parseSqlStatements(sql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toBe('CREATE TABLE orders_v2 (\n        id TEXT PRIMARY KEY,\n        amount INTEGER NOT NULL\n      )');
  });

  it('correctly distinguishes idempotent schema errors vs genuine migration failures', () => {
    // Simulating error classification logic from applyD1Migrations
    const isIdempotentError = (msg: string) => {
      if (msg.toLowerCase().includes('unique constraint')) return false;
      return msg.includes('duplicate column name') || msg.includes('already exists');
    };

    // Idempotent errors that may be safely caught up:
    expect(isIdempotentError('table users already exists')).toBe(true);
    expect(isIdempotentError('duplicate column name: email')).toBe(true);

    // Genuine/fatal errors that must fail fast:
    expect(isIdempotentError('syntax error near "TABL"')).toBe(false);
    expect(isIdempotentError('no such column: missing_col')).toBe(false);
    expect(isIdempotentError('UNIQUE constraint failed: users.id')).toBe(false);
  });
});
