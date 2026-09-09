import { z } from 'zod';

export const CreateBusinessProfileSchema = z.object({
  name: z.string().min(2, 'Business name must be at least 2 characters'),
  verticalId: z.string(),
  verticalName: z.string(),
  city: z.string().min(2),
  neighborhood: z.string().min(2),
  primaryLanguage: z.string().default('English'),
  secondaryLanguages: z.array(z.string()).default(['Hindi']),
  brandVoice: z.string().min(5),
  monthlyBudgetINR: z.number().min(1000, 'Monthly budget must be at least ₹1,000'),
  autonomyMode: z.enum(['SAFE', 'ASSISTED', 'AUTONOMOUS']).default('ASSISTED'),
  offerings: z.array(z.object({
    id: z.string().optional(),
    title: z.string().min(2),
    description: z.string(),
    priceINR: z.number().min(0),
    targetSegment: z.string()
  })).min(1, 'At least one offering is required'),
  valuePropositions: z.array(z.string()).min(1),
  websiteUrl: z.string().optional(),
  phone: z.string().optional()
});

export const CreateGoalSchema = z.object({
  businessId: z.string(),
  title: z.string().min(5),
  targetMetric: z.string(),
  targetValue: z.number().positive(),
  metricUnit: z.string().default('leads'),
  timeframeDays: z.number().int().positive().default(90),
  budgetAllocatedINR: z.number().min(1000)
});

export const CreateCampaignSchema = z.object({
  businessId: z.string(),
  goalId: z.string(),
  strategyId: z.string().optional(),
  title: z.string().min(3),
  objective: z.string().min(10),
  channels: z.array(z.string()).min(1),
  targetAudience: z.string(),
  city: z.string(),
  neighborhoods: z.array(z.string()),
  budgetINR: z.number().positive(),
  primaryKPI: z.string(),
  targetQualifiedLeads: z.number().int().positive(),
  startDate: z.string(),
  endDate: z.string()
});

export const GenerateContentSchema = z.object({
  campaignId: z.string(),
  agentId: z.string(),
  channel: z.string(),
  contentType: z.enum(['POST', 'STORY', 'REEL_SCRIPT', 'WHATSAPP_MESSAGE', 'AD_COPY', 'EMAIL', 'LANDING_PAGE']),
  language: z.string(),
  targetFunnelStage: z.enum(['AWARENESS', 'CONSIDERATION', 'CONVERSION', 'RETENTION']),
  topicOrOffer: z.string().min(5)
});

export const ApprovalActionSchema = z.object({
  requestId: z.string(),
  action: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']),
  feedbackNotes: z.string().optional()
});

export const IngestAnalyticsEventSchema = z.object({
  businessId: z.string(),
  campaignId: z.string().optional(),
  contentAssetId: z.string().optional(),
  channel: z.string(),
  eventType: z.enum([
    'impression', 'view', 'click', 'engagement', 'visit',
    'signup', 'lead', 'qualified_lead', 'appointment',
    'purchase', 'revenue', 'retention', 'unsubscribe', 'campaign_interaction'
  ]),
  userIdentifier: z.string().optional(),
  revenueINR: z.number().optional().default(0),
  metadata: z.record(z.any()).optional()
});

export const EmergencyKillSwitchSchema = z.object({
  businessId: z.string(),
  active: z.boolean(),
  reason: z.string().min(5, 'A clear reason is required for toggling the kill switch')
});

export const SimulationRunSchema = z.object({
  businessId: z.string(),
  goalId: z.string(),
  budgetINR: z.number().min(1000),
  channels: z.array(z.string()).min(1),
  durationDays: z.number().min(7).max(180)
});