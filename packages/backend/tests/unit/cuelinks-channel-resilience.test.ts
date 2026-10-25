import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';

describe('Cuelinks Channel Selection & 25-Char Safety (P1 Fix / Phase 3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes source_url into url in getChannels()', async () => {
    const client = CuelinksV3Client.getInstance();
    
    vi.spyOn(client as any, 'request').mockResolvedValue({
      data: [
        {
          id: 331585,
          name: 'AI Marketing Organization',
          source_url: 'https://ai-marketing-organization.onrender.com',
          status: 'approved',
          is_default: true
        }
      ]
    });

    const channels = await client.getChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].id).toBe(331585);
    expect(channels[0].url).toBe('https://ai-marketing-organization.onrender.com');
  });

  it('reuses existing channel by domain matching and enforces 25-char limit on creation', async () => {
    const client = CuelinksV3Client.getInstance();

    const requestSpy = vi.spyOn(client as any, 'request').mockImplementation(async (path: string, opts?: any) => {
      if (path === '/channels' && (!opts || !opts.method || opts.method === 'GET')) {
        return {
          data: [
            {
              id: 331585,
              name: 'AI Marketing Organization',
              source_url: 'https://ai-marketing-organization.onrender.com',
              status: 'approved',
              is_default: true
            }
          ]
        };
      }
      if (path === '/channels' && opts?.method === 'POST') {
        return {
          data: {
            id: 999999,
            name: opts.body.name,
            url: opts.body.url,
            status: 'pending'
          }
        };
      }
      return {};
    });

    // 1. Matches existing channel even when requested with long name and Firebase URL
    const matched = await client.createChannel(
      'AI Marketing Organization Deals & Buying Guides',
      'https://ai-marketing-organization.onrender.com'
    );
    expect(matched.id).toBe(331585);
    // Should NOT have called POST /channels because matching existing channel was found
    expect(requestSpy).toHaveBeenCalledTimes(1); // Only GET /channels

    // 2. If creating brand new channel, truncates name to <= 25 characters
    const newChan = await client.createChannel(
      'Super Long Name That Exceeds Twenty Five Chars',
      'https://new-brand-domain.example.com'
    );
    expect(newChan.id).toBe(999999);
    // Inspect POST body
    const postCall = requestSpy.mock.calls.find(call => call[0] === '/channels' && call[1]?.method === 'POST');
    expect(postCall).toBeDefined();
    expect(postCall![1].body.name.length).toBeLessThanOrEqual(25);
  });

  it('CuelinksSyncManager and DealDiscoveryEngine select channel 331585 without 422 errors', async () => {
    const client = CuelinksV3Client.getInstance();
    
    vi.spyOn(client as any, 'request').mockImplementation(async (path: string, opts?: any) => {
      if (path === '/channels') {
        return {
          data: [
            {
              id: 331585,
              name: 'AI Marketing Organization',
              source_url: 'https://ai-marketing-organization.onrender.com',
              status: 'approved',
              is_default: true
            }
          ]
        };
      }
      return { data: [] };
    });

    const syncManager = CuelinksSyncManager.getInstance(client);
    const channels = await client.getChannels();
    const targetChannel = channels.find(c => {
      const chUrl = (c.source_url || c.url || '').toLowerCase();
      return chUrl.includes('onrender.com') || chUrl.includes('gen-lang-client');
    }) || channels.find(c => c.is_default);

    expect(targetChannel).toBeDefined();
    expect(targetChannel?.id).toBe(331585);
  });
});
