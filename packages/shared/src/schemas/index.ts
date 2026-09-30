import { z } from 'zod';

export const CreateBusinessProfileSchema = z.object({
  name: z.string().min(2, 'Business name must be at least 2 characters'),
  verticalId: z.string(),
  verticalName: z.string(),
  country: z.string().min(2),
  currency: z.string().min(3).max(3),
  timezone: z.string().min(3),
  locale: z.string().default('en-US'),
  city: z.string().min(2),
  neighborhood: z.string().min(2),
  serviceArea: z.array(z.string()).optional(),
  primaryLanguage: z.string().min(2),
  secondaryLanguages: z.array(z.string()).default([]),
  brandVoice: z.string().min(5),
  monthlyBudgetINR: z.number().min(0).optional(),
  monthlyBudgetMinor: z.number().min(0).optional(),
  autonomyMode: z.enum(['SAFE', 'ASSISTED', 'AUTONOMOUS']).default('ASSISTED'),
  offerings: z.array(z.object({
    id: z.string().optional(),
    title: z.string().min(2),
    description: z.string(),
    priceINR: z.number().min(0).optional(),
    priceMinor: z.number().min(0).optional(),
    currency: z.string().optional(),
    targetSegment: z.string().optional().default('General')
  })).min(1, 'At least one offering is required'),
  valuePropositions: z.array(z.string()).min(1),
  websiteUrl: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional()
});

export const IndiaOnboardingPreset = {
  country: 'IN',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  primaryLanguage: 'English',
  secondaryLanguages: ['Hindi']
};

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

// Universal Commercial Operating System Schemas
export const CreateFunnelSchema = z.object({
  businessId: z.string(),
  publicSlug: z.string().min(2),
  funnelType: z.enum([
    'CONSULTATION', 'BOOKING', 'QUOTE_REQUEST', 'HIGH_TICKET',
    'DIRECT_PURCHASE', 'LEAD_MAGNET', 'DEMO', 'CONTACT',
    'EVENT_REGISTRATION', 'EMERGENCY', 'UNIVERSAL'
  ]).default('UNIVERSAL'),
  objective: z.string().min(3),
  targetIntent: z.string().optional(),
  audience: z.string().optional(),
  headline: z.string().optional(),
  subheadline: z.string().optional(),
  proofPoints: z.array(z.string()).default([]),
  offerIds: z.array(z.string()).default([]),
  ctaStrategy: z.string().default('BOOK_OR_BUY'),
  qualificationStrategy: z.string().optional(),
  schedulingStrategy: z.string().optional(),
  paymentStrategy: z.enum(['REQUIRED', 'DEPOSIT', 'OPTIONAL', 'NONE']).default('OPTIONAL'),
  language: z.string().default('en'),
  currency: z.string().default('INR'),
  designConfig: z.record(z.any()).default({})
});

export const CustomerOfferSchema = z.object({
  businessId: z.string(),
  title: z.string().min(2),
  description: z.string().default(''),
  category: z.string().default('GENERAL'),
  priceMinor: z.number().min(0),
  currency: z.string().default('INR'),
  billingModel: z.enum(['ONE_TIME', 'MONTHLY', 'ANNUAL', 'DEPOSIT', 'USAGE', 'CUSTOM']).default('ONE_TIME'),
  depositMinor: z.number().optional(),
  targetSegment: z.string().optional(),
  deliverables: z.array(z.string()).default([]),
  qualificationRules: z.array(z.string()).default([]),
  availabilityRules: z.record(z.any()).default({}),
  fulfillmentType: z.enum(['APPOINTMENT', 'SERVICE_DELIVERY', 'DIGITAL', 'SHIPMENT', 'SUBSCRIPTION', 'CONSULTATION']).default('SERVICE_DELIVERY'),
  active: z.boolean().default(true)
});

export const UniversalOrderSchema = z.object({
  businessId: z.string(),
  offerId: z.string(),
  customerName: z.string().min(1),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().min(5),
  amountMinor: z.number().min(0),
  currency: z.string().default('INR'),
  paymentProvider: z.enum(['RAZORPAY', 'STRIPE', 'MANUAL']).optional(),
  metadata: z.record(z.any()).default({})
});

export const StructuredIntentSchema = z.object({
  problem: z.string().optional(),
  serviceOrProduct: z.string().optional(),
  urgency: z.enum(['IMMEDIATE', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  location: z.string().optional(),
  preferredDate: z.string().optional(),
  preferredTime: z.string().optional(),
  budgetRange: z.object({
    minMinor: z.number().optional(),
    maxMinor: z.number().optional(),
    currency: z.string().optional()
  }).optional(),
  customerType: z.enum(['B2B', 'B2C']).optional(),
  purchaseStage: z.enum(['AWARENESS', 'EVALUATING', 'READY_TO_BUY']).optional(),
  quantity: z.number().optional(),
  preferredChannel: z.string().optional(),
  language: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1),
  rawText: z.string()
});

export const BookingReservationSchema = z.object({
  businessId: z.string(),
  slotId: z.string(),
  customerName: z.string().min(1),
  customerContact: z.string().min(5),
  customerEmail: z.string().email().optional(),
  serviceTitle: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  metadata: z.record(z.any()).optional()
});