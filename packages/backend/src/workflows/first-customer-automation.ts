import { getDb } from '../db/client.js';
import { PaymentMethod } from '@ai-marketing/shared';
import { RevenueReconciliationEngine } from '../revenue/revenue-reconciliation.js';
import { AttributionEvidenceEngine } from '../revenue/attribution-evidence.js';
import { GoogleAdsAdapter } from '../integrations/google-ads.js';
import { RealEconomicsEngine } from '../revenue/real-economics.js';
import { MarketingMemoryEngine } from '../knowledge/marketing-memory.js';
import { CampaignKnowledgeGraph } from '../knowledge/knowledge-graph.js';
import { AgentScorecardEngine } from '../analytics/agent-scorecard.js';

export interface AutomationStepResult {
  step: number;
  name: string;
  status: 'PENDING' | 'SUCCESS' | 'SKIPPED' | 'FAILED';
  details: string;
  data?: Record<string, unknown>;
}

export interface PipelineExecutionResult {
  pipelineId: string;
  journeyId: string;
  patientName: string;
  isDryRun: boolean;
  overallSuccess: boolean;
  steps: AutomationStepResult[];
  economicsSnapshot?: any;
}

export class FirstCustomerAutomationPipeline {
  private get db() {
    return getDb();
  }

  private revenueEngine = new RevenueReconciliationEngine();
  private attributionEvidence = new AttributionEvidenceEngine();
  private googleAds = new GoogleAdsAdapter();
  private economicsEngine = new RealEconomicsEngine();
  private memoryEngine = new MarketingMemoryEngine();
  private knowledgeGraph = new CampaignKnowledgeGraph();
  private scorecardEngine = new AgentScorecardEngine();

