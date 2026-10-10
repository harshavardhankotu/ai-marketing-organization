import { describe, it, expect } from 'vitest';
import { verifyCiGreenBeforeDeploy } from '../../../../scripts/deploy-render.mjs';

describe('CI Deploy Gate (mst_21 Guard)', () => {
  const dummyHead = 'a1b2c3d4e5f67890';

  it('refuses to deploy when latest CI run for HEAD is not success', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        workflow_runs: [
          {
            id: 12345,
            name: 'CI & Deployment Pipeline',
            head_sha: dummyHead,
            status: 'completed',
            conclusion: 'failure'
          }
        ]
      })
    }) as any;

    await expect(
      verifyCiGreenBeforeDeploy({ headSha: dummyHead, fetchFn: mockFetch })
    ).rejects.toThrow(/Refusing to deploy with API key while CI is red/i);
  });

  it('refuses to deploy when CI is still in progress / pending', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        workflow_runs: [
          {
            id: 12346,
            name: 'CI & Deployment Pipeline',
            head_sha: dummyHead,
            status: 'in_progress',
            conclusion: null
          }
        ]
      })
    }) as any;

    await expect(
      verifyCiGreenBeforeDeploy({ headSha: dummyHead, fetchFn: mockFetch })
    ).rejects.toThrow(/Refusing to deploy with API key while CI is red/i);
  });

  it('refuses to deploy when no CI workflow run exists for HEAD', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        workflow_runs: []
      })
    }) as any;

    await expect(
      verifyCiGreenBeforeDeploy({ headSha: dummyHead, fetchFn: mockFetch })
    ).rejects.toThrow(/No CI workflow run found for commit/i);
  });

  it('permits deploy only when latest CI conclusion is success', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        workflow_runs: [
          {
            id: 12347,
            name: 'CI & Deployment Pipeline',
            head_sha: dummyHead,
            status: 'completed',
            conclusion: 'success'
          }
        ]
      })
    }) as any;

    const result = await verifyCiGreenBeforeDeploy({ headSha: dummyHead, fetchFn: mockFetch });
    expect(result.allowed).toBe(true);
    expect(result.runId).toBe(12347);
  });
});
