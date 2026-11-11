/**
 * CommercialSchedulePolicy — Two-Times-Daily (09:00 IST & 21:00 IST) Operating Policy
 *
 * Implements V4.1 Phase 2:
 * - Commercial campaigns strictly scheduled at 09:00 IST (03:30 UTC) and 21:00 IST (15:30 UTC).
 * - Hourly heartbeat/recovery runs every hour for quota, leases, queue drain, and event handlers.
 * - Accurate time calculations in Asia/Kolkata timezone with proper date boundaries.
 */

export interface ISTTimeComponents {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number; // 0-59
  second: number;
}

export type ScheduleWindow = 'MORNING_0900_IST' | 'EVENING_2100_IST' | 'CONTINUOUS_HOURLY';

export const MORNING_0900_WORKFLOWS = [
  'seasonal_demand_research',
  'competitor_pricing_research',
  'prospect_discovery_validation',
  'prospect_dedup_qualification',
  'outreach_draft_preparation',
  'owner_approval_queue_generation',
  'content_freshness_verification',
  'authorized_outreach_dispatch'
];

export const EVENING_2100_WORKFLOWS = [
  'seo_keyword_research',
  'multi_market_lead_qualification',
  'proposal_prep_followup',
  'daily_commercial_summary'
];

export const CONTINUOUS_HOURLY_WORKFLOWS = [
  'affiliate_offer_reconciliation',
  'daily_market_demand_research',
  'new_inquiry_processing',
  'reply_classification_followup',
  'quota_health_checks',
  'payment_status_reconciliation',
  'healthcare_claim_verification',
  'b2b_suppression_and_compliance_audit'
];

export class CommercialSchedulePolicy {
  /**
   * Deconstructs a UTC Date into its exact components in Asia/Kolkata (IST).
   */
  public static getISTComponents(date: Date = new Date()): ISTTimeComponents {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });

    const parts = formatter.formatToParts(date);
    const map: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') {
        map[p.type] = parseInt(p.value, 10);
      }
    }

    return {
      year: map.year,
      month: map.month,
      day: map.day,
      hour: map.hour === 24 ? 0 : map.hour,
      minute: map.minute,
      second: map.second
    };
  }

  /**
   * Checks if the given date falls in the 09:00 IST morning campaign window (09:00 - 09:59 IST).
   */
  public static isMorning0900Window(date: Date = new Date()): boolean {
    const ist = this.getISTComponents(date);
    return ist.hour === 9;
  }

  /**
   * Checks if the given date falls in the 21:00 IST evening campaign window (21:00 - 21:59 IST).
   */
  public static isEvening2100Window(date: Date = new Date()): boolean {
    const ist = this.getISTComponents(date);
    return ist.hour === 21;
  }

  /**
   * Returns the canonical schedule window for a workflow.
   */
  public static getWorkflowWindow(workflowId: string): ScheduleWindow {
    if (MORNING_0900_WORKFLOWS.includes(workflowId)) return 'MORNING_0900_IST';
    if (EVENING_2100_WORKFLOWS.includes(workflowId)) return 'EVENING_2100_IST';
    return 'CONTINUOUS_HOURLY';
  }

  /**
   * Converts an IST date/time specification to a UTC Date.
   * IST is strictly UTC+05:30.
   */
  public static istToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
    // Construct ISO string with explicit +05:30 offset
    const pad = (n: number) => n.toString().padStart(2, '0');
    const isoString = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+05:30`;
    return new Date(isoString);
  }

  /**
   * Calculates the next scheduled execution timestamp in UTC for a workflow.
   */
  public static calculateNextRunUTC(workflowId: string, fromDate: Date = new Date()): Date {
    const window = this.getWorkflowWindow(workflowId);
    const ist = this.getISTComponents(fromDate);

    if (window === 'MORNING_0900_IST') {
      // Target: 09:00 IST today if before 09:00 IST, else 09:00 IST tomorrow
      const isPast0900 = ist.hour > 9 || (ist.hour === 9 && ist.minute >= 0);
      let targetDate = new Date(fromDate);
      if (isPast0900) {
        targetDate = new Date(fromDate.getTime() + 24 * 3600 * 1000);
      }
      const targetIST = this.getISTComponents(targetDate);
      return this.istToUtc(targetIST.year, targetIST.month, targetIST.day, 9, 0);
    }

    if (window === 'EVENING_2100_IST') {
      // Target: 21:00 IST today if before 21:00 IST, else 21:00 IST tomorrow
      const isPast2100 = ist.hour > 21 || (ist.hour === 21 && ist.minute >= 0);
      let targetDate = new Date(fromDate);
      if (isPast2100) {
        targetDate = new Date(fromDate.getTime() + 24 * 3600 * 1000);
      }
      const targetIST = this.getISTComponents(targetDate);
      return this.istToUtc(targetIST.year, targetIST.month, targetIST.day, 21, 0);
    }

    // CONTINUOUS_HOURLY: next hour on the hour (e.g. 10:00, 11:00)
    const nextHour = new Date(fromDate.getTime() + 3600 * 1000);
    nextHour.setMinutes(0, 0, 0);
    return nextHour;
  }

  /**
   * Generates a unique, window-aligned idempotency key for a workflow run.
   * Prevents duplicate logical jobs within the same schedule window.
   */
  public static getIdempotencyKey(workflowId: string, date: Date = new Date()): string {
    const ist = this.getISTComponents(date);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateStr = `${ist.year}-${pad(ist.month)}-${pad(ist.day)}`;
    const window = this.getWorkflowWindow(workflowId);

    if (window === 'MORNING_0900_IST') {
      return `job_${dateStr}_0900_${workflowId}`;
    }
    if (window === 'EVENING_2100_IST') {
      return `job_${dateStr}_2100_${workflowId}`;
    }
    // Continuous hourly: hourly bucket
    return `job_${dateStr}_h${pad(ist.hour)}_${workflowId}`;
  }

  /**
   * Evaluates which workflows are eligible to be enqueued at the current time.
   */
  public static getEligibleWorkflowIds(now: Date = new Date(), forceAll: boolean = false): string[] {
    if (forceAll) {
      return [
        ...MORNING_0900_WORKFLOWS,
        ...EVENING_2100_WORKFLOWS,
        ...CONTINUOUS_HOURLY_WORKFLOWS
      ];
    }

    const eligible: string[] = [...CONTINUOUS_HOURLY_WORKFLOWS];

    if (this.isMorning0900Window(now)) {
      eligible.push(...MORNING_0900_WORKFLOWS);
    }

    if (this.isEvening2100Window(now)) {
      eligible.push(...EVENING_2100_WORKFLOWS);
    }

    return eligible;
  }
}
