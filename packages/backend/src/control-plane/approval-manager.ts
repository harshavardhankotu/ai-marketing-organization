import { getDb } from '../db/client.js';
import { AutonomyMode, SectorRiskTier } from '@ai-marketing/shared';

export interface AssessRiskOptions {
  businessId: string;
  entityType: 'CAMPAIGN' | 'CONTENT_ASSET' | 'BUDGET_INCREASE' | 'STRATEGY_UPDATE' | 'HIGH_RISK_PUBLISH';
  budgetINR?: number;
  channel?: string;
  hasMedicalOrFinancialClaims?: boolean;
}

export class ApprovalManager {
  public static calculateRiskScore(options: AssessRiskOptions): { score: number; factors: string[]; requiresApproval: boolean } {
    const db = getDb();
    const business = db.prepare('SELECT autonomy_mode, risk_tier FROM businesses WHERE id = ?').get(options.businessId) as {
      autonomy_mode: AutonomyMode;
      risk_tier: SectorRiskTier;
    } | undefined;

    let score = 10;
    const factors: string[] = [];

    // 1. Sector Risk Assessment
    if (business?.risk_tier === 'HIGH') {
      score += 35;
      factors.push('High-risk regulated sector (e.g. Healthcare / MCI guidelines)');
    } else if (business?.risk_tier === 'MEDIUM') {
      score += 15;
      factors.push('Medium-risk sector (e.g. Real Estate / Education)');
    }

    // 2. Financial Commitment Assessment
    if (options.budgetINR && options.budgetINR > 25000) {
      score += 30;
      factors.push(`Significant budget allocation (₹${options.budgetINR.toLocaleString('en-IN')})`);
    } else if (options.budgetINR && options.budgetINR > 5000) {
      score += 15;
      factors.push(`Moderate budget allocation (₹${options.budgetINR.toLocaleString('en-IN')})`);
    }

    // 3. Claims Verification
    if (options.hasMedicalOrFinancialClaims) {
      score += 25;
      factors.push('Specific clinical, therapeutic, or monetary return claims detected');
    }

    // 4. Autonomy Mode Thresholds
    const mode = business?.autonomy_mode || 'ASSISTED';
    let requiresApproval = false;

    if (mode === 'SAFE') {
      requiresApproval = score >= 20; // Conservative
    } else if (mode === 'ASSISTED') {
      requiresApproval = score >= 50; // Moderate
    } else if (mode === 'AUTONOMOUS') {
      requiresApproval = score >= 80; // High threshold
    }

    return { score: Math.min(100, score), factors, requiresApproval };
  }

  public static createApprovalRequest(
    orgId: string,
    businessId: string,
    agentId: string,
    title: string,
    description: string,
    entityType: 'CAMPAIGN' | 'CONTENT_ASSET' | 'BUDGET_INCREASE' | 'STRATEGY_UPDATE' | 'HIGH_RISK_PUBLISH',
    entityId: string,
    riskScore: number,
    riskFactors: string[]
  ): string {
    const db = getDb();
    const id = `apr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    db.prepare(`
      INSERT INTO approval_requests (
        id, organization_id, business_id, requester_agent_id, title,
        description, entity_type, entity_id, risk_score, risk_factors_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `).run(id, orgId, businessId, agentId, title, description, entityType, entityId, riskScore, JSON.stringify(riskFactors));

    return id;
  }

  public static resolveApproval(
    requestId: string,
    action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES',
    userId: string,
    feedbackNotes?: string
  ): void {
    const db = getDb();
    const request = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(requestId) as any;
    if (!request) {
      throw new Error(`Approval request not found: ${requestId}`);
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED';

    db.transaction(() => {
      db.prepare(`
        UPDATE approval_requests
        SET status = ?,
            reviewed_by_user_id = ?,
            feedback_notes = ?,
            resolved_at = datetime('now')
        WHERE id = ?
      `).run(newStatus, userId, feedbackNotes || null, requestId);

      // Update the underlying entity if approved
      if (action === 'APPROVE') {
        if (request.entity_type === 'CAMPAIGN') {
          db.prepare("UPDATE campaigns SET status = 'ACTIVE', updated_at = datetime('now') WHERE id = ?").run(request.entity_id);
        } else if (request.entity_type === 'CONTENT_ASSET') {
          db.prepare("UPDATE content_assets SET status = 'APPROVED', updated_at = datetime('now') WHERE id = ?").run(request.entity_id);
        }
      }

      // Log audit trail
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, actor_id, actor_type, action, entity_type, entity_id, details_json)
        VALUES (?, ?, ?, 'USER', ?, ?, ?, ?)
      `).run(
        `audit_apr_${Date.now()}`,
        request.organization_id,
        userId,
        `APPROVAL_${action}`,
        request.entity_type,
        request.entity_id,
        JSON.stringify({ requestId, feedbackNotes })
      );
    })();
  }
}