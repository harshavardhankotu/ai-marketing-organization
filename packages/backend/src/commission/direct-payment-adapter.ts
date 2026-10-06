/**
 * DirectPaymentProviderAdapter — Isolates direct payment collection for Phase 1.
 *
 * In Phase 1:
 * - Direct payments (Razorpay / Stripe) are strictly DISABLED.
 * - The system operates on an autonomous commission / referral model.
 * - Missing Razorpay or Stripe credentials DO NOT block commercial operations.
 * - When direct payments are re-enabled in a future phase, this adapter activates them.
 */

export class DirectPaymentProviderAdapter {
  private static instance: DirectPaymentProviderAdapter;

  public static readonly STATUS = 'FUTURE / DISABLED_IN_PHASE_1' as const;
  public static readonly PHASE = 'PHASE_1_COMMISSION_ONLY' as const;

  public static getInstance(): DirectPaymentProviderAdapter {
    if (!DirectPaymentProviderAdapter.instance) {
      DirectPaymentProviderAdapter.instance = new DirectPaymentProviderAdapter();
    }
    return DirectPaymentProviderAdapter.instance;
  }

  /**
   * Always returns false during Phase 1.
   * Direct customer payment collection is disabled in favor of referral/affiliate commission.
   */
  public isDirectPaymentEnabled(): boolean {
    return false;
  }

  /**
   * Diagnostic status reporting
   */
  public getStatus() {
    return {
      phase: DirectPaymentProviderAdapter.PHASE,
      status: DirectPaymentProviderAdapter.STATUS,
      enabled: false,
      message: 'Direct payment collection is disabled in Phase 1. System operates via External Conversion & Commission Engine.',
      supportedDirectGateways: ['RAZORPAY', 'STRIPE'],
      activeCommercialModel: 'AUTONOMOUS_COMMISSION_REFERRAL'
    };
  }

  /**
   * Safe guard that prevents any accidental payment link creation or checkout in Phase 1
   */
  public assertDirectPaymentAvailable(): void {
    throw new Error(
      `DIRECT_PAYMENT_DISABLED: Direct customer payment collection is disabled in Phase 1 (${DirectPaymentProviderAdapter.STATUS}). Commercial actions must route via partner referrals and commissions.`
    );
  }
}
