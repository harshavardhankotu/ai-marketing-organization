import { getDb } from '../db/client.js';
import { WorkflowStatus, TaskPriority } from '@ai-marketing/shared';

export interface WorkflowStep<TContext = any, TOutput = any> {
  name: string;
  agentId: string;
  priority?: TaskPriority;
  execute: (context: TContext) => Promise<TOutput>;
  validate?: (output: TOutput) => boolean;
}

export interface WorkflowDefinition<TContext = any> {
  type: string;
  steps: WorkflowStep<TContext>[];
}

export class DurableWorkflowEngine {
  private static instance: DurableWorkflowEngine;

  public static getInstance(): DurableWorkflowEngine {
    if (!DurableWorkflowEngine.instance) {
      DurableWorkflowEngine.instance = new DurableWorkflowEngine();
    }
    return DurableWorkflowEngine.instance;
  }

  public createWorkflow(
    orgId: string,
    businessId: string,
    workflowType: string,
    initialInputs: Record<string, any>,
    options?: { goalId?: string; campaignId?: string }
  ): string {
    const db = getDb();
    const id = `wf_${workflowType.toLowerCase()}_${Date.now()}`;

    db.prepare(`
      INSERT INTO workflows (
        id, organization_id, business_id, goal_id, campaign_id,
        workflow_type, status, current_step, inputs_json, outputs_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 'INIT', ?, '{}', datetime('now'), datetime('now'))
    `).run(
      id,
      orgId,
      businessId,
      options?.goalId || null,
      options?.campaignId || null,
      workflowType,
      JSON.stringify(initialInputs)
    );

    return id;
  }

  public async runWorkflow<TContext extends Record<string, any>>(
    workflowId: string,
    definition: WorkflowDefinition<TContext>
  ): Promise<{ status: WorkflowStatus; context: TContext }> {
    const db = getDb();

    // 1. Fetch current workflow record
    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.status === 'EMERGENCY_STOPPED') {
      throw new Error(`Workflow ${workflowId} is emergency stopped.`);
    }

    // 2. Reconstruct context from inputs & latest checkpoint
    let context: TContext = JSON.parse(workflow.inputs_json);

    const latestCheckpoint = db.prepare(`
      SELECT * FROM workflow_checkpoints WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(workflowId) as { step_name: string; state_snapshot_json: string } | undefined;

    let resumeIndex = 0;
    if (latestCheckpoint) {
      context = JSON.parse(latestCheckpoint.state_snapshot_json);
      const lastCompletedIdx = definition.steps.findIndex(s => s.name === latestCheckpoint.step_name);
      if (lastCompletedIdx >= 0) {
        resumeIndex = lastCompletedIdx + 1;
      }
    }

    // 3. Mark RUNNING
    db.prepare(`
      UPDATE workflows 
      SET status = 'RUNNING', updated_at = datetime('now')
      WHERE id = ?
    `).run(workflowId);

    // 4. Step through execution
    for (let i = resumeIndex; i < definition.steps.length; i++) {
      const step = definition.steps[i];

      // Check emergency stop before each step
      const biz = db.prepare('SELECT kill_switch_active FROM businesses WHERE id = ?').get(workflow.business_id) as any;
      if (biz?.kill_switch_active === 1) {
        db.prepare(`
          UPDATE workflows 
          SET status = 'EMERGENCY_STOPPED', error_info = 'Emergency Kill Switch Active', updated_at = datetime('now')
          WHERE id = ?
        `).run(workflowId);
        return { status: 'EMERGENCY_STOPPED', context };
      }

      // Update current step
      db.prepare(`
        UPDATE workflows 
        SET current_step = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(step.name, workflowId);

      try {
        // Execute step
        const output = await step.execute(context);

        // Validate
        if (step.validate && !step.validate(output)) {
          throw new Error(`Output validation failed for step: ${step.name}`);
        }

        // Merge into context
        context[step.name as keyof TContext] = output;

        // Persist checkpoint
        this.saveCheckpoint(workflowId, step.name, context);
      } catch (err: any) {
        db.prepare(`
          UPDATE workflows 
          SET status = 'FAILED', error_info = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(err.message, workflowId);
        throw err;
      }
    }

    // 5. Mark COMPLETED
    db.prepare(`
      UPDATE workflows 
      SET status = 'COMPLETED', outputs_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(context), workflowId);

    return { status: 'COMPLETED', context };
  }

  private saveCheckpoint(workflowId: string, stepName: string, context: any): void {
    const db = getDb();
    const checkpointId = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO workflow_checkpoints (id, workflow_id, step_name, state_snapshot_json, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(checkpointId, workflowId, stepName, JSON.stringify(context));

      db.prepare(`
        UPDATE workflows 
        SET last_successful_checkpoint = ?, status = 'CHECKPOINTED', updated_at = datetime('now')
        WHERE id = ?
      `).run(stepName, workflowId);
    })();
  }
}