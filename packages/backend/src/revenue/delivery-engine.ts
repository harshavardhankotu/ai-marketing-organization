/**
 * DeliveryEngine — Manages the post-payment customer fulfillment lifecycle and retention loops.
 *
 * Implements Spec § 14 & § 15:
 * - Lifecycle:
 *     PAYMENT_VERIFIED -> CUSTOMER_ACTIVATION -> ONBOARDING -> CONFIGURATION -> SERVICE_EXECUTION -> RESULT_MEASUREMENT -> CUSTOMER_REPORT -> RETENTION -> UPSELL / REFERRAL
 * - Action classification:
 *     Internal configuration, checklist creation, task progression = INTERNAL_AUTOMATION.
 *     External customer notifications (e.g. WhatsApp review link) = LIVE_EXTERNAL_ACTION if live, BLOCKED_AUTHORIZATION if unconfigured.
 * - Referral loop: Delighted customers automatically enter the referral and review request funnel.
 * - Persistence: Cloudflare D1 authoritative in production, SQLite in dev/test. Zero getDb() import.
 */

import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';
import { ActionClassification, WhatsAppAdapter } from '../integrations/adapter-base.js';
import { DurableEventBus } from './durable-event-bus.js';

export type DeliveryStage =
  | 'CUSTOMER_ACTIVATION'
  | 'ONBOARDING'
  | 'CONFIGURATION'
  | 'SERVICE_EXECUTION'
  | 'RESULT_MEASUREMENT'
  | 'CUSTOMER_REPORT'
  | 'RETENTION'
  | 'COMPLETED';

export interface ActivateCustomerInput {
  organizationId: string;
  businessId: string;
  customerJourneyId: string;
  serviceType: string;
  paidAmountINR: number;
}

export interface DeliveryExecutionResult {
  taskId: string;
  customerJourneyId: string;
  stage: DeliveryStage;
  actionClassification: ActionClassification;
  message: string;
}

