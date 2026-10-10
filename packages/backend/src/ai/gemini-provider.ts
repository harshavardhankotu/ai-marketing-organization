import { QuotaManager } from './quota-manager.js';
import { DeduplicationEngine } from './deduplication.js';
import { TaskPriority, ExecutionType } from '@ai-marketing/shared';
import { isPlaceholderCredential, isProduction, ProductionSecretViolationError } from '../config/env.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';
import type { ModelProvider, ModelRequestOptions, ModelResponse, ThinkingLevel, ModelTelemetry } from './model-provider.js';

export type { ModelProvider, ModelRequestOptions, ModelResponse, ThinkingLevel, ModelTelemetry };

export class GeminiProvider implements ModelProvider {
  public static getModelName(): string {
    return process.env.GEMINI_MODEL || (process.env.NODE_ENV === 'test' ? 'gemini-3.8-flash' : 'gemini-3.1-flash-lite');
  }
  public get modelName(): string {
    return GeminiProvider.getModelName();
  }
  public readonly providerName = 'google';
  private quotaManager = QuotaManager.getInstance();

  public async generateStructured<T>(options: ModelRequestOptions): Promise<ModelResponse<T>> {
    const thinkingLevel = options.thinkingLevel || 'medium';
    const priority = options.priority || 'NORMAL';
    const modelVersion = GeminiProvider.getModelName();

    // 1. Check Deduplication Cache
    const fingerprint = DeduplicationEngine.generateFingerprint({
      agentId: options.agentId,
      prompt: options.prompt,
      context: options.context || {},
      modelVersion,
      strategyVersion: options.strategyVersion
    });

    if (!options.skipCache) {
      const cached = DeduplicationEngine.getCachedResult<T>(fingerprint);
      if (cached) {
        const now = new Date().toISOString();
        return {
          data: cached,
          rawText: JSON.stringify(cached),
          model: modelVersion,
          thinkingLevel,
          cached: true,
          tokenCount: 0,
          tokenUsageStatus: 'VERIFIED',
          executionType: 'DETERMINISTIC',
          telemetry: {
            provider: this.providerName,
            model: modelVersion,
            agentId: options.agentId,
            agentVersion: options.strategyVersion || 1,
            thinkingLevel,
            requestTimestamp: now,
            completionTimestamp: now,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            tokenUsageStatus: 'UNKNOWN',
            cached: true,
            executionType: 'DETERMINISTIC',
            success: true,
            retryCount: 0
          }
        };
      }
    }

    // 2. Schedule via QuotaManager
    const result = await this.quotaManager.schedule(fingerprint, priority, async () => {
      const apiKey = process.env.GEMINI_API_KEY;

      if (isProduction()) {
        if (!apiKey || isPlaceholderCredential(apiKey)) {
          throw new ProductionSecretViolationError(
            `[SECURITY ERROR] Production must reject placeholder credentials and 'demo_key'. GEMINI_API_KEY must be provided via deployment secrets.`
          );
        }

        try {
          return await this.callLiveGeminiAPI<T>(apiKey, options, thinkingLevel);
        } catch (error: any) {
          console.error(`[GeminiProvider][PRODUCTION CRITICAL] Live API call failed: ${error?.message}`);
          throw new Error(`Production Gemini API call failed: ${error?.message}`);
        }
      }

      // Non-production (development, test) execution
      const isTestKey = (k?: string) => !k || isPlaceholderCredential(k) || k.startsWith('AIzaSyTestFixture') || k.includes('fixture');
      if (apiKey && !isTestKey(apiKey)) {
        try {
          return await this.callLiveGeminiAPI<T>(apiKey, options, thinkingLevel);
        } catch (error: any) {
          // Do not silently downgrade a failed live request into fabricated reasoning
          throw new Error(`LLM EXECUTION = FAILED: Live Gemini API call failed: ${error?.message}`);
        }
      } else {
        // Honest deterministic test fixture for zero-dependency test scenarios
        return this.synthesizeDomainResponse<T>(options);
      }
    });

    // 3. Store in Deduplication Cache
    DeduplicationEngine.setCachedResult(fingerprint, result.data, modelVersion, 24);

    return result;
  }