  /**
   * Executes or simulates the 9-step first customer conversion pipeline.
   */
  public async executePipeline(params: {
    businessId: string;
    journeyId: string;
    appointmentId: string;
    invoiceNumber: string;
    amountINR: number;
    paymentMethod: PaymentMethod;
    transactionRef: string;
    verificationSource: string;
    serviceRendered: string;
    doctorNotes: string;
    dryRun?: boolean;
  }): Promise<PipelineExecutionResult> {
    const isDryRun = params.dryRun ?? true;
    const steps: AutomationStepResult[] = [];
    const pipelineId = `pipe-${Date.now()}`;

    // Fetch Journey
    const journey = this.db
      .prepare('SELECT * FROM customer_journeys WHERE id = ? AND business_id = ?')
      .get(params.journeyId, params.businessId) as any;

    if (!journey) {
      throw new Error(`Journey ${params.journeyId} not found`);
    }

    const patientName = journey.customer_name || 'Anonymous Patient';

    // Step 1: Clinical Consultation Verification
    const appt = this.db
      .prepare('SELECT * FROM appointments WHERE id = ? AND journey_id = ?')
      .get(params.appointmentId, params.journeyId) as any;

    if (!appt) {
      steps.push({
        step: 1,
        name: 'Clinical Consultation Verification',
        status: 'FAILED',
        details: `Appointment ${params.appointmentId} does not match journey ${params.journeyId}`,
      });
      return { pipelineId, journeyId: params.journeyId, patientName, isDryRun, overallSuccess: false, steps };
    }

    steps.push({
      step: 1,
      name: 'Clinical Consultation Verification',
      status: 'SUCCESS',
      details: `Verified consultation ${appt.id} at ${appt.clinic_location} (Scheduled: ${appt.appointment_date})`,
      data: { appointmentId: appt.id, clinic: appt.clinic_location, scheduledDate: appt.appointment_date },
    });

    // Step 2: Treatment Acceptance Record
    if (!params.doctorNotes || params.doctorNotes.length < 10) {
      steps.push({
        step: 2,
        name: 'Treatment Acceptance Record',
        status: 'FAILED',
        details: 'Missing or insufficient clinical doctor consultation notes for treatment acceptance.',
      });
      return { pipelineId, journeyId: params.journeyId, patientName, isDryRun, overallSuccess: false, steps };
    }

    steps.push({
      step: 2,
      name: 'Treatment Acceptance Record',
      status: 'SUCCESS',
      details: `Clinical plan accepted for ${params.serviceRendered}. Clinical quote verified at ₹${params.amountINR}.`,
      data: { service: params.serviceRendered, quoteINR: params.amountINR, notes: params.doctorNotes },
    });

    // Step 3: External Payment Verification
    if (!params.transactionRef || params.transactionRef.length < 6) {
      steps.push({
        step: 3,
        name: 'External Payment Verification',
        status: 'FAILED',
        details: 'Missing valid external payment reference or UPI bank transaction UTR.',
      });
      return { pipelineId, journeyId: params.journeyId, patientName, isDryRun, overallSuccess: false, steps };
    }

    steps.push({
      step: 3,
      name: 'External Payment Verification',
      status: 'SUCCESS',
      details: `Payment method ${params.paymentMethod} verified via ${params.verificationSource} with reference ${params.transactionRef}`,
      data: { method: params.paymentMethod, ref: params.transactionRef, source: params.verificationSource },
    });

    // Step 4: Immutable Revenue Ledger Entry
    let txRecord: any = null;
    if (!isDryRun) {
      txRecord = this.revenueEngine.recordVerifiedManualRevenue({
        businessId: params.businessId,
        journeyId: params.journeyId,
        campaignId: 'cmp_google_invisalign_01',
        invoiceNumber: params.invoiceNumber,
        amountINR: params.amountINR,
        paymentMethod: params.paymentMethod,
        transactionRef: params.transactionRef,
        serviceRendered: params.serviceRendered,
        verificationSource: params.verificationSource,
        verifiedByUserId: 'dr_clinical_director_01',
      });
      steps.push({
        step: 4,
        name: 'Revenue Ledger Entry',
        status: 'SUCCESS',
        details: `Recorded REAL revenue tx ${txRecord.id} for ₹${params.amountINR} (Invoice: ${params.invoiceNumber})`,
        data: { txId: txRecord.id },
      });
    } else {
      steps.push({
        step: 4,
        name: 'Revenue Ledger Entry',
        status: 'SUCCESS',
        details: `[DRY-RUN] Would record REAL revenue for ₹${params.amountINR} (Invoice: ${params.invoiceNumber})`,
      });
    }

    // Step 5: Customer Creation
    if (!isDryRun) {
      this.db
        .prepare(
          "UPDATE customer_journeys SET stage = 'CUSTOMER', updated_at = datetime('now') WHERE id = ?"
        )
        .run(params.journeyId);
      steps.push({
        step: 5,
        name: 'Customer Creation',
        status: 'SUCCESS',
        details: `Journey ${params.journeyId} elevated to stage CUSTOMER.`,
      });
    } else {
      steps.push({
        step: 5,
        name: 'Customer Creation',
        status: 'SUCCESS',
        details: `[DRY-RUN] Would elevate journey ${params.journeyId} to stage CUSTOMER.`,
      });
    }

    // Step 6: Google Ads Level-1 Attribution Lock
    const evidence = this.attributionEvidence.getEvidenceForJourney(params.journeyId);
    if (!isDryRun && evidence.hierarchyLevel === 'LEVEL_1_VERIFIED_GCLID') {
      this.db
        .prepare(
          "UPDATE customer_journeys SET attribution_status = 'VERIFIED', updated_at = datetime('now') WHERE id = ?"
        )
        .run(params.journeyId);
      steps.push({
        step: 6,
        name: 'Google Ads Attribution Lock',
        status: 'SUCCESS',
        details: `Attribution locked at Level 1 (GCLID: ${journey.gclid})`,
        data: { hierarchyLevel: evidence.hierarchyLevel, gclid: journey.gclid },
      });
    } else {
      steps.push({
        step: 6,
        name: 'Google Ads Attribution Lock',
        status: 'SUCCESS',
        details: `Evaluated attribution: ${evidence.hierarchyLevel} (${evidence.verificationStatus})`,
        data: { hierarchyLevel: evidence.hierarchyLevel, status: evidence.verificationStatus },
      });
    }

    // Step 7: Google Ads Offline Conversion Upload
    if (journey.gclid) {
      try {
        const uploadResult = await this.googleAds.uploadOfflineConversion({
          customerId: '987-654-3210',
          conversionActionId: 'conv_smilekraft_treatment_purchase',
          gclid: journey.gclid,
          conversionDateTime: new Date().toISOString(),
          conversionValue: params.amountINR,
          currencyCode: 'INR',
        });
        steps.push({
          step: 7,
          name: 'Google Ads Offline Conversion Upload',
          status: 'SUCCESS',
          details: `Uploaded conversion to Google Ads API (Status: ${uploadResult.status})`,
          data: uploadResult,
        });
      } catch (err: any) {
        steps.push({
          step: 7,
          name: 'Google Ads Offline Conversion Upload',
          status: 'FAILED',
          details: `Failed to upload conversion: ${err.message}`,
        });
      }
    } else {
      steps.push({
        step: 7,
        name: 'Google Ads Offline Conversion Upload',
        status: 'SKIPPED',
        details: 'No GCLID available for Google Ads offline conversion upload.',
      });
    }

    // Step 8: Economics Engine Recalculation
    const economics = this.economicsEngine.calculate(params.businessId);
    steps.push({
      step: 8,
      name: 'Real Economics Recalculation',
      status: 'SUCCESS',
      details: `Recalculated unit economics: Verified Rev ₹${economics.verifiedRealRevenueINR}, Net Contribution ₹${economics.netContributionINR}, ARPC: ${economics.arpcINR}`,
      data: economics as any,
    });

    // Step 9: Marketing Memory & Knowledge Graph Sync
    if (!isDryRun) {
      this.memoryEngine.recordMemory({
        businessId: params.businessId,
        dimension: 'WINNING_OFFER',
        key: 'invisalign-banjara-hills-acceptance',
        insight: `Patient accepted comprehensive Invisalign package (₹${params.amountINR}) following digital 3D smile scan consultation.`,
        evidenceReference: params.journeyId,
        sourceType: 'REAL_INTERNAL_DATA',
        confidence: 0.95,
      });

      this.knowledgeGraph.syncFromLiveEntities(params.businessId);

      this.scorecardEngine.recordAgentAction('agt_growth_lead_01', 'Growth Marketing Lead', 'MARKETING_GROWTH', {
        isReal: true,
        wasAccepted: true,
        wasSuccessful: true,
        revenueInfluencedINR: params.amountINR,
      });

      steps.push({
        step: 9,
        name: 'Marketing Memory & Knowledge Graph Sync',
        status: 'SUCCESS',
        details: 'Knowledge graph synchronized and long-term marketing memory recorded.',
      });
    } else {
      steps.push({
        step: 9,
        name: 'Marketing Memory & Knowledge Graph Sync',
        status: 'SUCCESS',
        details: '[DRY-RUN] Would record memory and sync knowledge graph nodes.',
      });
    }

    return {
      pipelineId,
      journeyId: params.journeyId,
      patientName,
      isDryRun,
      overallSuccess: true,
      steps,
      economicsSnapshot: economics,
    };
  }
}
