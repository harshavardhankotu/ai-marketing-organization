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
   * Activates fulfillment asynchronously (production-safe Cloudflare D1 execution).
   */
  public async activateCustomerAsync(input: ActivateCustomerInput): Promise<DeliveryExecutionResult> {
    const taskId = `deliv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const deliverables = [
      'Welcome pack and patient orientation checklist',
      'Clinical consultation and digital scan schedule setup',
      'Dedicated care coordinator assignment'
    ];

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
    const deliverables = [
      'Welcome pack and patient orientation checklist',
      'Clinical consultation and digital scan schedule setup',
      'Dedicated care coordinator assignment'
    ];

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

    const pubResult = await wa.publish({
      title: `Review request from ${biz.name}`,
      body: `Hi ${customer.customer_name || 'there'}! Thank you for trusting ${biz.name} with your care. Would you mind sharing a quick 1-minute review on Google to help other patients? You can also refer a friend for a complimentary consultation!`,
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
}
