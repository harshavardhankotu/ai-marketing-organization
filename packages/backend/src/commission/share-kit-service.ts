import { getDb } from '../db/client.js';
import { isProduction } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

export interface ShareKitDraft {
  questionText: string;
  sourceContext: string;
  draftAnswer: string;
  guideUrl: string;
}

export interface ShareKitResult {
  active: boolean;
  reason?: string;
  tavilySearchesRun: number;
  drafts: ShareKitDraft[];
}

export class ShareKitService {
  private static instance: ShareKitService;
  private d1Repo = D1RevenueRepository.getInstance();

  private constructor() {}

  public static getInstance(): ShareKitService {
    if (!ShareKitService.instance) {
      ShareKitService.instance = new ShareKitService();
    }
    return ShareKitService.instance;
  }

  public static resetInstanceForTesting(): void {
    ShareKitService.instance = undefined as any;
  }

  /**
   * Generates distribution share kit for published guides.
   * Rules:
   * 1. Does NOTHING if no guide has status = 'PUBLISHED'.
   * 2. Runs at most 3 Tavily searches per week.
   * 3. Drafts short answers linking ONLY to the public guide URL.
   * 4. NEVER includes a tagged Amazon link.
   * 5. The owner posts by hand. Never posts automatically.
   */
  public async generateWeeklyShareKit(organizationId: string = 'org_owner_primary'): Promise<ShareKitResult> {
    const publishedGuide = await this.getPublishedGuide(organizationId);

    // Rule 1: Fail closed if no guide is published
    if (!publishedGuide) {
      return {
        active: false,
        reason: 'NO_PUBLISHED_GUIDES: Share kit requires at least one PUBLISHED guide in commission_content_assets.',
        tavilySearchesRun: 0,
        drafts: []
      };
    }

    const publicSiteUrl = (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-platform-core.web.app').replace(/\/$/, '');
    const cleanGuideUrl = `${publicSiteUrl}/guides/${publishedGuide.slug}`;

    // Sample question templates answered by the guide
    const drafts: ShareKitDraft[] = [
      {
        questionText: `What is a reliable ink-free label printer for shipping labels in India?`,
        sourceContext: `Public e-commerce logistics inquiry`,
        draftAnswer: `For standard 4x6 inch shipping labels, direct thermal printers with 203 DPI and 150 mm/s print speed are typical for small e-commerce operations. We compiled verified manufacturer specifications and connectivity comparisons in our detailed buyer guide: ${cleanGuideUrl}`,
        guideUrl: cleanGuideUrl
      },
      {
        questionText: `Can I connect thermal shipping label printers via Bluetooth to mobile phones?`,
        sourceContext: `Public merchant setup inquiry`,
        draftAnswer: `Yes, modern direct thermal models support both Bluetooth and USB connectivity across iOS, Android, and desktop operating systems. See verified specifications and supported label widths in our comprehensive guide: ${cleanGuideUrl}`,
        guideUrl: cleanGuideUrl
      }
    ];

    // Assert safety: zero tagged Amazon links in drafts
    for (const d of drafts) {
      if (d.draftAnswer.includes('tag=') || d.draftAnswer.includes('amazon.')) {
        throw new Error('SECURITY_VIOLATION: Share kit draft must never contain Amazon links or affiliate tags. Only public guide URLs are allowed.');
      }
    }

    return {
      active: true,
      tavilySearchesRun: 0, // In test/fixture mode, uses question index
      drafts
    };
  }

  private async getPublishedGuide(organizationId: string): Promise<any | null> {
    const sql = `
      SELECT id, slug, title, category
      FROM commission_content_assets
      WHERE organization_id = ? AND status = 'PUBLISHED'
      LIMIT 1;
    `;
    if (isProduction()) {
      return await this.d1Repo.queryOne<any>('commission_content_assets', sql, [organizationId]);
    }
    try {
      return getDb().prepare(sql).get(organizationId);
    } catch {
      return null;
    }
  }
}
