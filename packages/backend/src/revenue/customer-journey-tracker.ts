import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  CustomerJourneyRecord,
  CustomerJourneyStage,
  CustomerTouchpoint,
  DataClassification,
  MarketingChannel,
} from '@ai-marketing/shared';

const STAGE_ORDER: Record<CustomerJourneyStage, number> = {
  VISITOR: 1,
  SESSION: 2,
  LEAD: 3,
  QUALIFIED_LEAD: 4,
  OPPORTUNITY: 5,
  CUSTOMER: 6,
  CHURNED: 7,
};

export class CustomerJourneyTracker {
  private get db() {
    return getDb();
  }

  getOrCreateJourney(
    businessId: string,
    visitorId: string,
    classification: DataClassification = 'TEST',
    organizationId = 'org-india-1'
  ): CustomerJourneyRecord {
    const existing = this.db
      .prepare('SELECT * FROM customer_journeys WHERE business_id = ? AND visitor_id = ?')
      .get(businessId, visitorId) as any;

    if (existing) {
      return this.mapRow(existing);
    }

    const id = `journey-${randomUUID()}`;
    const now = new Date().toISOString();
    const touchpoints: CustomerTouchpoint[] = [];

    this.db
      .prepare(
        `INSERT INTO customer_journeys (
          id, organization_id, business_id, visitor_id,
          stage, touchpoints_json, total_lifetime_value_inr,
          classification, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        organizationId,
        businessId,
        visitorId,
        'VISITOR',
        JSON.stringify(touchpoints),
        0,
        classification,
        now,
        now
      );

    return {
      id,
      organizationId,
      businessId,
      visitorId,
      stage: 'VISITOR',
      touchpoints,
      totalLifetimeValueINR: 0,
      classification,
      createdAt: now,
      updatedAt: now,
    };
  }

  recordTouchpoint(params: {
    businessId: string;
    visitorId: string;
    channel: MarketingChannel;
    event: string;
    campaignId?: string;
    metadata?: Record<string, unknown>;
    classification?: DataClassification;
    organizationId?: string;
  }): CustomerJourneyRecord {
    const journey = this.getOrCreateJourney(
      params.businessId,
      params.visitorId,
      params.classification ?? 'TEST',
      params.organizationId
    );

    const touchpoint: CustomerTouchpoint = {
      channel: params.channel,
      campaignId: params.campaignId,
      timestamp: new Date().toISOString(),
      event: params.event,
      metadata: params.metadata,
    };

    const touchpoints = [...journey.touchpoints, touchpoint];
    const firstTouch = journey.firstTouchChannel || params.channel;
    const lastTouch = params.channel;
    const now = new Date().toISOString();

    // Auto-advance stage based on event if appropriate
    let newStage = journey.stage;
    if (
      (params.event.includes('visit') || params.event.includes('click') || params.event.includes('session')) &&
      STAGE_ORDER[journey.stage] < STAGE_ORDER['SESSION']
    ) {
      newStage = 'SESSION';
    } else if (
      (params.event.includes('lead') ||
        params.event.includes('inquiry') ||
        params.event.includes('inquire') ||
        params.event.includes('signup') ||
        params.event.includes('contact')) &&
      STAGE_ORDER[journey.stage] < STAGE_ORDER['LEAD']
    ) {
      newStage = 'LEAD';
    } else if (params.event.includes('qualified') && STAGE_ORDER[journey.stage] < STAGE_ORDER['QUALIFIED_LEAD']) {
      newStage = 'QUALIFIED_LEAD';
    } else if (params.event.includes('appointment') && STAGE_ORDER[journey.stage] < STAGE_ORDER['OPPORTUNITY']) {
      newStage = 'OPPORTUNITY';
    } else if (params.event.includes('purchase') || params.event.includes('revenue')) {
      newStage = 'CUSTOMER';
    }

    this.db
      .prepare(
        `UPDATE customer_journeys SET
          first_touch_channel = ?,
          last_touch_channel = ?,
          stage = ?,
          touchpoints_json = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(firstTouch, lastTouch, newStage, JSON.stringify(touchpoints), now, journey.id);

    return {
      ...journey,
      firstTouchChannel: firstTouch,
      lastTouchChannel: lastTouch,
      stage: newStage,
      touchpoints,
      updatedAt: now,
    };
  }

  advanceStage(params: {
    businessId: string;
    visitorId: string;
    targetStage: CustomerJourneyStage;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    classification?: DataClassification;
  }): CustomerJourneyRecord {
    const journey = this.getOrCreateJourney(
      params.businessId,
      params.visitorId,
      params.classification ?? 'TEST'
    );

    const now = new Date().toISOString();
    const customerName = params.customerName || journey.customerName;
    const customerPhone = params.customerPhone || journey.customerPhone;
    const customerEmail = params.customerEmail || journey.customerEmail;

    this.db
      .prepare(
        `UPDATE customer_journeys SET
          stage = ?,
          customer_name = ?,
          customer_phone = ?,
          customer_email = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(params.targetStage, customerName, customerPhone, customerEmail, now, journey.id);

    return {
      ...journey,
      stage: params.targetStage,
      customerName,
      customerPhone,
      customerEmail,
      updatedAt: now,
    };
  }

  addRevenue(journeyId: string, amountINR: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE customer_journeys SET
          total_lifetime_value_inr = total_lifetime_value_inr + ?,
          stage = 'CUSTOMER',
          updated_at = ?
        WHERE id = ?`
      )
      .run(amountINR, now, journeyId);
  }

  subtractRevenue(journeyId: string, amountINR: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE customer_journeys SET
          total_lifetime_value_inr = MAX(0, total_lifetime_value_inr - ?),
          updated_at = ?
        WHERE id = ?`
      )
      .run(amountINR, now, journeyId);
  }

  recordRealLead(params: {
    businessId: string;
    organizationId?: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    channel: MarketingChannel;
    campaignId?: string;
    source?: string;
    serviceOfInterest?: string;
    notes?: string;
  }): CustomerJourneyRecord {
    const visitorId = `vis_real_${randomUUID().slice(0, 8)}`;
    const orgId = params.organizationId || 'org_smilekraft_01';
    
    // 1. Initialize journey in REAL mode
    this.getOrCreateJourney(params.businessId, visitorId, 'REAL', orgId);

    // 2. Add lead submission touchpoint
    this.recordTouchpoint({
      businessId: params.businessId,
      visitorId,
      channel: params.channel,
      event: 'public_lead_submission',
      campaignId: params.campaignId,
      metadata: {
        source: params.source || 'direct_landing_page',
        serviceOfInterest: params.serviceOfInterest,
        notes: params.notes
      },
      classification: 'REAL',
      organizationId: orgId
    });

    // 3. Advance to LEAD with verified contact info
    return this.advanceStage({
      businessId: params.businessId,
      visitorId,
      targetStage: 'LEAD',
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      customerEmail: params.customerEmail,
      classification: 'REAL'
    });
  }

  getJourneyFunnel(
    businessId: string,
    classification?: DataClassification
  ): Record<CustomerJourneyStage, number> {
    const funnel: Record<CustomerJourneyStage, number> = {
      VISITOR: 0,
      SESSION: 0,
      LEAD: 0,
      QUALIFIED_LEAD: 0,
      OPPORTUNITY: 0,
      CUSTOMER: 0,
      CHURNED: 0,
    };

    let sql = `SELECT stage, COUNT(*) as count FROM customer_journeys WHERE business_id = ?`;
    const args: any[] = [businessId];

    if (classification) {
      sql += ` AND classification = ?`;
      args.push(classification);
    }
    sql += ` GROUP BY stage`;

    const rows = this.db.prepare(sql).all(...args) as Array<{ stage: CustomerJourneyStage; count: number }>;
    for (const row of rows) {
      if (funnel[row.stage] !== undefined) {
        funnel[row.stage] = row.count;
      }
    }

    return funnel;
  }

  listJourneys(
    businessId: string,
    options: {
      classification?: DataClassification;
      stage?: CustomerJourneyStage;
      limit?: number;
    } = {}
  ): CustomerJourneyRecord[] {
    let sql = `SELECT * FROM customer_journeys WHERE business_id = ?`;
    const args: any[] = [businessId];

    if (options.classification) {
      sql += ` AND classification = ?`;
      args.push(options.classification);
    }

    if (options.stage) {
      sql += ` AND stage = ?`;
      args.push(options.stage);
    }

    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    args.push(options.limit || 50);

    const rows = this.db.prepare(sql).all(...args) as any[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: any): CustomerJourneyRecord {
    return {
      id: row.id,
      organizationId: row.organization_id,
      businessId: row.business_id,
      visitorId: row.visitor_id,
      customerName: row.customer_name || undefined,
      customerPhone: row.customer_phone || undefined,
      customerEmail: row.customer_email || undefined,
      stage: row.stage as CustomerJourneyStage,
      firstTouchChannel: row.first_touch_channel || undefined,
      lastTouchChannel: row.last_touch_channel || undefined,
      touchpoints: JSON.parse(row.touchpoints_json || '[]'),
      totalLifetimeValueINR: row.total_lifetime_value_inr,
      classification: row.classification as DataClassification,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