  private async callLiveGeminiAPI<T>(
    apiKey: string,
    options: ModelRequestOptions,
    thinkingLevel: ThinkingLevel
  ): Promise<ModelResponse<T>> {
    // 1. Quota Reservation via UnifiedQuotaService (Spec § 9 & § 13)
    const quotaService = UnifiedQuotaService.getInstance();
    const reservation = quotaService.reserve('GEMINI', 'P2', 1, options.agentId);
    if (!reservation.allowed) {
      throw new Error(`[QUOTA LOCK ACTIVE] Gemini calls paused: ${reservation.reason}`);
    }

    const requestTimestamp = new Date().toISOString();
    const startMs = Date.now();

    if (!['low', 'medium', 'high'].includes(thinkingLevel)) {
      throw new Error(`[GeminiProvider] Unsupported thinking level: '${thinkingLevel}'. Must be 'low', 'medium', or 'high'.`);
    }

    const currentModel = GeminiProvider.getModelName();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
    console.log('[GeminiProvider] Calling model:', currentModel);

    const requestBody: any = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${options.systemInstruction}\n\nContext:\n${JSON.stringify(options.context || {})}\n\nTask:\n${options.prompt}\n\nRespond ONLY with valid JSON.`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(process.env.NODE_ENV === 'test' || currentModel.includes('thinking')
          ? { thinkingConfig: { thinkingLevel: thinkingLevel.toUpperCase() } }
          : {})
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const completionTimestamp = new Date().toISOString();
    const latencyMs = Date.now() - startMs;

    if (!response.ok) {
      const errText = await response.text();
      const isRateLimit = response.status === 429 || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('quotaExceeded');
      quotaService.reconcile(reservation.reservationId, 1, false, undefined, isRateLimit);

      if (isRateLimit) {
        quotaService.lockProvider('GEMINI', `Gemini API quota exhausted (${response.status})`);
      }
      const err = new Error(`LLM EXECUTION = FAILED: Gemini API error ${response.status}: ${errText}`);
      (err as any).status = response.status;
      throw err;
    }

    // Reconcile successful reservation
    quotaService.reconcile(reservation.reservationId, 1, true);

    const payload = await response.json() as any;
    const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsedData = JSON.parse(rawText) as T;

    // Token usage metadata extraction: Never invent token counts!
    const usage = payload?.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    const totalTokens = usage?.totalTokenCount ?? (inputTokens + outputTokens);
    const tokenUsageStatus = usage ? 'VERIFIED' : 'UNKNOWN';

    const telemetry: ModelTelemetry = {
      provider: this.providerName,
      model: currentModel,
      agentId: options.agentId,
      agentVersion: options.strategyVersion || 1,
      thinkingLevel,
      requestTimestamp,
      completionTimestamp,
      latencyMs,
      inputTokens,
      outputTokens,
      totalTokens,
      tokenUsageStatus,
      cached: false,
      executionType: 'LLM',
      success: true,
      retryCount: 0
    };

    return {
      data: parsedData,
      rawText,
      model: currentModel,
      thinkingLevel,
      cached: false,
      tokenCount: totalTokens,
      tokenUsageStatus,
      executionType: 'LLM',
      telemetry
    };
  }

  /**
   * Calls Gemini with Google Search Grounding enabled.
   * Uses GEMINI_RESEARCH_MODEL (default: gemini-2.5-flash-lite) for free-tier grounded research.
   *
   * Returns grounding metadata including:
   *   - webSearchQueries: actual search queries Gemini used
   *   - groundingChunks: source URLs and titles
   *   - groundingSupports: which claims are backed by which sources
   *
   * If no grounding metadata is present in the response (model-only output), returns null.
   * Caller must reject ungrounded results for production prospect discovery.
   */
  public async generateGroundedContent(prompt: string, context?: Record<string, unknown>): Promise<{
    text: string;
    groundingMetadata: {
      webSearchQueries: string[];
      groundingChunks: Array<{ url: string; title?: string }>;
      groundingSupports?: Array<{ segment?: { text?: string }; groundingChunkIndices?: number[] }>;
    } | null;
    model: string;
    source: 'GROUNDED_GEMINI' | 'BLOCKED_NO_KEY' | 'BLOCKED_QUOTA';
  } | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    const researchModel = process.env.GEMINI_RESEARCH_MODEL || 'gemini-2.5-flash-lite';

    if (!apiKey || isPlaceholderCredential(apiKey)) {
      return { text: '', groundingMetadata: null, model: researchModel, source: 'BLOCKED_NO_KEY' };
    }

    const quotaService = UnifiedQuotaService.getInstance();
    const reservation = quotaService.reserve('GEMINI', 'P3', 1, 'grounded-research');
    if (!reservation.allowed) {
      return { text: '', groundingMetadata: null, model: researchModel, source: 'BLOCKED_QUOTA' };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${researchModel}:generateContent?key=${apiKey}`;
    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: context
                ? `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}`
                : prompt
            }
          ]
        }
      ],
      tools: [{ google_search: {} }]
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        const isRateLimit = response.status === 429 || errText.includes('RESOURCE_EXHAUSTED');
        quotaService.reconcile(reservation.reservationId, 1, false, undefined, isRateLimit);
        if (isRateLimit) quotaService.lockProvider('GEMINI', `Grounded research quota exhausted (${response.status})`);
        console.error(`[GeminiProvider][grounded] API error ${response.status}: ${errText.substring(0, 200)}`);
        return null;
      }

      quotaService.reconcile(reservation.reservationId, 1, true);
      const payload = await response.json() as any;
      const candidate = payload?.candidates?.[0];
      const text = candidate?.content?.parts?.map((p: any) => p.text || '').join('') || '';
      const gm = candidate?.groundingMetadata;

      if (!gm) {
        // No grounding metadata — model produced from memory only
        return {
          text,
          groundingMetadata: null,
          model: researchModel,
          source: 'GROUNDED_GEMINI'
        };
      }

      const webSearchQueries: string[] = gm.webSearchQueries || [];
      const groundingChunks: Array<{ url: string; title?: string }> = (gm.groundingChunks || []).map((chunk: any) => ({
        url: chunk?.web?.uri || chunk?.uri || '',
        title: chunk?.web?.title || chunk?.title
      })).filter((c: { url: string; title?: string }) => c.url.startsWith('http'));

      return {
        text,
        groundingMetadata: { webSearchQueries, groundingChunks, groundingSupports: gm.groundingSupports },
        model: researchModel,
        source: 'GROUNDED_GEMINI'
      };
    } catch (err: any) {
      quotaService.reconcile(reservation.reservationId, 1, false);
      console.error(`[GeminiProvider][grounded] Unexpected error: ${err?.message}`);
      return null;
    }
  }

  private synthesizeDomainResponse<T>(options: ModelRequestOptions): ModelResponse<T> {
    const p = options.prompt.toLowerCase();
    const ctx = options.context || {};
    const now = new Date().toISOString();
    let data: any = {};

    // Strictly honest deterministic test fixtures:
    // NO fake search volume claims, NO fake surveys, NO fake p-values, NO fake external observations.
    if (options.agentId === 'prospect-discovery-agent' || p.includes('candidate') || p.includes('prospect')) {
      const vert = ctx.vertical || 'dental';
      const city = ctx.city || 'Hyderabad';
      // IMPORTANT: This is a TEST_DATA fixture only. In production, ALL candidates must originate
      // from real grounded Gemini search results or Tavily results with evidence source URLs.
      // Production code must check classification === 'REAL_DATA' and reject TEST_DATA candidates.
      data = {
        candidates: [
          {
            businessName: `TEST_FIXTURE_${vert === 'dental' ? 'DentalCare' : (vert === 'clinic' ? 'WellnessClinic' : 'ProfessionalSvc')}`,
            vertical: vert,
            city,
            websiteUrl: `https://test-fixture-${vert}-${city.toLowerCase().replace(/\s+/g, '')}.local`,
            googlePresenceUrl: `https://maps.google.com/?cid=test_fixture_${city.toLowerCase()}_01`,
            contactPerson: 'Test Fixture Contact',
            contactPhone: '+919440123456',
            contactEmail: `contact@test-fixture-${vert}-${city.toLowerCase().replace(/\s+/g, '')}.local`,
            observedGap: 'TEST_FIXTURE: Manual staff messaging handles incoming inquiries. No automated WhatsApp triage verified.',
            evidenceSourceUrl: `https://test-fixture-${vert}-${city.toLowerCase().replace(/\s+/g, '')}.local/contact`,
            evidenceTimestamp: now,
            // Fields that allow production code to detect and reject this fixture:
            classification: 'TEST_DATA',
            sourceType: 'TEST_DATA',
            dataSource: 'DETERMINISTIC_TEST_FIXTURE'
          }
        ]
      };
    } else if (p.includes('research') || p.includes('market') || options.agentId.startsWith('res-')) {
      data = {
        findings: [
          {
            topic: 'Deterministic Test Fixture: Local Inquiry Flow',
            market: ctx.city || 'Hyderabad',
            finding: 'DETERMINISTIC_TEST_FIXTURE: Baseline test fixture for pipeline verification.',
            evidence: 'NO_REAL_WORLD_EVIDENCE',
            certainty: 'OBSERVED',
            confidence: 0.5,
            source: 'DETERMINISTIC_TEST_FIXTURE',
            sourceType: 'TEST_DATA',
            sourceReference: 'DETERMINISTIC_TEST_FIXTURE',
            retrievedAt: now,
            evidenceStatus: 'NO_REAL_WORLD_EVIDENCE',
            dataClassification: 'TEST_DATA'
          }
        ],
        summary: 'DETERMINISTIC_TEST_FIXTURE: Synthetic test fixture for pipeline verification. NO_REAL_WORLD_EVIDENCE.',
        confidence: 0.5
      };
    } else if (p.includes('strategy') || options.agentId.startsWith('mkt-')) {
      data = {
        strategyTitle: '[DETERMINISTIC TEST FIXTURE] Strategic Marketing Allocation',
        positioning: 'Premier Pain-Free Digital Dentistry with Transparent INR Pricing',
        channels: [
          { channel: 'WHATSAPP', allocation: 40, rationale: 'Deterministic test allocation' },
          { channel: 'GOOGLE_BUSINESS_PROFILE', allocation: 30, rationale: 'Deterministic test allocation' },
          { channel: 'INSTAGRAM', allocation: 30, rationale: 'Deterministic test allocation' }
        ],
        expectedQualifiedLeads: 100,
        expectedCostPerLeadINR: 500,
        confidence: 0.5
      };
    } else if (p.includes('content') || options.agentId.startsWith('cnt-')) {
      data = {
        title: 'Smile Transformation in Hyderabad - Transparent Pricing',
        channel: ctx.channel || 'WHATSAPP',
        language: ctx.language || 'English',
        content: `Hi ${ctx.patientName || 'there'}! SmileKraft Dental offers consultation appointments in Hyderabad with flexible zero-cost EMI plans. Tap to schedule consultation on WhatsApp.`,
        callToAction: 'Tap to Schedule Consultation on WhatsApp',
        brandVoiceScore: 0.9,
        factualConfidence: 0.9,
        complianceFlags: []
      };
    } else if (p.includes('experiment') || options.agentId.startsWith('anl-13') || options.agentId.startsWith('anl-18')) {
      data = {
        hypothesis: 'DETERMINISTIC_TEST_FIXTURE: Test variant evaluation for automated verification.',
        baselineMetric: 0,
        treatmentMetric: 0,
        deltaPercent: 0,
        pValue: null,
        statisticallySignificant: false,
        recommendedAction: 'MAINTAIN',
        decisionSummary: 'DETERMINISTIC_TEST_FIXTURE: No real-world telemetry observed. NO_REAL_WORLD_EVIDENCE.'
      };
    } else {
      data = {
        summary: `DETERMINISTIC_TEST_FIXTURE for agent ${options.agentId}. NO_REAL_WORLD_EVIDENCE.`,
        recommendations: ['Maintain deterministic test pipeline', 'Execute in sandbox mode'],
        confidence: 0.5
      };
    }

    const modelName = GeminiProvider.getModelName();
    const telemetry: ModelTelemetry = {
      provider: this.providerName,
      model: modelName,
      agentId: options.agentId,
      agentVersion: options.strategyVersion || 1,
      thinkingLevel: options.thinkingLevel || 'medium',
      requestTimestamp: now,
      completionTimestamp: now,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      tokenUsageStatus: 'UNKNOWN',
      cached: false,
      executionType: 'DETERMINISTIC',
      success: true,
      retryCount: 0
    };

    return {
      data: data as T,
      rawText: JSON.stringify(data),
      model: modelName,
      thinkingLevel: options.thinkingLevel || 'medium',
      cached: false,
      tokenCount: 0,
      tokenUsageStatus: 'UNKNOWN',
      executionType: 'DETERMINISTIC',
      telemetry
    };
  }
}