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

    const guideCategory = publishedGuide.category || 'General';
    const guideTitle = publishedGuide.title || 'Commercial Hardware';

    // Check for real buyer questions in demand_signals for this category
    const buyerSignals = this.getCategoryBuyerQuestions(organizationId, guideCategory);

    const drafts: ShareKitDraft[] = [];
    if (buyerSignals.length > 0) {
      for (const sig of buyerSignals.slice(0, 3)) {
        drafts.push({
          questionText: sig.topic || `How to choose the best ${guideCategory} in India?`,
          sourceContext: `Verified buyer inquiry in ${guideCategory}`,
          draftAnswer: `When selecting ${guideTitle}, key evaluation criteria include verified technical specifications, compatibility, and real-world durability for users in India. We compiled an objective comparison and comprehensive review here: ${cleanGuideUrl}`,
          guideUrl: cleanGuideUrl
        });
      }
    } else {
      // Dynamic category-based questions
      drafts.push(
        {
          questionText: `What are the key specifications to verify when buying ${guideTitle} in India?`,
          sourceContext: `Category comparison: ${guideCategory}`,
          draftAnswer: `Key factors include verified manufacturer specifications, real-world duty cycles, and local service support. Check our independent, specification-backed comparison guide: ${cleanGuideUrl}`,
          guideUrl: cleanGuideUrl
        },
        {
          questionText: `How does ${guideTitle} compare with alternatives in ${guideCategory}?`,
          sourceContext: `Market comparison: ${guideCategory}`,
          draftAnswer: `Performance, connectivity options, and long-term operating costs vary significantly across brands. Review our detailed side-by-side analysis: ${cleanGuideUrl}`,
          guideUrl: cleanGuideUrl
        }
      );
    }

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
      ORDER BY updated_at DESC, created_at DESC
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

  private getCategoryBuyerQuestions(organizationId: string, category: string): any[] {
    const sql = `
      SELECT topic, raw_query FROM demand_signals
      WHERE organization_id = ?
        AND signal_type = 'BUYER_QUESTION'
        AND lower(category) = lower(?)
      LIMIT 3;
    `;
    try {
      return getDb().prepare(sql).all(organizationId, category) as any[];
    } catch {
      return [];
    }
  }
}
