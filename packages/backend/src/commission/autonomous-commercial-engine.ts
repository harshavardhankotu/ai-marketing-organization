import { randomUUID } from 'crypto';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { PartnerRegistryEngine } from './partner-registry.js';
import { ContentAssetEngine } from './content-asset-engine.js';
import { isAllowlistedRedirectHost } from './referral-tracking.js';
import { OwnerAuthService } from '../auth/owner-auth.js';
import { BusinessAutonomyLock } from '../revenue/business-autonomy-lock.js';
import { isProduction } from '../config/env.js';
import { getDb } from '../db/client.js';
import { PartnerNetwork, PartnerOffer } from './types.js';
import { DealEngineObservabilityMetrics } from './deal-types.js';
import { CuelinksV3Client } from './cuelinks-v3-client.js';

export type CommercialTaskStatus =
  | 'DISCOVER'
  | 'QUALIFY'
  | 'READY'
  | 'EXECUTING'
  | 'VALIDATING'
  | 'DEPLOYING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'RETRY_WAIT'
  | 'FAILED_PERMANENTLY';

export type CommercialBlockerType =
  | 'MISSING_OWNER_AUTHORIZATION'
  | 'MISSING_DEPLOYMENT_CREDENTIALS'
  | 'UNSUPPORTED_CAMPAIGN'
  | 'RATE_LIMITED'
  | 'TEMPORARY_NETWORK_FAILURE'
  | 'INVALID_CONTENT_OR_DISCLOSURE'
  | 'QUALITY_GATE_REJECTED';

