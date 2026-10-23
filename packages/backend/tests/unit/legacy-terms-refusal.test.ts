import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

describe('Step 10: Owner Terms Trap & Refusal of Legacy Agent Terms', () => {
  const rootDir = path.resolve(__dirname, '../../../..');

  it('refuses attestation when target offer file matches LEGACY_AGENT_TERMS_SHA256', () => {
    let output = '';
    let exitCode = 0;
    try {
      output = execSync(
        `node scripts/owner-apply.mjs --offer-file=owner/OWN_OFFER.legacy_agent_written.md`,
        { cwd: rootDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (err: any) {
      exitCode = err.status || 1;
      output = (err.stdout || '') + (err.stderr || '');
    }

    expect(exitCode).not.toBe(0);
    expect(output).toContain('REFUSAL: Cannot attest legacy agent-written offer terms');
    expect(output).toMatch(/778922fd08bda0745e74ff4baa368d58d6ba3729634c25dfa03b65a0fe684934|d16370c334b0e72a834f4ed12d2354673757835d6a9e2bf43023d54992d9ebae/);
  });

  it('prints deliverable audit warnings against capability registry during dry-run', () => {
    let output = '';
    try {
      output = execSync(
        `node scripts/owner-apply.mjs --offer-file=owner/OWN_OFFER.draft.md`,
        { cwd: rootDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (err: any) {
      output = (err.stdout || '') + (err.stderr || '');
    }

    // Must audit deliverables and output warnings or confirmation
    expect(output).toContain('Auditing deliverables against capability registry');
  });
});