export class DeliveryEngine {
  private static instance: DeliveryEngine;
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): DeliveryEngine {
    if (!DeliveryEngine.instance) {
      DeliveryEngine.instance = new DeliveryEngine();
    }
    return DeliveryEngine.instance;
  }

  /**
   * Resolves service-specific deliverables rather than forcing healthcare/patient tasks onto all businesses.
   */
  public static getDeliverablesForService(serviceType: string): string[] {
    const normalized = (serviceType || '').toUpperCase().trim();
    if (normalized === 'PLATFORM_SETUP' || normalized === 'AI_LEAD_CONVERSION_SETUP') {
      return [
        'Custom WhatsApp triage and FAQ response bot',
        'Google Business Profile instant lead capture',
        'Multi-touch follow-up workflow',
        'Direct calendar booking integration',
        'Live system handover report'
      ];
    }
    if (normalized === 'PLATFORM_MONTHLY' || normalized === 'AI_LEAD_CONVERSION_MONTHLY') {
      return [
        '24/7 automated lead response under 2 minutes',
        'Ongoing prompt & qualification rubric tuning',
        'Weekly appointment show-rate reporting',
        'Continuous DPDP compliance monitoring'
      ];
    }
    if (normalized === 'CLINICAL' || normalized === 'DENTAL_CARE' || normalized === 'PATIENT_CARE') {
      return [
        'Welcome pack and patient orientation checklist',
        'Clinical consultation and digital scan schedule setup',
        'Dedicated care coordinator assignment'
      ];
    }
    return [
      'Client onboarding intake and service scope definition',
      'System configuration and integration setup',
      'Handover documentation and live verification review'
    ];
  }

  /**
   * Activates fulfillment asynchronously (production-safe Cloudflare D1 execution).
   */
  public async activateCustomerAsync(input: ActivateCustomerInput): Promise<DeliveryExecutionResult> {
    const taskId = `deliv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const deliverables = DeliveryEngine.getDeliverablesForService(input.serviceType);

    try {
      await this.d1Repo.executeWrite(
        'delivery_tasks',
        `INSERT INTO delivery_tasks (
          id, organization_id, business_id, customer_journey_id,
          service_type, stage, deliverables_json, results_json,
          action_classification, created_at
        ) VALUES (?, ?, ?, ?, ?, 'ONBOARDING', ?, '{}', 'INTERNAL_AUTOMATION', datetime('now'))`,
        [
          taskId,
          input.organizationId,
          input.businessId,
          input.customerJourneyId,
          input.serviceType,
          JSON.stringify(deliverables)
        ]
      );

      const wfId = `wf_deliv_${Date.now()}`;
      try {
        await this.d1Repo.executeWrite(
          'workflows',
          `INSERT INTO workflows (id, organization_id, business_id, workflow_type, status, current_step)
           VALUES (?, ?, ?, 'CUSTOMER_DELIVERY', 'RUNNING', 'ONBOARDING')`,
          [wfId, input.organizationId, input.businessId]
        );

        await this.d1Repo.executeWrite(
          'tasks',
          `INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key, created_at)
           VALUES (?, ?, ?, 'delivery-agent', ?, 'IN_PROGRESS', ?, datetime('now'))`,
          [taskId, input.organizationId, wfId, `Fulfillment for journey ${input.customerJourneyId}`, taskId]
        );
      } catch {}

      await this.d1Repo.executeWrite(
        'customer_journeys',
        `UPDATE customer_journeys
         SET stage = 'ACTIVE', updated_at = datetime('now')
         WHERE id = ?`,
        [input.customerJourneyId]
      );

      await DurableEventBus.emitAsync({
        eventType: 'CUSTOMER_CREATED',
        organizationId: input.organizationId,
        businessId: input.businessId,
        payload: { customerJourneyId: input.customerJourneyId, taskId, serviceType: input.serviceType }
      });

      return {
        taskId,
        customerJourneyId: input.customerJourneyId,
        stage: 'ONBOARDING',
        actionClassification: 'INTERNAL_AUTOMATION',
        message: `Customer delivery initialized. Deliverables queued under taskId ${taskId}.`
      };
    } catch (err: any) {
      return {
        taskId,
        customerJourneyId: input.customerJourneyId,
        stage: 'CUSTOMER_ACTIVATION',
        actionClassification: 'INTERNAL_AUTOMATION',
        message: `Fulfillment activation failed: ${err.message}`
      };
    }
  }

  /**
   * Activates fulfillment when a verified payment is received.
   * Synchronous for dev/test runners; forwards or fails closed in production.
   */
  public activateCustomer(input: ActivateCustomerInput): DeliveryExecutionResult {
    if (isProduction()) {
      throw new Error('PRODUCTION D1 ERROR: Synchronous activateCustomer is not permitted in production. Use activateCustomerAsync.');
    }

    const taskId = `deliv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const deliverables = DeliveryEngine.getDeliverablesForService(input.serviceType);

    try {
      this.d1Repo.executeSync(
        'delivery_tasks',
        `INSERT INTO delivery_tasks (
          id, organization_id, business_id, customer_journey_id,
          service_type, stage, deliverables_json, results_json,
          action_classification, created_at
        ) VALUES (?, ?, ?, ?, ?, 'ONBOARDING', ?, '{}', 'INTERNAL_AUTOMATION', datetime('now'))`,
        [
          taskId,
          input.organizationId,
          input.businessId,
          input.customerJourneyId,
          input.serviceType,
          JSON.stringify(deliverables)
        ]
      );

      // Create workflow and task entries for tracking
      const wfId = `wf_deliv_${Date.now()}`;
      try {
        this.d1Repo.executeSync(
          'workflows',
          `INSERT INTO workflows (id, organization_id, business_id, workflow_type, status, current_step)
           VALUES (?, ?, ?, 'CUSTOMER_DELIVERY', 'RUNNING', 'ONBOARDING')`,
          [wfId, input.organizationId, input.businessId]
        );

        this.d1Repo.executeSync(
          'tasks',
          `INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key, created_at)
           VALUES (?, ?, ?, 'delivery-agent', ?, 'IN_PROGRESS', ?, datetime('now'))`,
          [taskId, input.organizationId, wfId, `Fulfillment for journey ${input.customerJourneyId}`, taskId]
        );
      } catch {}

      // Advance customer journey stage to ACTIVE
      this.d1Repo.executeSync(
        'customer_journeys',
        `UPDATE customer_journeys
         SET stage = 'ACTIVE', updated_at = datetime('now')
         WHERE id = ?`,
        [input.customerJourneyId]
      );

      DurableEventBus.emit({
        eventType: 'CUSTOMER_CREATED',
        organizationId: input.organizationId,
        businessId: input.businessId,
        payload: { customerJourneyId: input.customerJourneyId, taskId, serviceType: input.serviceType }
      });

      return {
        taskId,
        customerJourneyId: input.customerJourneyId,
        stage: 'ONBOARDING',
        actionClassification: 'INTERNAL_AUTOMATION',
        message: `Customer delivery initialized. Deliverables queued under taskId ${taskId}.`
      };
    } catch (err: any) {
      return {
        taskId,
        customerJourneyId: input.customerJourneyId,
        stage: 'CUSTOMER_ACTIVATION',
        actionClassification: 'INTERNAL_AUTOMATION',
        message: `Fulfillment activation failed: ${err.message}`
      };
    }
  }

  /**
   * Dispatches review & referral request for retained customers (§ 15).
   */
  public async requestReferralAndReview(
    organizationId: string,
    businessId: string,
    customerJourneyId: string
  ): Promise<{ success: boolean; actionClassification: ActionClassification; message: string }> {
    const customer = isProduction()
      ? await this.d1Repo.queryOne('customer_journeys', `SELECT * FROM customer_journeys WHERE id = ?`, [customerJourneyId])
      : this.d1Repo.queryOneSync('customer_journeys', `SELECT * FROM customer_journeys WHERE id = ?`, [customerJourneyId]);

    const biz = isProduction()
      ? await this.d1Repo.queryOne('businesses', `SELECT * FROM businesses WHERE id = ?`, [businessId])
      : this.d1Repo.queryOneSync('businesses', `SELECT * FROM businesses WHERE id = ?`, [businessId]);

    if (!customer || !biz) {
      return {
        success: false,
        actionClassification: 'BLOCKED_AUTHORIZATION',
        message: 'Customer or business record not found'
      };
    }

    const wa = new WhatsAppAdapter();
    const health = await wa.checkHealth();

    if (!health.connected || health.mode !== 'LIVE') {
      return {
        success: false,
        actionClassification: 'BLOCKED_AUTHORIZATION',
        message: 'BLOCKED_AUTHORIZATION: No LIVE WhatsApp provider for referral outreach'
      };
    }

    const isClinical = (biz.vertical_id || biz.vertical || '').toLowerCase().includes('health') ||
      (biz.vertical_id || biz.vertical || '').toLowerCase().includes('clinic') ||
      (biz.vertical_id || biz.vertical || '').toLowerCase().includes('dental');
    const reviewTarget = isClinical ? 'other patients' : 'other businesses';
    const appreciation = isClinical ? 'with your care' : 'with your onboarding';
    const referralOffer = isClinical ? 'complimentary consultation' : 'complimentary strategy review';

    const pubResult = await wa.publish({
      title: `Review request from ${biz.name}`,
      body: `Hi ${customer.customer_name || 'there'}! Thank you for trusting ${biz.name} ${appreciation}. Would you mind sharing a quick 1-minute review on Google to help ${reviewTarget}? You can also refer a colleague for a ${referralOffer}!`,
      channel: 'WHATSAPP',
      recipientPhone: customer.customer_phone
    });

    if (pubResult.success && pubResult.actionClassification === 'LIVE_EXTERNAL_ACTION') {
      const sql = `
        INSERT INTO review_requests (
          id, business_id, customer_id, journey_id, appointment_id,
          clinic_confirmation, channel, status, external_review_platform, created_at
        ) VALUES (?, ?, ?, ?, 'app_referral', 'CONFIRMED', 'WHATSAPP', 'QUEUED', 'GOOGLE_MAPS', datetime('now'))
      `;
      const params = [`rr_${Date.now()}`, businessId, customer.id, customerJourneyId];

      try {
        if (isProduction()) {
          await this.d1Repo.executeWrite('review_requests', sql, params);
        } else {
          this.d1Repo.executeSync('review_requests', sql, params);
        }
      } catch {}

      return {
        success: true,
        actionClassification: 'LIVE_EXTERNAL_ACTION',
        message: `Referral and review request dispatched via WhatsApp (${pubResult.externalId})`
      };
    }

    return {
      success: false,
      actionClassification: pubResult.actionClassification,
      message: pubResult.message
    };
  }

  /**
   * Stage I.2 (P3): Verified Fulfillment Bridge.
   * Provisioning MUST ONLY run for RAZORPAY_CAPTURED or HUMAN_VERIFIED_PAYMENT (never unverified PAYMENT_CLAIMED).
   * Persists a durable D1 delivery_tasks row, advances journey/pipeline to FULFILLED, records positive
   * CommercialLearningEngine outcome, and awaits DurableEventBus ('ORDER_FULFILLED').
   */
  public async provisionVerifiedOrderFulfillment(input: {
    organizationId: string;
    businessId: string;
    customerJourneyId?: string;
    orderId?: string;
    claimId?: string;
    paymentId?: string;
    sku: string;
    serviceType?: string;
    amountINR: number;
    verificationSource: 'RAZORPAY_CAPTURED' | 'HUMAN_VERIFIED_PAYMENT';
    isDiagnostic?: boolean;
  }): Promise<{
    provisioned: boolean;
    taskId?: string;
    journeyId?: string;
    learningRecorded: boolean;
    stage: string;
    deliverables: string[];
  }> {
    if (input.verificationSource !== 'RAZORPAY_CAPTURED' && input.verificationSource !== 'HUMAN_VERIFIED_PAYMENT') {
      throw new Error(`FULFILLMENT_BLOCKED_UNVERIFIED_PAYMENT: Verification source '${input.verificationSource}' is not verified.`);
    }

    const useD1 = isProduction() && !process.env.VITEST;
    const skuNorm = String(input.sku || input.serviceType || 'SITEFIX_CORE_499').toUpperCase();
    const deliverables = skuNorm.includes('SITEFIX')
      ? [
          'Technical SEO, Schema.org & Core Web Vitals Fix-Pack Report',
          'JSON-LD Structured Data & Canonical Patch Bundle',
          'Post-Fix Indexability & Sitemap Verification Checklist'
        ]
      : DeliveryEngine.getDeliverablesForService(skuNorm);

    const refKey = (input.claimId || input.orderId || input.paymentId || `${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
    const taskId = `deliv_${refKey}`;
    let journeyId = input.customerJourneyId || '';

    const runQueryOne = async (table: string, sql: string, params: any[]) =>
      useD1 ? await this.d1Repo.queryOne<any>(table, sql, params) : this.d1Repo.queryOneSync<any>(table, sql, params);
    const runWrite = async (table: string, sql: string, params: any[]) =>
      useD1 ? await this.d1Repo.executeWrite(table, sql, params) : this.d1Repo.executeSync(table, sql, params);

    // 1. Resolve or ensure an existing customer_journeys FK target
    if (journeyId) {
      const exists = await runQueryOne('customer_journeys', 'SELECT id FROM customer_journeys WHERE id = ?', [journeyId]);
      if (!exists) journeyId = '';
    }
    if (!journeyId && input.claimId) {
      try {
        const claim = await runQueryOne('manual_upi_claims', 'SELECT notes FROM manual_upi_claims WHERE id = ?', [input.claimId]);
        if (claim?.notes) {
          const parsedNotes = typeof claim.notes === 'string' ? JSON.parse(claim.notes) : claim.notes;
          if (parsedNotes?.journeyId) {
            const jRow = await runQueryOne('customer_journeys', 'SELECT id FROM customer_journeys WHERE id = ?', [String(parsedNotes.journeyId)]);
            if (jRow?.id) journeyId = String(jRow.id);
          }
        }
      } catch {}
    }
    if (!journeyId && input.orderId) {
      try {
        const payReq = await runQueryOne('payment_requests', 'SELECT lead_id, prospect_id FROM payment_requests WHERE id = ? OR reference_id = ?', [input.orderId, input.orderId]);
        const cand = payReq?.lead_id || payReq?.prospect_id;
        if (cand) {
          const jRow = await runQueryOne('customer_journeys', 'SELECT id FROM customer_journeys WHERE id = ? OR visitor_id = ?', [cand, cand]);
          if (jRow?.id) journeyId = String(jRow.id);
        }
      } catch {}
    }
    if (!journeyId) {
      journeyId = `cj_ord_${refKey}`;
      await runWrite(
        'customer_journeys',
        `INSERT OR IGNORE INTO customer_journeys (
          id, business_id, visitor_id, stage, first_touch_channel, last_touch_channel,
          conversion_probability, total_lifetime_value_inr, classification, created_at, updated_at
        ) VALUES (?, ?, ?, 'FULFILLED', 'WEB_DESK', 'PAYMENT_VERIFIED', 1.0, ?, 'REAL', datetime('now'), datetime('now'))`,
        [journeyId, input.businessId, `visitor_${refKey}`, Number(input.amountINR || 0)]
      );
    }

    // 2. Idempotently insert delivery_tasks record (never overwrites if already created)
    const resultsPayload = JSON.stringify({
      verificationSource: input.verificationSource,
      sku: input.sku,
      orderId: input.orderId || null,
      claimId: input.claimId || null,
      paymentId: input.paymentId || null,
      amountINR: Number(input.amountINR || 0),
      provisionedAt: new Date().toISOString()
    });

    await runWrite(
      'delivery_tasks',
      `INSERT OR IGNORE INTO delivery_tasks (
        id, organization_id, business_id, customer_journey_id,
        service_type, stage, deliverables_json, results_json,
        action_classification, created_at
      ) VALUES (?, ?, ?, ?, ?, 'FULFILLMENT_READY', ?, ?, 'INTERNAL_AUTOMATION', datetime('now'))`,
      [
        taskId,
        input.organizationId,
        input.businessId,
        journeyId,
        input.sku || input.serviceType || 'SITEFIX_CORE_499',
        JSON.stringify(deliverables),
        resultsPayload
      ]
    );

    // 3. Advance customer_journeys & sales_pipeline -> FULFILLED
    try {
      await runWrite(
        'customer_journeys',
        `UPDATE customer_journeys SET stage = 'FULFILLED', total_lifetime_value_inr = COALESCE(total_lifetime_value_inr, 0) + ?, updated_at = datetime('now') WHERE id = ?`,
        [Number(input.amountINR || 0), journeyId]
      );
      await runWrite(
        'sales_pipeline',
        `UPDATE sales_pipeline SET stage = 'FULFILLED', next_action = 'REQUEST_REVIEW', reason = ?, updated_at = datetime('now') WHERE journey_id = ?`,
        [`Fulfillment provisioned via ${input.verificationSource}`, journeyId]
      );
    } catch {}

    // 4. Record positive conversion signal in CommercialLearningEngine (skipped/marked diagnostic for test probes)
    let learningRecorded = false;
    if (!input.isDiagnostic) {
      try {
        const { CommercialLearningEngine } = await import('../commission/commercial-learning-engine.js');
        const evtType =
          input.verificationSource === 'HUMAN_VERIFIED_PAYMENT'
            ? 'BANK_CONFIRMED_CASH'
            : 'PAYMENT_CAPTURED_PENDING_SETTLEMENT';
        await CommercialLearningEngine.getInstance().recordCommercialEvent('SECTOR_E_SOFTWARE', {
          eventId: `fulfill_${refKey}`,
          eventType: evtType,
          cashINR: Number(input.amountINR || 0),
          evidenceRef: taskId,
          isDiagnostic: false,
          metadata: {
            sku: input.sku,
            verificationSource: input.verificationSource,
            journeyId
          }
        });
        learningRecorded = true;
      } catch {}
    }

    // 5. Emit awaited durable event ORDER_FULFILLED
    try {
      await DurableEventBus.emitAsync({
        eventType: 'ORDER_FULFILLED',
        organizationId: input.organizationId,
        businessId: input.businessId,
        payload: {
          taskId,
          journeyId,
          orderId: input.orderId || null,
          claimId: input.claimId || null,
          sku: input.sku,
          amountINR: Number(input.amountINR || 0),
          verificationSource: input.verificationSource
        }
      });
    } catch {}

    return {
      provisioned: true,
      taskId,
      journeyId,
      learningRecorded,
      stage: 'FULFILLMENT_READY',
      deliverables
    };
  }
}
