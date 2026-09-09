import { getDb } from '../db/client.js';

export class KillSwitchController {
  public static trigger(businessId: string, orgId: string, actorId: string, reason: string): void {
    const db = getDb();

    db.transaction(() => {
      // 1. Activate kill switch on business
      db.prepare(`
        UPDATE businesses
        SET kill_switch_active = 1,
            kill_switch_reason = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(reason, businessId);

      // 2. Pause all running workflows
      db.prepare(`
        UPDATE workflows
        SET status = 'EMERGENCY_STOPPED',
            error_info = ?,
            updated_at = datetime('now')
        WHERE business_id = ? AND status IN ('RUNNING', 'PENDING', 'WAITING_FOR_APPROVAL')
      `).run(`Emergency Kill Switch engaged: ${reason}`, businessId);

      // 3. Pause all active campaigns
      db.prepare(`
        UPDATE campaigns
        SET status = 'PAUSED',
            updated_at = datetime('now')
        WHERE business_id = ? AND status = 'ACTIVE'
      `).run(businessId);

      // 4. Log Audit Record
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, actor_id, actor_type, action, entity_type, entity_id, details_json)
        VALUES (?, ?, ?, 'USER', 'KILL_SWITCH_TRIGGERED', 'BUSINESS', ?, ?)
      `).run(
        `audit_kill_${Date.now()}`,
        orgId,
        actorId,
        businessId,
        JSON.stringify({ reason, timestamp: new Date().toISOString() })
      );
    })();
  }

  public static reset(businessId: string, orgId: string, actorId: string, reason: string): void {
    const db = getDb();

    db.transaction(() => {
      db.prepare(`
        UPDATE businesses
        SET kill_switch_active = 0,
            kill_switch_reason = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(businessId);

      // Resume workflows to PAUSED so they can be reviewed and resumed
      db.prepare(`
        UPDATE workflows
        SET status = 'PAUSED',
            error_info = NULL,
            updated_at = datetime('now')
        WHERE business_id = ? AND status = 'EMERGENCY_STOPPED'
      `).run(businessId);

      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, actor_id, actor_type, action, entity_type, entity_id, details_json)
        VALUES (?, ?, ?, 'USER', 'KILL_SWITCH_RESET', 'BUSINESS', ?, ?)
      `).run(
        `audit_reset_${Date.now()}`,
        orgId,
        actorId,
        businessId,
        JSON.stringify({ reason, timestamp: new Date().toISOString() })
      );
    })();
  }

  public static isEngaged(businessId: string): boolean {
    const db = getDb();
    const row = db.prepare('SELECT kill_switch_active FROM businesses WHERE id = ?').get(businessId) as { kill_switch_active: number } | undefined;
    return row ? row.kill_switch_active === 1 : false;
  }
}