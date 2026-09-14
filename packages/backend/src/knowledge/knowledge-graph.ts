import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { KnowledgeGraphEdge, KnowledgeGraphNode } from '@ai-marketing/shared';

export class CampaignKnowledgeGraph {
  private get db() {
    return getDb();
  }

  /**
   * Upserts a node into the graph.
   */
  public upsertNode(node: KnowledgeGraphNode): void {
    const metaStr = JSON.stringify(node.metadata || {});
    this.db
      .prepare(
        `INSERT INTO knowledge_graph_nodes (id, node_type, label, metadata_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           node_type = excluded.node_type,
           label = excluded.label,
           metadata_json = excluded.metadata_json`
      )
      .run(node.id, node.type, node.label, metaStr);
  }

  /**
   * Upserts an edge connecting two nodes in the graph.
   */
  public upsertEdge(edge: KnowledgeGraphEdge): void {
    const weight = edge.weight !== undefined ? edge.weight : 1.0;
    const verificationStatus = edge.verificationStatus || 'UNVERIFIED';
    const now = edge.timestamp || new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO knowledge_graph_edges (
           id, source_node_id, target_node_id, relation, verification_status, evidence_id, weight, timestamp
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source_node_id = excluded.source_node_id,
           target_node_id = excluded.target_node_id,
           relation = excluded.relation,
           verification_status = excluded.verification_status,
           evidence_id = excluded.evidence_id,
           weight = excluded.weight,
           timestamp = excluded.timestamp`
      )
      .run(
        edge.id,
        edge.sourceNodeId,
        edge.targetNodeId,
        edge.relation,
        verificationStatus,
        edge.evidenceId || null,
        weight,
        now
      );
  }

  /**
   * Retrieves a node by ID.
   */
  public getNode(id: string): KnowledgeGraphNode | null {
    const row = this.db
      .prepare('SELECT * FROM knowledge_graph_nodes WHERE id = ?')
      .get(id) as any;
    if (!row) return null;

    let meta = {};
    try {
      meta = JSON.parse(row.metadata_json);
    } catch {
      meta = {};
    }

    return {
      id: row.id,
      type: row.node_type as any,
      label: row.label,
      metadata: meta,
    };
  }

  /**
   * Returns all nodes and edges in the knowledge graph.
   */
  public getGraph(): { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] } {
    const nodeRows = this.db.prepare('SELECT * FROM knowledge_graph_nodes').all() as any[];
    const edgeRows = this.db.prepare('SELECT * FROM knowledge_graph_edges').all() as any[];

    const nodes: KnowledgeGraphNode[] = nodeRows.map((r) => {
      let meta = {};
      try {
        meta = JSON.parse(r.metadata_json);
      } catch {
        meta = {};
      }
      return {
        id: r.id,
        type: r.node_type as any,
        label: r.label,
        metadata: meta,
      };
    });

    const edges: KnowledgeGraphEdge[] = edgeRows.map((r) => ({
      id: r.id,
      sourceNodeId: r.source_node_id,
      targetNodeId: r.target_node_id,
      relation: r.relation,
      verificationStatus: (r.verification_status as any) || 'UNVERIFIED',
      evidenceId: r.evidence_id || undefined,
      weight: r.weight,
      timestamp: r.timestamp,
    }));

    return { nodes, edges };
  }

  /**
   * Synchronizes the knowledge graph with live campaigns, clicks, journeys, and appointments.
   */
  public syncFromLiveEntities(businessId: string): { nodesCount: number; edgesCount: number } {
    // 1. Campaigns
    const campaigns = this.db
      .prepare('SELECT * FROM campaigns WHERE business_id = ?')
      .all(businessId) as any[];

    for (const c of campaigns) {
      this.upsertNode({
        id: c.id,
        type: 'CAMPAIGN',
        label: c.title || c.name || c.id,
        metadata: {
          channel: c.channel || (c.channels_json ? JSON.parse(c.channels_json)[0] : undefined),
          status: c.status,
          budgetINR: c.budget_inr || c.allocated_budget_inr,
          classification: c.classification,
        },
      });
    }

    // 2. Google Clicks & Keywords
    const clicks = this.db.prepare('SELECT * FROM google_clicks').all() as any[];
    for (const cl of clicks) {
      if (cl.keyword) {
        const kwId = `kw-${cl.keyword.toLowerCase().replace(/\s+/g, '-')}`;
        this.upsertNode({
          id: kwId,
          type: 'KEYWORD',
          label: cl.keyword,
          metadata: {
            campaignId: cl.campaign_id,
            device: cl.device,
            clickType: cl.click_type,
          },
        });

        // Edge: Campaign -> Keyword
        if (cl.campaign_id) {
          this.upsertEdge({
            id: `edge-${cl.campaign_id}-${kwId}`,
            sourceNodeId: cl.campaign_id,
            targetNodeId: kwId,
            relation: 'TARGETS',
            verificationStatus: 'VERIFIED',
            evidenceId: cl.gclid,
            weight: 1.0,
          });
        }
      }
    }

    // 3. Customer Journeys (Leads & Customers)
    const journeys = this.db
      .prepare('SELECT * FROM customer_journeys WHERE business_id = ?')
      .all(businessId) as any[];

    for (const j of journeys) {
      const isCustomer = j.stage === 'CUSTOMER';
      const nodeType = isCustomer ? 'CUSTOMER' : 'LEAD';

      this.upsertNode({
        id: j.id,
        type: nodeType,
        label: j.customer_name || `Visitor ${j.visitor_id.substring(0, 8)}`,
        metadata: {
          stage: j.stage,
          classification: j.classification,
          channel: j.first_touch_channel,
          gclid: j.gclid,
          attributionStatus: j.attribution_status,
        },
      });

      // Edge from Campaign to Journey with qualified relation
      let touchpoints: any[] = [];
      try {
        touchpoints = JSON.parse(j.touchpoints_json || '[]');
      } catch {
        touchpoints = [];
      }
      const cmpId = touchpoints[0]?.campaignId;
      if (cmpId) {
        if (!this.getNode(cmpId)) {
          this.upsertNode({
            id: cmpId,
            type: 'CAMPAIGN',
            label: `Campaign ${cmpId}`,
            metadata: { inferred: true },
          });
        }

        // Invariant 8: Qualified relation: POSSIBLY_ATTRIBUTED_TO vs VERIFIED_ATTRIBUTED_TO
        const isVerified = j.attribution_status === 'VERIFIED';
        const relation = isVerified ? 'VERIFIED_ATTRIBUTED_TO' : 'POSSIBLY_ATTRIBUTED_TO';
        const status = isVerified ? 'VERIFIED' : 'UNVERIFIED';

        this.upsertEdge({
          id: `edge-${cmpId}-${j.id}`,
          sourceNodeId: cmpId,
          targetNodeId: j.id,
          relation,
          verificationStatus: status,
          evidenceId: j.gclid || undefined,
          weight: 1.0,
        });
      }
    }

    // 4. Appointments (Consultations)
    const appts = this.db
      .prepare('SELECT * FROM appointments WHERE business_id = ?')
      .all(businessId) as any[];

    for (const a of appts) {
      this.upsertNode({
        id: a.id,
        type: 'CONSULTATION',
        label: `Consultation: ${a.patient_name} (${a.service})`,
        metadata: {
          journeyId: a.journey_id,
          appointmentDate: a.appointment_date,
          clinicLocation: a.clinic_location,
          status: a.clinic_confirmation,
        },
      });

      const relation = a.clinic_confirmation === 'CONFIRMED' ? 'ATTENDED' : 'SCHEDULED';

      // Edge: Lead -> Consultation
      this.upsertEdge({
        id: `edge-${a.journey_id}-${a.id}`,
        sourceNodeId: a.journey_id,
        targetNodeId: a.id,
        relation,
        verificationStatus: a.clinic_confirmation === 'CONFIRMED' ? 'VERIFIED' : 'UNVERIFIED',
        weight: 1.0,
      });
    }

    // 5. Treatment Plans
    try {
      const tplans = this.db
        .prepare('SELECT * FROM treatment_plans WHERE business_id = ?')
        .all(businessId) as any[];

      for (const tp of tplans) {
        this.upsertNode({
          id: tp.id,
          type: 'TREATMENT_PLAN',
          label: `Treatment Plan: ${tp.service} (Quote: ₹${tp.quoted_amount_inr})`,
          metadata: {
            journeyId: tp.journey_id,
            service: tp.service,
            quotedAmountINR: tp.quoted_amount_inr,
            acceptedTreatmentAmountINR: tp.accepted_treatment_amount_inr,
            depositAmountINR: tp.deposit_amount_inr,
            paidAmountINR: tp.paid_amount_inr,
            outstandingAmountINR: tp.outstanding_amount_inr,
            clinicConfirmation: tp.clinic_confirmation,
            status: tp.status,
          },
        });

        if (tp.journey_id) {
          const relation = tp.status === 'ACCEPTED' ? 'ACCEPTED_TREATMENT' : 'PROPOSED';
          this.upsertEdge({
            id: `edge-${tp.journey_id}-${tp.id}`,
            sourceNodeId: tp.journey_id,
            targetNodeId: tp.id,
            relation,
            verificationStatus: tp.clinic_confirmation === 'CONFIRMED' ? 'VERIFIED' : 'UNVERIFIED',
            weight: tp.quoted_amount_inr,
          });
        }
      }
    } catch {}

    // 6. Transactions & Revenue
    const txs = this.db
      .prepare("SELECT * FROM transactions WHERE business_id = ? AND status = 'SUCCESS'")
      .all(businessId) as any[];

    for (const tx of txs) {
      this.upsertNode({
        id: tx.id,
        type: 'TRANSACTION',
        label: `Invoice ${tx.invoice_number} (₹${tx.amount_inr})`,
        metadata: {
          amountINR: tx.amount_inr,
          paymentMethod: tx.payment_method,
          classification: tx.classification,
          journeyId: tx.journey_id,
        },
      });

      if (tx.journey_id) {
        this.upsertEdge({
          id: `edge-${tx.journey_id}-${tx.id}`,
          sourceNodeId: tx.journey_id,
          targetNodeId: tx.id,
          relation: 'PAID_DEPOSIT',
          verificationStatus: tx.classification === 'REAL' ? 'VERIFIED' : 'UNVERIFIED',
          evidenceId: tx.transaction_ref || undefined,
          weight: tx.amount_inr,
        });
      }
    }

    const { nodes, edges } = this.getGraph();
    return { nodesCount: nodes.length, edgesCount: edges.length };
  }
}
