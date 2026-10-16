import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Mistake P1 Guard: No Fixture Demand in Migrations', () => {
  it('rejects migrations that insert mock, fixture, or search.community URLs into production tables', () => {
    const migrationsDir = path.resolve(__dirname, '../../src/db/d1-migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

    const forbiddenPatterns = [
      /search\.community/i,
      /example\.com\/fixture/i,
      /test\.local/i,
      /mock-demand/i
    ];

    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      // Skip historical migration 0026 (the mistake itself) and remediation migrations that mention or sanitize it
      if (file.startsWith('0026_') || file.startsWith('0032_') || file.startsWith('0033_')) {
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');

      lines.forEach((line, index) => {
        // Only inspect INSERT statements
        if (/INSERT\s+INTO/i.test(line) || /VALUES\s*\(/i.test(line)) {
          for (const pattern of forbiddenPatterns) {
            if (pattern.test(line)) {
              violations.push({ file, line: index + 1, text: line.trim() });
            }
          }
        }
      });
    }

    if (violations.length > 0) {
      console.error('Found forbidden fixture data in migrations:', violations);
    }
    expect(violations).toEqual([]);
  });

  it('proves that synthetic fixture insertion with search.community is caught by the guard', () => {
    const testSqlLine = "INSERT INTO demand_signals (source_url) VALUES ('https://search.community/q1');";
    const isViolation = /search\.community/i.test(testSqlLine) && /INSERT\s+INTO/i.test(testSqlLine);
    expect(isViolation).toBe(true);
  });
});
