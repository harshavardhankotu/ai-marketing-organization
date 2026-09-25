export interface StrategyInput {
  businessId: string;
  businessName: string;
  verticalId: string;
  verticalName: string;
  city: string;
  neighborhood?: string;
  monthlyBudgetINR: number;
  targetGoalTitle?: string;
  targetValue?: number;
  researchFindings?: {
    topic: string;
    finding: string;
    extractedEvidence?: string;
  }[];
}

export interface ChannelAllocation {
  channel: string;
  allocationPercent: number;
  allocatedBudgetINR: number;
  rationale: string;
  tactics: string[];
}

export interface ComputedStrategy {
  strategyTitle: string;
  positioning: string;
  primaryOffer: string;
  targetAudience: string[];
  channelStrategy: ChannelAllocation[];
  expectedLeads: number;
  expectedCPQLINR: number;
  contentThemes: string[];
  rationale: string;
  decisionRulesApplied: string[];
}

export class StrategyMatchingEngine {
  private static instance: StrategyMatchingEngine;

  public static getInstance(): StrategyMatchingEngine {
    if (!StrategyMatchingEngine.instance) {
      StrategyMatchingEngine.instance = new StrategyMatchingEngine();
    }
    return StrategyMatchingEngine.instance;
  }

  /**
   * Computes a deterministic, inspectable marketing strategy and channel allocation
   * using business vertical characteristics, budget tiers, geographic density, and verified research.
   */
  public computeStrategy(input: StrategyInput): ComputedStrategy {
    const budget = Math.max(0, input.monthlyBudgetINR || 0);
    const vertical = (input.verticalId || '').toUpperCase();
    const city = input.city || 'India';
    const neighborhood = input.neighborhood ? ` (${input.neighborhood})` : '';
    const rulesApplied: string[] = [];

    let allocations: ChannelAllocation[] = [];
    let positioning = '';
    let primaryOffer = '';
    let audience: string[] = [];
    let themes: string[] = [];
    let baseCPQL = 500;

    // 1. Vertical & Budget Rule Set
    if (vertical.includes('DENTAL') || vertical.includes('HEALTHCARE') || vertical.includes('CLINIC')) {
      baseCPQL = budget > 50000 ? 550 : 450;
      positioning = `Ethical, Doctor-Led Care with Upfront Transparent Pricing in ${city}${neighborhood}`;
      primaryOffer = 'Complimentary Initial Examination & Digital Consultation Slot';
      audience = ['Local families and working professionals seeking verified clinical specialists'];
      themes = ['Clinical Credentials & Safety', 'Transparent Pricing Without Surprises', 'Flexible Payment & Consultation Booking'];
      rulesApplied.push('VERTICAL_RULE: Healthcare requires high-trust WhatsApp confirmation and local discovery.');

      if (budget === 0) {
        rulesApplied.push('BUDGET_RULE: ₹0 budget triggers 100% organic local discovery portfolio.');
        allocations = [
          {
            channel: 'GOOGLE_BUSINESS_PROFILE',
            allocationPercent: 45,
            allocatedBudgetINR: 0,
            rationale: 'Local Google Maps searches represent the highest-intent free patient inquiry channel.',
            tactics: ['Weekly photo updates', 'FAQ schema population', 'Review collection automation']
          },
          {
            channel: 'WHATSAPP_INBOUND',
            allocationPercent: 35,
            allocatedBudgetINR: 0,
            rationale: 'Direct WhatsApp links reduce appointment friction to single-tap in Indian tier-1/2 cities.',
            tactics: ['Instant greeting message', 'Consultation slot reservation flow']
          },
          {
            channel: 'ORGANIC_SEO',
            allocationPercent: 20,
            allocatedBudgetINR: 0,
            rationale: 'Localized informational guides rank for high-intent geo-queries.',
            tactics: ['Localized service guides', 'Doctor-authored treatment explanations']
          }
        ];
      } else if (budget < 25000) {
        rulesApplied.push('BUDGET_RULE: Lean budget prioritizes high-conversion WhatsApp + Local Map presence.');
        allocations = [
          {
            channel: 'WHATSAPP_INBOUND',
            allocationPercent: 45,
            allocatedBudgetINR: Math.round(budget * 0.45),
            rationale: 'Primary conversion vehicle for high-touch inquiries.',
            tactics: ['Click-to-WhatsApp direct ads', 'Automated slot confirmation']
          },
          {
            channel: 'GOOGLE_BUSINESS_PROFILE',
            allocationPercent: 35,
            allocatedBudgetINR: Math.round(budget * 0.35),
            rationale: 'Captures proximity-based searchers near the clinic location.',
            tactics: ['Local review showcase', 'Clinic timing verification']
          },
          {
            channel: 'META_ADS',
            allocationPercent: 20,
            allocatedBudgetINR: Math.round(budget * 0.20),
            rationale: 'Localized Instagram feed ads targeting nearby neighborhood radius.',
            tactics: ['Doctor video introduction', 'Patient comfort testimonial']
          }
        ];
      } else {
        rulesApplied.push('BUDGET_RULE: Full growth budget incorporates Google Search Ads for intent dominance.');
        allocations = [
          {
            channel: 'GOOGLE_SEARCH_ADS',
            allocationPercent: 40,
            allocatedBudgetINR: Math.round(budget * 0.40),
            rationale: 'Direct capture of high-commercial-intent search queries.',
            tactics: ['Exact match geo-keywords', 'Call extensions and local sitelinks']
          },
          {
            channel: 'WHATSAPP_INBOUND',
            allocationPercent: 30,
            allocatedBudgetINR: Math.round(budget * 0.30),
            rationale: 'Immediate consultation triage and appointment booking.',
            tactics: ['Dedicated care coordinator number', '2-minute response SLA']
          },
          {
            channel: 'META_ADS',
            allocationPercent: 20,
            allocatedBudgetINR: Math.round(budget * 0.20),
            rationale: 'Visual trust building and video case studies.',
            tactics: ['Video reels', 'Carousel explanations']
          },
          {
            channel: 'GOOGLE_BUSINESS_PROFILE',
            allocationPercent: 10,
            allocatedBudgetINR: Math.round(budget * 0.10),
            rationale: 'Local map pack retention and reputation upkeep.',
            tactics: ['Review response workflows', 'Profile post updates']
          }
        ];
      }
    } else if (vertical.includes('RESTAURANT') || vertical.includes('CAFE') || vertical.includes('FOOD')) {
      baseCPQL = 80;
      positioning = `Signature Culinary Experience & Premium Ambience in ${city}${neighborhood}`;
      primaryOffer = "Chef's Tasting Privilege — Reserve Table & Receive Welcome Dessert";
      audience = ['Food enthusiasts, young professionals, and weekend dining groups'];
      themes = ['Culinary Artistry', 'Weekend Ambience & Live Music', 'Chef Special Highlights'];
      rulesApplied.push('VERTICAL_RULE: Hospitality & Dining requires heavy visual media and Google Maps discovery.');

      allocations = [
        {
          channel: 'META_ADS',
          allocationPercent: 50,
          allocatedBudgetINR: Math.round(budget * 0.50),
          rationale: 'Instagram Reels & Stories drive visual food craving and weekend reservation spikes.',
          tactics: ['Short-form food preparation reels', 'Weekend table reservation promo']
        },
        {
          channel: 'GOOGLE_BUSINESS_PROFILE',
          allocationPercent: 35,
          allocatedBudgetINR: Math.round(budget * 0.35),
          rationale: 'Top source for "best restaurants near me" hungry searchers.',
          tactics: ['Menu photo uploads', 'Directions & direct call links']
        },
        {
          channel: 'WHATSAPP_INBOUND',
          allocationPercent: 15,
          allocatedBudgetINR: Math.round(budget * 0.15),
          rationale: 'VIP guest table reservations and private event inquiries.',
          tactics: ['Automated reservation bot', 'Special occasion reminders']
        }
      ];
    } else if (vertical.includes('REAL_ESTATE') || vertical.includes('BUILDER') || vertical.includes('PROPERTY')) {
      baseCPQL = 1200;
      positioning = `Curated High-Yield Properties & Premium Residential Communities in ${city}`;
      primaryOffer = 'Exclusive Pre-Launch Floorplan Dossier & Complimentary Site Visit';
      audience = ['High-net-worth individuals, NRI investors, and upgrade home buyers'];
      themes = ['Project Connectivity & Appreciation Potential', 'Construction Quality & Amenities', 'Transparent RERA Documentation'];
      rulesApplied.push('VERTICAL_RULE: Real Estate requires high-ticket lead qualification and comprehensive dossiers.');

      allocations = [
        {
          channel: 'GOOGLE_SEARCH_ADS',
          allocationPercent: 45,
          allocatedBudgetINR: Math.round(budget * 0.45),
          rationale: 'Captures buyers actively searching for 2BHK/3BHK apartments and luxury villas.',
          tactics: ['High-intent location keywords', 'Lead capture landing pages']
        },
        {
          channel: 'META_ADS',
          allocationPercent: 35,
          allocatedBudgetINR: Math.round(budget * 0.35),
          rationale: 'Video walkthroughs and high-production drone footage for aspirational buyers.',
          tactics: ['Lead generation instant forms', 'Project video tours']
        },
        {
          channel: 'WHATSAPP_INBOUND',
          allocationPercent: 20,
          allocatedBudgetINR: Math.round(budget * 0.20),
          rationale: 'Direct relationship manager interaction and PDF brochure dispatch.',
          tactics: ['Instant brochure auto-send', 'Site visit scheduling']
        }
      ];
    } else if (vertical.includes('EDUCATION') || vertical.includes('COACHING') || vertical.includes('ACADEMY')) {
      baseCPQL = 400;
      positioning = `Proven Academic Excellence & Structured Mentorship in ${city}`;
      primaryOffer = 'Free Diagnostic Skill Assessment & 2-Day Interactive Trial Class';
      audience = ['Parents seeking competitive exam prep (JEE/NEET/Boards) and career aspirants'];
      themes = ['Audited Results & Rank Holders', 'Faculty Pedagogy & Doubt Clearing', 'Batch Sizes & Student Care'];
      rulesApplied.push('VERTICAL_RULE: Education focuses on demonstrable pedagogical proof and parental trust.');

      allocations = [
        {
          channel: 'GOOGLE_SEARCH_ADS',
          allocationPercent: 40,
          allocatedBudgetINR: Math.round(budget * 0.40),
          rationale: 'Parents actively searching for coaching institutes before academic session starts.',
          tactics: ['Course specific keywords', 'Admission enquiry extensions']
        },
        {
          channel: 'YOUTUBE_ORGANIC',
          allocationPercent: 30,
          allocatedBudgetINR: Math.round(budget * 0.30),
          rationale: 'Video classroom lectures and faculty concept explainers prove teaching quality.',
          tactics: ['Topic revision series', 'Student success interviews']
        },
        {
          channel: 'WHATSAPP_INBOUND',
          allocationPercent: 20,
          allocatedBudgetINR: Math.round(budget * 0.20),
          rationale: 'Direct counselor advice and syllabus brochure delivery.',
          tactics: ['Counseling appointment scheduler', 'Fee structure details']
        },
        {
          channel: 'META_ADS',
          allocationPercent: 10,
          allocatedBudgetINR: Math.round(budget * 0.10),
          rationale: 'Neighborhood parent group outreach and testimonial banners.',
          tactics: ['Scholarship announcement graphics']
        }
      ];
    } else {
      // General SMB Default
      baseCPQL = 500;
      positioning = `Trusted Quality, Rapid Turnaround, and Transparent Pricing in ${city}${neighborhood}`;
      primaryOffer = 'Introductory First-Order Privilege & Free Consultation Assessment';
      audience = ['Local consumers and businesses seeking reliable service providers'];
      themes = ['Verified Client Reviews', 'Punctual Delivery Guarantee', 'Transparent Quotations'];
      rulesApplied.push('VERTICAL_RULE: General SMB balanced multichannel acquisition mix.');

      allocations = [
        {
          channel: 'GOOGLE_BUSINESS_PROFILE',
          allocationPercent: 40,
          allocatedBudgetINR: Math.round(budget * 0.40),
          rationale: 'Foundation for all local commercial search visibility.',
          tactics: ['Regular business hours maintenance', 'Local customer reviews']
        },
        {
          channel: 'WHATSAPP_INBOUND',
          allocationPercent: 35,
          allocatedBudgetINR: Math.round(budget * 0.35),
          rationale: 'Immediate chat interaction and quote delivery.',
          tactics: ['Click-to-chat on website and social profiles']
        },
        {
          channel: 'META_ADS',
          allocationPercent: 25,
          allocatedBudgetINR: Math.round(budget * 0.25),
          rationale: 'Brand recognition and retargeting across Facebook & Instagram.',
          tactics: ['Customer before/after stories', 'Introductory offer promotion']
        }
      ];
    }

    // 2. Adjust Strategy from Real Research Findings
    if (input.researchFindings && input.researchFindings.length > 0) {
      rulesApplied.push(`RESEARCH_ADAPTATION: Processed ${input.researchFindings.length} real research finding(s).`);
      const combinedText = input.researchFindings.map(f => `${f.topic} ${f.finding}`).join(' ').toLowerCase();

      if (combinedText.includes('price') || combinedText.includes('cost') || combinedText.includes('expensive')) {
        rulesApplied.push('RESEARCH_SIGNAL: Price sensitivity detected in search data — reinforced EMI and transparent quotes in primary offer.');
        primaryOffer += ' (Zero-Cost EMI & Transparent Written Estimates)';
      }

      if (combinedText.includes('review') || combinedText.includes('complaint') || combinedText.includes('wait time')) {
        rulesApplied.push('RESEARCH_SIGNAL: Review grievances found in local market — shifted positioning to punctual appointment guarantee.');
        positioning = `Guaranteed Zero-Wait Appointments & ${positioning}`;
      }
    }

    const targetVal = input.targetValue || (budget > 0 ? Math.max(10, Math.round(budget / baseCPQL)) : 25);
    const expectedCPQL = budget > 0 ? Math.round(budget / targetVal) : 0;

    return {
      strategyTitle: `${input.businessName} Precision Local Acquisition Strategy`,
      positioning,
      primaryOffer,
      targetAudience: audience,
      channelStrategy: allocations,
      expectedLeads: targetVal,
      expectedCPQLINR: expectedCPQL,
      contentThemes: themes,
      rationale: `Formulated via algorithmic matching for ${input.verticalName || 'SMB'} in ${city}${neighborhood} with ₹${budget.toLocaleString('en-IN')} monthly budget.`,
      decisionRulesApplied: rulesApplied
    };
  }
}
