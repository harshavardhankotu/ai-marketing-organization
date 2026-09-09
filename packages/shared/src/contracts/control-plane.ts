// Control Plane Architecture Protocols & Supervisory Services

export interface SupervisoryService {
  name: string;
  role: string;
  scope: 'GOVERNANCE' | 'ORCHESTRATION' | 'QUALITY' | 'SAFETY' | 'EVOLUTION';
  description: string;
}

export const CONTROL_PLANE_SERVICES: Record<string, SupervisoryService> = {
  AI_CEO: {
    name: 'AI CEO',
    role: 'Executive Direction & Goal Alignment',
    scope: 'GOVERNANCE',
    description: 'Deconstructs broad business goals into quarterly OKRs, oversees cross-division priorities, and ensures strategic cohesion.'
  },
  STRATEGY_MANAGER: {
    name: 'Strategy Manager',
    role: 'Marketing Strategy Governance',
    scope: 'ORCHESTRATION',
    description: 'Governs marketing strategy versioning, positioning roadmaps, and channel mix allocations.'
  },
  TASK_PLANNER: {
    name: 'Task Planner',
    role: 'Decomposition & DAG Construction',
    scope: 'ORCHESTRATION',
    description: 'Breaks down strategies into executable tasks and creates directed acyclic dependency graphs.'
  },
  TASK_DISPATCHER: {
    name: 'Task Dispatcher',
    role: 'Worker Scheduling & Quota Enforcement',
    scope: 'ORCHESTRATION',
    description: 'Dispatches tasks to the 80 agents according to priority, concurrency limits, and token budgets.'
  },
  PRIORITY_MANAGER: {
    name: 'Priority Manager',
    role: 'Dynamic Priority Queuing',
    scope: 'ORCHESTRATION',
    description: 'Balances CRITICAL path tasks against BACKGROUND exploratory research under free-tier quotas.'
  },
  DEPENDENCY_MANAGER: {
    name: 'Dependency Manager',
    role: 'State Precondition Resolution',
    scope: 'ORCHESTRATION',
    description: 'Ensures campaigns cannot be launched until strategy is approved and research evidence exists.'
  },
  CAMPAIGN_MANAGER: {
    name: 'Campaign Manager',
    role: 'Flight & Budget Orchestration',
    scope: 'ORCHESTRATION',
    description: 'Manages campaign lifecycle states, scheduling, spend tracking, and channel distribution.'
  },
  CONTENT_MANAGER: {
    name: 'Content Manager',
    role: 'Asset Lifecycle & Multi-Lingual Versioning',
    scope: 'QUALITY',
    description: 'Oversees content drafts, translation accuracy across Indian languages, and repurposing workflows.'
  },
  RESEARCH_MANAGER: {
    name: 'Research Manager',
    role: 'Evidence Hub & Sourcing Protocol',
    scope: 'QUALITY',
    description: 'Enforces evidence classification (Observed, Inferred, Hypothesized, Confirmed) and confidence thresholds.'
  },
  DATA_MANAGER: {
    name: 'Data Manager',
    role: 'Telemetry Ingestion & Schema Sanitization',
    scope: 'QUALITY',
    description: 'Normalizes inbound marketing analytics events and deduplicates webhook transmissions.'
  },
  EXPERIMENT_MANAGER: {
    name: 'Experiment Manager',
    role: 'Hypothesis & Split-Test Rigor',
    scope: 'EVOLUTION',
    description: 'Governs A/B and multivariate tests with statistical significance requirements.'
  },
  APPROVAL_MANAGER: {
    name: 'Approval Manager',
    role: 'Human-in-the-loop Governance',
    scope: 'SAFETY',
    description: 'Calculates risk scores based on spend, public publishing channels, and sector regulations; pauses execution for human review.'
  },
  QUALITY_MANAGER: {
    name: 'Quality Manager',
    role: 'Pre-Flight Asset Verification',
    scope: 'QUALITY',
    description: 'Ensures all outbound content meets formatting standards and passes schema checks.'
  },
  BRAND_GUARDIAN: {
    name: 'Brand Guardian',
    role: 'Tone & Vocabulary Fidelity',
    scope: 'SAFETY',
    description: 'Guarantees all communications strictly align with the business brand voice and ethical boundaries.'
  },
  FACT_CHECKER: {
    name: 'Fact Checker',
    role: 'Hallucination & Claim Verification',
    scope: 'SAFETY',
    description: 'Screens generated claims against medical, legal, and pricing facts; flags unsupported statistics.'
  },
  COMPLIANCE_GUARDIAN: {
    name: 'Compliance Guardian',
    role: 'Indian Advertising Regulatory Compliance',
    scope: 'SAFETY',
    description: 'Checks marketing materials against ASCI guidelines, MCI regulations, and consumer protection acts.'
  },
  BUDGET_CONTROLLER: {
    name: 'Budget Controller',
    role: 'Rupee & Token Spend Enforcer',
    scope: 'SAFETY',
    description: 'Enforces strict monthly INR budgets and daily Gemini token limits; triggers circuit breaker on spikes.'
  },
  PERFORMANCE_MANAGER: {
    name: 'Performance Manager',
    role: 'Agent Routing Optimization',
    scope: 'EVOLUTION',
    description: 'Tracks completion rates, latency, and downstream accuracy for all 80 agents; adjusts task assignments.'
  },
  KNOWLEDGE_MANAGER: {
    name: 'Knowledge Manager',
    role: 'Domain Memory Curation',
    scope: 'QUALITY',
    description: 'Manages multi-scoped memory, removes stale market intelligence, and indexes business assets.'
  },
  MEMORY_MANAGER: {
    name: 'Memory Manager',
    role: 'Context Assembly Engine',
    scope: 'ORCHESTRATION',
    description: 'Constructs bounded, relevant context packages for model calls without prompt bloat.'
  },
  LEARNING_MANAGER: {
    name: 'Learning Manager',
    role: 'Closed-Loop Strategy Evolution',
    scope: 'EVOLUTION',
    description: 'Translates validated experiment outcomes into formal strategy versions (v1 -> v2) and policy updates.'
  },
  EXECUTIVE_REPORTER: {
    name: 'Executive Reporter',
    role: 'Owner-Facing Digest & Decision Journal',
    scope: 'GOVERNANCE',
    description: 'Prepares transparent executive summaries highlighting decisions, ROI, and upcoming actions.'
  }
};