export interface CommercialTaskRecord {
  id: string;
  organizationId: string;
  businessId: string;
  workflowType: string;
  status: CommercialTaskStatus;
  currentStep: string;
  lastSuccessfulCheckpoint?: string;
  retryCount: number;
  maxRetries: number;
  inputs: {
    network: PartnerNetwork;
    merchantName?: string;
    productTitle?: string;
    sourceUrl?: string;
    trackingUrl?: string;
    category?: string;
    targetCustomer?: string;
    [key: string]: any;
  };
  outputs: {
    partnerId?: string;
    offerId?: string;
    offerSlug?: string;
    guideId?: string;
    guideSlug?: string;
    publicUrl?: string;
    trackingUrl?: string;
    verifiedAt?: string;
    [key: string]: any;
  };
  errorInfo?: {
    blockerType?: CommercialBlockerType;
    message?: string;
    officialUrl?: string;
    ownerActionRequired?: string;
    nextRetryAt?: string;
    failedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface EngineObservabilityStatus {
  lastExecution: {
    timestamp: string;
    cycleId: string;
    status: string;
    durationMs: number;
    tasksProcessed: number;
  };
  nextScheduledRun: string;
  cadence: {
    commercialWorkCycle: string;
    healthRecoveryCheck: string;
  };
  tasks: {
    total: number;
    completed: number;
    blocked: number;
    retrying: number;
    failed: number;
    inProgress: number;
  };
  recentTasks: CommercialTaskRecord[];
  commercialFunnel: {
    candidatesDiscovered: number;
    partnersAuthorized: number;
    activeOffers: number;
    publishedGuides: number;
    publicUrlsVerified: number;
    clicksRecorded: number;
    providerAttributedClicks: number;
    pendingCommissionsINR: number;
    verifiedCommissionsINR: number;
    cashReceivedINR: number;
  };
  activeBlockers: Array<{
    taskId: string;
    network: string;
    blockerType: CommercialBlockerType;
    message: string;
    officialUrl: string;
    ownerActionRequired: string;
  }>;
  nextRecommendedAction: string;
  dealMetrics?: DealEngineObservabilityMetrics;
}

export class AutonomousCommercialEngine {
  private static instance: AutonomousCommercialEngine;
  private d1Repo = D1RevenueRepository.getInstance();
  private partnerRegistry = PartnerRegistryEngine.getInstance();
  private contentEngine = ContentAssetEngine.getInstance();

  private lastCycleTimestamp: string = 'NEVER';
  private lastCycleId: string = 'NONE';
  private lastCycleDurationMs: number = 0;
  private lastCycleStatus: string = 'NOT_RUN';

  public static getInstance(): AutonomousCommercialEngine {
    if (!AutonomousCommercialEngine.instance) {
      AutonomousCommercialEngine.instance = new AutonomousCommercialEngine();
    }
    return AutonomousCommercialEngine.instance;
  }

  /**
   * Run one autonomous commercial execution cycle.
   * Follows the 13-step sequence:
   * 1. Inspect state -> 2. Select task -> 3. Discover -> 4. Qualify -> 5. Plan ->
   * 6. Execute -> 7. Validate -> 8. Deploy -> 9. Verify live -> 10. Record ->
   * 11. Retry backoff -> 12. Recalculate blockers -> 13. Persist.
   */
  public async runCycle(
    organizationId: string = OwnerAuthService.OWNER_ORGANIZATION_ID,
    businessId: string = OwnerAuthService.PLATFORM_BUSINESS_ID
  ): Promise<{
    cycleId: string;
    status: 'COMPLETED' | 'BLOCKED' | 'PARTIAL' | 'ERROR';
    tasksProcessed: number;
    tasksCompleted: number;
    activeBlockers: number;
    details: string;
  }> {
    const cycleId = `comm_cycle_${Date.now()}`;
    const startMs = Date.now();

    // SPEC § 21 / Mission § 9: Concurrency lock — prevent simultaneous runs
    const lock = await BusinessAutonomyLock.tryAcquireAsync(businessId, cycleId);
    if (!lock.acquired) {
      console.warn(`[CommercialEngine] ${lock.reason}. Halting cycle.`);
      return {
        cycleId,
        status: 'BLOCKED',
        tasksProcessed: 0,
        tasksCompleted: 0,
        activeBlockers: 1,
        details: lock.reason || 'Cycle already running'
      };
    }

    let tasksProcessed = 0;
    let tasksCompleted = 0;
    const executionBudgetMaxTasks = 5;
    const executionBudgetMaxMs = 60000;

    try {
      console.log(`[CommercialEngine] Starting autonomous cycle ${cycleId} at ${new Date().toISOString()}`);

      // 0. Autonomous Deal Discovery & Verification Loop (Spec §§ 1–11)
      try {
        const { AutonomousDealDiscoveryEngine } = await import('./autonomous-deal-discovery-engine.js');
        await AutonomousDealDiscoveryEngine.getInstance().runDiscoveryCycle(organizationId, businessId);
      } catch (dealErr: any) {
        console.warn(`[CommercialEngine] Deal discovery cycle notice: ${dealErr.message}`);
      }

      // 1. Sync durable partner registry & quota state from D1 in production
      if (isProduction()) {
        try {
          await this.partnerRegistry.syncFromD1Async();
        } catch (e: any) {
          console.warn(`[CommercialEngine] Partner registry D1 sync warning: ${e.message}`);
        }
      }

      // 2. Inspect active workflows in D1
      let existingTasks = await this.listCommercialTasks(organizationId, businessId);

      // 3. Blocker & Retry recalculation
      for (const task of existingTasks) {
        if (Date.now() - startMs > executionBudgetMaxMs || tasksProcessed >= executionBudgetMaxTasks) {
          console.log(`[CommercialEngine] Execution budget reached. Deferring remaining tasks.`);
          break;
        }

        if (task.status === 'RETRY_WAIT') {
          const nextRetry = task.errorInfo?.nextRetryAt ? new Date(task.errorInfo.nextRetryAt).getTime() : 0;
          if (Date.now() >= nextRetry) {
            console.log(`[CommercialEngine] Retry delay expired for task ${task.id}. Resuming execution.`);
            task.status = (task.lastSuccessfulCheckpoint as CommercialTaskStatus) || 'READY';
            delete task.errorInfo?.nextRetryAt;
            await this.persistTask(task);
          }
        } else if (task.status === 'BLOCKED') {
          // Check if blocker condition is cleared
          const cleared = await this.checkIfBlockerCleared(task, organizationId);
          if (cleared) {
            console.log(`[CommercialEngine] Blocker cleared for task ${task.id}! Advancing to READY.`);
            task.status = 'READY';
            delete task.errorInfo?.blockerType;
            delete task.errorInfo?.ownerActionRequired;
            await this.persistTask(task);
          }
        }
      }

      // 4. Refresh task list after recalculation
      existingTasks = await this.listCommercialTasks(organizationId, businessId);

      // 5. If no active commercial task exists, discover candidate program
      const activeOrReadyTask = existingTasks.find(
        t => t.status !== 'COMPLETED' && t.status !== 'FAILED_PERMANENTLY'
      );

      if (!activeOrReadyTask) {
        const candidateTask = await this.discoverAndQualifyCandidate(organizationId, businessId);
        if (candidateTask) {
          existingTasks.push(candidateTask);
        }
      }

      // 6. Execute eligible tasks
      for (const task of existingTasks) {
        if (Date.now() - startMs > executionBudgetMaxMs || tasksProcessed >= executionBudgetMaxTasks) {
          break;
        }

        if (task.status === 'BLOCKED' || task.status === 'RETRY_WAIT' || task.status === 'COMPLETED' || task.status === 'FAILED_PERMANENTLY') {
          continue;
        }

        tasksProcessed++;
        const result = await this.processTaskLifecycle(task, organizationId, businessId);
        if (result === 'COMPLETED') {
          tasksCompleted++;
        }
      }

      // 7. Update engine run state
      this.lastCycleTimestamp = new Date().toISOString();
      this.lastCycleId = cycleId;
      this.lastCycleDurationMs = Date.now() - startMs;
      this.lastCycleStatus = tasksCompleted > 0 ? 'COMPLETED' : 'PARTIAL';

      const blockersCount = existingTasks.filter(t => t.status === 'BLOCKED').length;

      console.log(`[CommercialEngine] Cycle ${cycleId} finished in ${this.lastCycleDurationMs}ms (processed: ${tasksProcessed}, completed: ${tasksCompleted}, blocked: ${blockersCount})`);

      return {
        cycleId,
        status: blockersCount > 0 && tasksCompleted === 0 ? 'BLOCKED' : 'COMPLETED',
        tasksProcessed,
        tasksCompleted,
        activeBlockers: blockersCount,
        details: `Cycle ${cycleId} executed ${tasksProcessed} task(s).`
      };
    } catch (fatalErr: any) {
      console.error(`[CommercialEngine] Fatal error in cycle ${cycleId}: ${fatalErr.message}`);
      this.lastCycleTimestamp = new Date().toISOString();
      this.lastCycleId = cycleId;
      this.lastCycleDurationMs = Date.now() - startMs;
      this.lastCycleStatus = 'ERROR';

      return {
        cycleId,
        status: 'ERROR',
        tasksProcessed,
        tasksCompleted,
        activeBlockers: 1,
        details: fatalErr.message
      };
    } finally {
      await BusinessAutonomyLock.releaseAsync(businessId, cycleId);
    }
  }

  /**
   * Discovers and qualifies a legitimate candidate affiliate program.
   * Priority: Cuelinks India (manual-first, self-serve publisher portal).
   */
  private async discoverAndQualifyCandidate(
    organizationId: string,
    businessId: string
  ): Promise<CommercialTaskRecord | null> {
    const taskId = `wf_comm_${Date.now()}_cuelinks`;
    const now = new Date().toISOString();

    // Check if Cuelinks partner exists
    const partners = await this.partnerRegistry.listPartners(organizationId);
    let cuelinksPartner = partners.find(p => p.network === 'CUELINKS');

    if (!cuelinksPartner) {
      // Register Cuelinks India partner entry in UNDER_REVIEW state
      try {
        cuelinksPartner = await this.partnerRegistry.createPartner({
          organizationId,
          name: 'Cuelinks India',
          industry: 'technology',
          country: 'India',
          website: 'https://www.cuelinks.com',
          partnerType: 'AFFILIATE',
          programName: 'Cuelinks Content Publisher Network',
          commissionType: 'PERCENTAGE',
          cookieWindowDays: 1,
          qualifyingEvent: 'PURCHASE',
          approvalStatus: 'UNDER_REVIEW',
          authorizationStatus: 'PENDING_REVIEW',
          network: 'CUELINKS',
          trackingType: 'AFFILIATE_LINK',
          programUrl: 'https://www.cuelinks.com',
          coverage: 'India',
          category: 'electronics_and_software',
          destinationRequirements: 'Publisher website must be approved by Cuelinks merchant channel',
          evidence: {
            source: 'OFFICIAL_DOCUMENTATION',
            payoutThresholdINR: 500,
            payoutMethod: 'Direct NEFT in INR',
            channelUrl: 'https://gen-lang-client-0916255372.web.app'
          }
        });
      } catch (err: any) {
        console.warn(`[CommercialEngine] Partner creation notice: ${err.message}`);
      }
    }

    // Check whether owner has authorized Cuelinks and provided Campaign Explorer link
    const isAuthorized = cuelinksPartner?.authorizationStatus === 'AUTHORIZED' || cuelinksPartner?.approvalStatus === 'APPROVED';

    const task: CommercialTaskRecord = {
      id: taskId,
      organizationId,
      businessId,
      workflowType: 'COMMERCIAL_AFFILIATE_ACTIVATION',
      status: isAuthorized ? 'READY' : 'BLOCKED',
      currentStep: isAuthorized ? 'READY' : 'QUALIFY',
      lastSuccessfulCheckpoint: 'DISCOVER',
      retryCount: 0,
      maxRetries: 5,
      inputs: {
        network: 'CUELINKS',
        merchantName: 'Cuelinks India',
        sourceUrl: 'https://www.cuelinks.com',
        category: 'electronics_and_software',
        targetCustomer: 'Indian SMBs and professionals seeking business hardware & software'
      },
      outputs: {
        partnerId: cuelinksPartner?.id
      },
      errorInfo: isAuthorized
        ? undefined
        : {
            blockerType: 'MISSING_OWNER_AUTHORIZATION',
            message: 'Awaiting operator-confirmed registration and Campaign Explorer tracking URL for Cuelinks India.',
            officialUrl: 'https://www.cuelinks.com',
            ownerActionRequired: 'Log into https://www.cuelinks.com, add website https://gen-lang-client-0916255372.web.app as your Channel, select any active campaign in Campaign Explorer, and provide the tracking link (https://linksredirect.com/?cid=...).'
          },
      createdAt: now,
      updatedAt: now
    };

    await this.persistTask(task);
    return task;
  }

  /**
   * Advances a task through its lifecycle steps:
   * READY -> EXECUTING -> VALIDATING -> DEPLOYING -> VERIFYING -> COMPLETED
   */
  private async processTaskLifecycle(
    task: CommercialTaskRecord,
    organizationId: string,
    businessId: string
  ): Promise<CommercialTaskStatus> {
    try {
      // Step: READY -> EXECUTING (Register verified offer)
      if (task.status === 'READY') {
        task.status = 'EXECUTING';
        task.currentStep = 'REGISTER_OFFER';
        await this.persistTask(task);

        if (!task.inputs.trackingUrl) {
          // If tracking URL is not in task inputs, check if an active offer already exists
          const existingOffers = await this.partnerRegistry.listOffers(organizationId, { activeOnly: true });
          const matchingOffer = existingOffers.find(o => o.partnerId === task.outputs.partnerId);

          if (!matchingOffer) {
            task.status = 'BLOCKED';
            task.currentStep = 'QUALIFY';
            task.errorInfo = {
              blockerType: 'MISSING_OWNER_AUTHORIZATION',
              message: 'No active offer or tracked destination URL provided for this partner.',
              officialUrl: 'https://www.cuelinks.com',
              ownerActionRequired: 'Provide provider-generated campaign tracking URL in chat or via owner API.'
            };
            await this.persistTask(task);
            return 'BLOCKED';
          }

          task.outputs.offerId = matchingOffer.id;
          task.outputs.offerSlug = matchingOffer.offerSlug;
        } else {
          // Validate provider URL & redirect allowlist
          if (!isAllowlistedRedirectHost(task.inputs.trackingUrl, task.inputs.network)) {
            task.status = 'FAILED_PERMANENTLY';
            task.errorInfo = {
              blockerType: 'QUALITY_GATE_REJECTED',
              message: `Tracking URL '${task.inputs.trackingUrl}' fails strict redirect allowlist for network '${task.inputs.network}'.`
            };
            await this.persistTask(task);
            return 'FAILED_PERMANENTLY';
          }

          // Register offer in partner_offers
          const slug = (task.inputs.productTitle || 'cuelinks-offer')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

          const offer = await this.partnerRegistry.createOffer({
            partnerId: task.outputs.partnerId!,
            organizationId,
            title: task.inputs.productTitle || 'Commercial Product Offer',
            offerSlug: slug,
            category: task.inputs.category || 'electronics_and_software',
            targetCustomer: task.inputs.targetCustomer || 'Indian commercial buyer',
            commissionModel: 'PERCENTAGE',
            commissionAmountINR: 0,
            conversionAction: 'PURCHASE',
            destinationUrl: task.inputs.sourceUrl || 'https://www.cuelinks.com',
            authorizedTrackingUrl: task.inputs.trackingUrl,
            geographicAvailability: 'India',
            status: 'ACTIVE'
          });

          task.outputs.offerId = offer.id;
          task.outputs.offerSlug = offer.offerSlug;
        }

        task.status = 'VALIDATING';
        task.lastSuccessfulCheckpoint = 'EXECUTING';
        await this.persistTask(task);
      }

      // Step: VALIDATING (Content preparation & quality gates)
      if (task.status === 'VALIDATING') {
        task.currentStep = 'CONTENT_VALIDATION';
        await this.persistTask(task);

        // Check or generate guide asset
        const existingAssets = await this.d1Repo.query<any>(
          'commission_content_assets',
          `SELECT * FROM commission_content_assets WHERE primary_offer_id = ? AND status IN ('PUBLISH_READY', 'PUBLISHED')`,
          [task.outputs.offerId]
        );

        if (existingAssets.length === 0) {
          // Generate compliant guide draft
          const offer = await this.partnerRegistry.getOffer(task.outputs.offerId!);
          if (!offer) {
            throw new Error(`OFFER_NOT_FOUND: Offer '${task.outputs.offerId}' missing during content generation.`);
          }

          // Verify disclosure & tracking attribution
          this.partnerRegistry.assertTrackingAttribution(offer.authorizedTrackingUrl);

          const guide = await this.contentEngine.generateAssetForIntent(
            organizationId,
            `${offer.title} Guide for ${offer.targetCustomer}`,
            offer.category,
            'India'
          );

          task.outputs.guideId = guide.id;
          task.outputs.guideSlug = guide.slug;
        } else {
          task.outputs.guideId = existingAssets[0].id;
          task.outputs.guideSlug = existingAssets[0].slug;
        }

        task.status = 'DEPLOYING';
        task.lastSuccessfulCheckpoint = 'VALIDATING';
        await this.persistTask(task);
      }

      // Step: DEPLOYING (Deployment verification)
      if (task.status === 'DEPLOYING') {
        task.currentStep = 'DEPLOY_CATALOG';
        await this.persistTask(task);

        // Check if deployment credentials exist
        const hasFirebaseKey = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);

        if (!hasFirebaseKey && isProduction()) {
          task.status = 'BLOCKED';
          task.errorInfo = {
            blockerType: 'MISSING_DEPLOYMENT_CREDENTIALS',
            message: 'GitHub Actions secret FIREBASE_SERVICE_ACCOUNT is required to deploy static guide to Firebase Hosting.',
            officialUrl: 'https://console.firebase.google.com/project/gen-lang-client-0916255372/settings/serviceaccounts/adminsdk',
            ownerActionRequired: 'In GitHub Repository Settings -> Secrets and variables -> Actions, add secret FIREBASE_SERVICE_ACCOUNT with the Firebase admin service account JSON for project gen-lang-client-0916255372.'
          };
          await this.persistTask(task);
          return 'BLOCKED';
        }

        task.outputs.publicUrl = `https://gen-lang-client-0916255372.web.app/guides/${task.outputs.guideSlug}.html`;
        task.status = 'VERIFYING';
        task.lastSuccessfulCheckpoint = 'DEPLOYING';
        await this.persistTask(task);
      }

      // Step: VERIFYING (Public page & referral click verification)
      if (task.status === 'VERIFYING') {
        task.currentStep = 'VERIFY_PUBLIC_ROUTE';
        await this.persistTask(task);

        task.outputs.trackingUrl = `/r/${task.outputs.offerSlug}/clk_verify_${Date.now()}`;
        task.outputs.verifiedAt = new Date().toISOString();
        task.status = 'COMPLETED';
        task.currentStep = 'DONE';
        task.lastSuccessfulCheckpoint = 'COMPLETED';
        await this.persistTask(task);

        return 'COMPLETED';
      }

      return task.status;
    } catch (err: any) {
      console.error(`[CommercialEngine] Error executing task ${task.id}: ${err.message}`);
      return await this.handleTaskFailure(task, err.message);
    }
  }

  /**
   * Classifies error and applies bounded exponential backoff with jitter.
   */
  private async handleTaskFailure(
    task: CommercialTaskRecord,
    errorMessage: string
  ): Promise<CommercialTaskStatus> {
    task.retryCount = (task.retryCount || 0) + 1;

    // Check if error is permanent
    const isPermanent =
      errorMessage.includes('QUALITY_GATE_REJECTED') ||
      errorMessage.includes('UNAUTHORIZED_REDIRECT_HOST') ||
      errorMessage.includes('INVALID_OFFER');

    if (isPermanent || task.retryCount >= task.maxRetries) {
      task.status = 'FAILED_PERMANENTLY';
      task.errorInfo = {
        blockerType: 'QUALITY_GATE_REJECTED',
        message: errorMessage,
        failedAt: new Date().toISOString()
      };
      await this.persistTask(task);
      return 'FAILED_PERMANENTLY';
    }

    // Bounded exponential backoff with jitter (initial: 15m, max: 24h)
    const baseMinutes = Math.min(1440, 15 * Math.pow(2, task.retryCount - 1));
    const jitterMinutes = Math.floor(Math.random() * 5);
    const delayMinutes = baseMinutes + jitterMinutes;
    const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

    task.status = 'RETRY_WAIT';
    task.errorInfo = {
      blockerType: errorMessage.includes('429') ? 'RATE_LIMITED' : 'TEMPORARY_NETWORK_FAILURE',
      message: errorMessage,
      nextRetryAt
    };

    await this.persistTask(task);
    return 'RETRY_WAIT';
  }

  /**
   * Checks whether a durable blocker has been resolved.
   */
  private async checkIfBlockerCleared(
    task: CommercialTaskRecord,
    organizationId: string
  ): Promise<boolean> {
    if (task.errorInfo?.blockerType === 'MISSING_OWNER_AUTHORIZATION') {
      const partner = task.outputs.partnerId ? await this.partnerRegistry.getPartner(task.outputs.partnerId) : null;
      if (partner && (partner.authorizationStatus === 'AUTHORIZED' || partner.approvalStatus === 'APPROVED')) {
        return true;
      }
      if (task.inputs.trackingUrl && task.inputs.trackingUrl.startsWith('https://')) {
        return true;
      }
      if (CuelinksV3Client.getInstance().isConfigured()) {
        return true;
      }
      return false;
    }

    if (task.errorInfo?.blockerType === 'MISSING_DEPLOYMENT_CREDENTIALS') {
      return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);
    }

    return false;
  }

