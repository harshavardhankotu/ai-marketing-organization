import { getDb } from '../db/client.js';
import {
  AttributionEvidenceRecord,
  AttributionHierarchyLevel,
  GoogleClickRecord,
} from '@ai-marketing/shared';

export class AttributionEvidenceEngine {
  private get db() {
    return getDb();
  }

  /**
   * Builds an inspectable AttributionEvidenceRecord for a given customer journey
   * strictly following the 4-level provenance hierarchy:
   * Level 1: VERIFIED_GCLID (Google Ads API click_view match) -> MATCHED
   * Level 2: CAMPAIGN_CORRELATION (Session time-window ±30m correlation) -> MATCHED
   * Level 3: UTM_ONLY (URL parameters only, no click_view evidence) -> UNVERIFIED
   * Level 4: UNKNOWN (Direct, organic, or untracked) -> NOT_ATTRIBUTED
   */
  public getEvidenceForJourney(journeyId: string): AttributionEvidenceRecord {
    const journey = this.db
      .prepare('SELECT * FROM customer_journeys WHERE id = ?')
      .get(journeyId) as any;

    if (!journey) {
      return {
        source: 'UNKNOWN',
        visitor: 'UNKNOWN',
        verificationStatus: 'NOT_ATTRIBUTED',
        hierarchyLevel: 'LEVEL_4_UNKNOWN',
        rationale: `Journey ${journeyId} not found in database`,
      };
    }

    // Check linked transaction if available
    const tx = this.db
      .prepare("SELECT id, amount_inr, invoice_number FROM transactions WHERE journey_id = ? AND status = 'SUCCESS' LIMIT 1")
      .get(journeyId) as any;

    // Check linked appointment if available
    const appt = this.db
      .prepare('SELECT id FROM appointments WHERE journey_id = ? LIMIT 1')
      .get(journeyId) as any;

    // Parse touchpoints
    let touchpoints: any[] = [];
    try {
      touchpoints = JSON.parse(journey.touchpoints_json || '[]');
    } catch {
      touchpoints = [];
    }

    const firstTouch = touchpoints[0] || {};
    const campaignId = firstTouch.campaignId || undefined;
    const session = firstTouch.sessionId || undefined;

    // LEVEL 1: Check if GCLID exists and matches google_clicks click_view table
    if (journey.gclid) {
      const clickRow = this.db
        .prepare('SELECT * FROM google_clicks WHERE gclid = ?')
        .get(journey.gclid) as any;

      if (clickRow) {
        const clickEvidence: GoogleClickRecord = {
          gclid: clickRow.gclid,
          customerId: clickRow.customer_id,
          campaignId: clickRow.campaign_id,
          campaignName: clickRow.campaign_name,
          adGroupId: clickRow.ad_group_id || undefined,
          keyword: clickRow.keyword || undefined,
          device: clickRow.device || undefined,
          clickType: clickRow.click_type || undefined,
          clickTimestamp: clickRow.click_timestamp,
          verificationSource: clickRow.verification_source,
          createdAt: clickRow.created_at || clickRow.click_timestamp,
        };

        return {
          source: 'GOOGLE_ADS',
          campaign: clickRow.campaign_id,
          gclid: journey.gclid,
          clickEvidence,
          session,
          visitor: journey.visitor_id,
          lead: journey.id,
          customer: journey.stage === 'CUSTOMER' ? journey.id : undefined,
          transaction: tx ? tx.id : undefined,
          verificationStatus: 'MATCHED',
          hierarchyLevel: 'LEVEL_1_VERIFIED_GCLID',
          verificationTimestamp: clickRow.created_at,
          rationale: `Verified Level-1 GCLID match in Google Ads click_view registry for GCLID ${journey.gclid} (Campaign: ${clickRow.campaign_name}, Time: ${clickRow.click_timestamp})`,
        };
      }
    }

    // LEVEL 2: Session Correlation within ±30 minutes
    if (campaignId && journey.created_at) {
      const journeyTime = new Date(journey.created_at).getTime();
      const windowMs = 30 * 60 * 1000; // ±30 minutes
      const minTime = new Date(journeyTime - windowMs).toISOString();
      const maxTime = new Date(journeyTime + windowMs).toISOString();

      const correlatedClick = this.db
        .prepare(
          'SELECT * FROM google_clicks WHERE campaign_id = ? AND click_timestamp >= ? AND click_timestamp <= ? LIMIT 1'
        )
        .get(campaignId, minTime, maxTime) as any;

      if (correlatedClick) {
        const clickEvidence: GoogleClickRecord = {
          gclid: correlatedClick.gclid,
          customerId: correlatedClick.customer_id,
          campaignId: correlatedClick.campaign_id,
          campaignName: correlatedClick.campaign_name,
          adGroupId: correlatedClick.ad_group_id || undefined,
          keyword: correlatedClick.keyword || undefined,
          device: correlatedClick.device || undefined,
          clickType: correlatedClick.click_type || undefined,
          clickTimestamp: correlatedClick.click_timestamp,
          verificationSource: correlatedClick.verification_source,
          createdAt: correlatedClick.created_at || correlatedClick.click_timestamp,
        };

        return {
          source: 'GOOGLE_ADS',
          campaign: campaignId,
          gclid: correlatedClick.gclid,
          clickEvidence,
          session,
          visitor: journey.visitor_id,
          lead: journey.id,
          customer: journey.stage === 'CUSTOMER' ? journey.id : undefined,
          transaction: tx ? tx.id : undefined,
          verificationStatus: 'MATCHED',
          hierarchyLevel: 'LEVEL_2_CAMPAIGN_CORRELATION',
          verificationTimestamp: new Date().toISOString(),
          rationale: `Verified Level-2 session correlation within ±30 minutes for Campaign ${campaignId}`,
        };
      }
    }

    // LEVEL 3: UTM-only parameter presence (Strictly UNVERIFIED!)
    const hasUtm = touchpoints.some(
      (t) => t.source || t.channel === 'GOOGLE_SEARCH' || t.utmSource || t.utmCampaign
    ) || journey.first_touch_channel === 'GOOGLE_SEARCH';

    if (hasUtm || journey.gclid) {
      return {
        source: firstTouch.source || journey.first_touch_channel || 'GOOGLE_SEARCH',
        campaign: campaignId,
        gclid: journey.gclid || undefined,
        session,
        visitor: journey.visitor_id,
        lead: journey.id,
        customer: journey.stage === 'CUSTOMER' ? journey.id : undefined,
        transaction: tx ? tx.id : undefined,
        verificationStatus: 'UNVERIFIED',
        hierarchyLevel: 'LEVEL_3_UTM_ONLY',
        rationale: `Level-3 UTM parameter detected (${journey.first_touch_channel || 'GOOGLE_SEARCH'}) without verified Google Ads click_view evidence. Marked strictly UNVERIFIED.`,
      };
    }

    // LEVEL 4: Direct, Organic, or Untracked
    return {
      source: journey.first_touch_channel || 'DIRECT',
      visitor: journey.visitor_id,
      lead: journey.id,
      customer: journey.stage === 'CUSTOMER' ? journey.id : undefined,
      transaction: tx ? tx.id : undefined,
      verificationStatus: 'NOT_ATTRIBUTED',
      hierarchyLevel: 'LEVEL_4_UNKNOWN',
      rationale: 'Level-4 direct or untracked journey with no verified ad campaign provenance.',
    };
  }

  /**
   * Evaluates if attribution credit can be truthfully claimed based on the evidence record.
   */
  public evaluateAttribution(evidence: AttributionEvidenceRecord): {
    isAttributed: boolean;
    confidence: number;
    rationale: string;
  } {
    switch (evidence.hierarchyLevel) {
      case 'LEVEL_1_VERIFIED_GCLID':
        return {
          isAttributed: true,
          confidence: 1.0,
          rationale: `Attributed via Level-1 Verified GCLID (${evidence.gclid})`,
        };
      case 'LEVEL_2_CAMPAIGN_CORRELATION':
        return {
          isAttributed: true,
          confidence: 0.85,
          rationale: `Attributed via Level-2 Campaign Correlation (${evidence.campaign})`,
        };
      case 'LEVEL_3_UTM_ONLY':
        return {
          isAttributed: false,
          confidence: 0.0,
          rationale:
            'Attribution rejected: Level-3 UTM parameters alone cannot confer verified revenue attribution without click_view confirmation.',
        };
      case 'LEVEL_4_UNKNOWN':
      default:
        return {
          isAttributed: false,
          confidence: 0.0,
          rationale: 'Attribution rejected: Direct, organic, or unknown source.',
        };
    }
  }
}
