import { QuotaManager } from './quota-manager.js';
import { DeduplicationEngine } from './deduplication.js';
import { TaskPriority, ExecutionType } from '@ai-marketing/shared';
import { isPlaceholderCredential, isProduction, ProductionSecretViolationError } from '../config/env.js';
import { UniversalLockManager } from '../quota/universal-lock-manager.js';
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
      if (apiKey && !isPlaceholderCredential(apiKey)) {
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
    // 1. Universal Free-Tier Lock Verification (1,500 daily calls hard cap)
    UniversalLockManager.getInstance().checkCanExecute('GEMINI_API');

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
      if (response.status === 429 || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('quotaExceeded')) {
        UniversalLockManager.getInstance().engageLock('GEMINI_API', `Gemini API quota exhausted (${response.status}). Universal Lock engaged.`);
      }
      const err = new Error(`LLM EXECUTION = FAILED: Gemini API error ${response.status}: ${errText}`);
      (err as any).status = response.status;
      throw err;
    }

    // Record successful outbound request against free-tier universal lock
    UniversalLockManager.getInstance().recordOutboundCall('GEMINI_API', 1);

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

  private synthesizeDomainResponse<T>(options: ModelRequestOptions): ModelResponse<T> {
    const p = options.prompt.toLowerCase();
    const ctx = options.context || {};
    const now = new Date().toISOString();
    let data: any = {};

    // Strictly honest deterministic test fixtures:
    // NO fake search volume claims, NO fake surveys, NO fake p-values, NO fake external observations.
    if (p.includes('research') || p.includes('market') || options.agentId.startsWith('res-')) {
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