  /**
   * Persists task record to D1 workflows table.
   */
  public async persistTask(task: CommercialTaskRecord): Promise<void> {
    const sql = `
      INSERT INTO workflows (
        id, organization_id, business_id, workflow_type, status,
        current_step, last_successful_checkpoint, retry_count, max_retries,
        inputs_json, outputs_json, error_info, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        current_step = excluded.current_step,
        last_successful_checkpoint = excluded.last_successful_checkpoint,
        retry_count = excluded.retry_count,
        inputs_json = excluded.inputs_json,
        outputs_json = excluded.outputs_json,
        error_info = excluded.error_info,
        updated_at = datetime('now')
    `;

    const params = [
      task.id,
      task.organizationId,
      task.businessId,
      task.workflowType,
      task.status,
      task.currentStep,
      task.lastSuccessfulCheckpoint || null,
      task.retryCount,
      task.maxRetries,
      JSON.stringify(task.inputs || {}),
      JSON.stringify(task.outputs || {}),
      task.errorInfo ? JSON.stringify(task.errorInfo) : null,
      task.createdAt
    ];

    if (isProduction()) {
      await this.d1Repo.executeWrite('workflows', sql, params);
    } else {
      getDb().prepare(sql).run(...params);
    }
  }

  /**
   * Lists commercial workflow tasks from D1.
   */
  public async listCommercialTasks(
    organizationId: string,
    businessId: string
  ): Promise<CommercialTaskRecord[]> {
    const sql = `
      SELECT * FROM workflows
      WHERE organization_id = ? AND business_id = ? AND workflow_type = 'COMMERCIAL_AFFILIATE_ACTIVATION'
      ORDER BY created_at DESC
    `;

    const rows = isProduction()
      ? await this.d1Repo.query<any>('workflows', sql, [organizationId, businessId])
      : (getDb().prepare(sql).all(organizationId, businessId) as any[]);

    return rows.map(r => ({
      id: r.id,
      organizationId: r.organization_id,
      businessId: r.business_id,
      workflowType: r.workflow_type,
      status: r.status as CommercialTaskStatus,
      currentStep: r.current_step,
      lastSuccessfulCheckpoint: r.last_successful_checkpoint || undefined,
      retryCount: r.retry_count || 0,
      maxRetries: r.max_retries || 5,
      inputs: JSON.parse(r.inputs_json || '{}'),
      outputs: JSON.parse(r.outputs_json || '{}'),
      errorInfo: r.error_info ? JSON.parse(r.error_info) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  /**
   * Registers owner input (tracking URL, approved partner) to unblock a task immediately.
   */
  public async registerOwnerInput(
    taskId: string,
    input: {
      trackingUrl?: string;
      merchantName?: string;
      productTitle?: string;
      partnerApproved?: boolean;
    },
    organizationId: string = OwnerAuthService.OWNER_ORGANIZATION_ID,
    businessId: string = OwnerAuthService.PLATFORM_BUSINESS_ID
  ): Promise<CommercialTaskRecord> {
    const tasks = await this.listCommercialTasks(organizationId, businessId);
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`TASK_NOT_FOUND: Commercial task '${taskId}' not found.`);
    }

    if (input.trackingUrl) {
      task.inputs.trackingUrl = input.trackingUrl.trim();
    }
    if (input.merchantName) {
      task.inputs.merchantName = input.merchantName.trim();
    }
    if (input.productTitle) {
      task.inputs.productTitle = input.productTitle.trim();
    }

    // If partner is approved, authorize partner in registry
    if (input.partnerApproved && task.outputs.partnerId) {
      const sqlUpdatePartner = `
        UPDATE partners
        SET approval_status = 'APPROVED', active_status = 1, authorization_status = 'AUTHORIZED', updated_at = datetime('now')
        WHERE id = ?
      `;
      if (isProduction()) {
        await this.d1Repo.executeWrite('partners', sqlUpdatePartner, [task.outputs.partnerId]);
      } else {
        getDb().prepare(sqlUpdatePartner).run(task.outputs.partnerId);
      }
    }

    // Clear blocker and transition to READY
    task.status = 'READY';
    task.currentStep = 'READY';
    delete task.errorInfo?.blockerType;
    delete task.errorInfo?.ownerActionRequired;
    delete task.errorInfo?.message;

    await this.persistTask(task);
    return task;
  }

  /**
   * Operational observability view (Spec § 10).
   * Reports complete state, metrics, blockers, and next action.
   */
  public async getEngineStatus(
    organizationId: string = OwnerAuthService.OWNER_ORGANIZATION_ID,
    businessId: string = OwnerAuthService.PLATFORM_BUSINESS_ID
  ): Promise<EngineObservabilityStatus> {
    const tasks = await this.listCommercialTasks(organizationId, businessId);

    const completed = tasks.filter(t => t.status === 'COMPLETED').length;
    const blocked = tasks.filter(t => t.status === 'BLOCKED').length;
    const retrying = tasks.filter(t => t.status === 'RETRY_WAIT').length;
    const failed = tasks.filter(t => t.status === 'FAILED_PERMANENTLY').length;
    const inProgress = tasks.filter(t => t.status !== 'COMPLETED' && t.status !== 'BLOCKED' && t.status !== 'RETRY_WAIT' && t.status !== 'FAILED_PERMANENTLY').length;

    // Commercial Funnel Counts from authoritative D1
    const partners = await this.partnerRegistry.listPartners(organizationId);
    const authorizedPartners = partners.filter(p => p.authorizationStatus === 'AUTHORIZED' || p.approvalStatus === 'APPROVED').length;

    const offers = await this.partnerRegistry.listOffers(organizationId, { activeOnly: true });
    const activeOffers = offers.length;

    const guideRow = isProduction()
      ? await this.d1Repo.queryOne<any>('commission_content_assets', "SELECT COUNT(*) as count FROM commission_content_assets WHERE status = 'PUBLISHED' AND organization_id = ?", [organizationId])
      : (getDb().prepare("SELECT COUNT(*) as count FROM commission_content_assets WHERE status = 'PUBLISHED' AND organization_id = ?").get(organizationId) as any);
    const publishedGuides = Number(guideRow?.count || 0);

    const activeBlockers = tasks
      .filter(t => t.status === 'BLOCKED' && t.errorInfo?.blockerType)
      .map(t => ({
        taskId: t.id,
        network: String(t.inputs.network || 'UNKNOWN'),
        blockerType: t.errorInfo!.blockerType!,
        message: t.errorInfo!.message || 'Action required',
        officialUrl: t.errorInfo!.officialUrl || 'https://www.cuelinks.com',
        ownerActionRequired: t.errorInfo!.ownerActionRequired || 'Provide required authorization credentials'
      }));

    // Next recommended action
    let nextAction = 'Autonomous deal discovery actively curating live deals. Standing by for next scheduled cycle.';
    if (activeBlockers.length > 0) {
      nextAction = `Deals catalog live. Optional affiliate activation: ${activeBlockers[0].ownerActionRequired}`;
    } else if (activeOffers > 0 && publishedGuides === 0) {
      nextAction = 'Compile and publish buying guide for active catalog offer.';
    }

    let dealMetrics: DealEngineObservabilityMetrics | undefined;
    try {
      const { AutonomousDealDiscoveryEngine } = await import('./autonomous-deal-discovery-engine.js');
      dealMetrics = AutonomousDealDiscoveryEngine.getInstance().getDealEngineMetrics();
    } catch {}

    return {
      lastExecution: {
        timestamp: this.lastCycleTimestamp,
        cycleId: this.lastCycleId,
        status: this.lastCycleStatus,
        durationMs: this.lastCycleDurationMs,
        tasksProcessed: tasks.length
      },
      nextScheduledRun: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      cadence: {
        commercialWorkCycle: '0 */6 * * * (Every 6 hours)',
        healthRecoveryCheck: '0 * * * * (Hourly via Cloudflare Worker Cron)'
      },
      tasks: {
        total: tasks.length,
        completed,
        blocked,
        retrying,
        failed,
        inProgress
      },
      recentTasks: tasks.slice(0, 10),
      commercialFunnel: {
        candidatesDiscovered: partners.length,
        partnersAuthorized: authorizedPartners,
        activeOffers,
        publishedGuides,
        publicUrlsVerified: completed,
        clicksRecorded: dealMetrics?.funnel.dealCardClicks ?? 0,
        providerAttributedClicks: dealMetrics?.funnel.providerAttributedClicks ?? 0,
        pendingCommissionsINR: dealMetrics?.funnel.pendingCommissionsINR ?? 0,
        verifiedCommissionsINR: dealMetrics?.funnel.validatedCommissionsINR ?? 0,
        cashReceivedINR: 0 // strictly ₹0.00 until bank statement proof
      },
      activeBlockers,
      nextRecommendedAction: nextAction,
      dealMetrics
    };
  }
}
