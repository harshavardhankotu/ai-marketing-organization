import { TaskPriority, ExecutionType } from '@ai-marketing/shared';

export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high';
export type TokenUsageStatus = 'VERIFIED' | 'ESTIMATED' | 'UNKNOWN';

export interface ModelTelemetry {
  provider: string;
  model: string;
  agentId: string;
  agentVersion: number;
  thinkingLevel: ThinkingLevel;
  requestTimestamp: string;
  completionTimestamp: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenUsageStatus: TokenUsageStatus;
  cached: boolean;
  executionType: ExecutionType;
  success: boolean;
  error?: string;
  retryCount: number;
}

export interface ModelRequestOptions {
  agentId: string;
  systemInstruction: string;
  prompt: string;
  context?: Record<string, any>;
  thinkingLevel?: ThinkingLevel;
  priority?: TaskPriority;
  strategyVersion?: number;
  skipCache?: boolean;
}

export interface ModelResponse<T = any> {
  data: T;
  rawText: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  cached: boolean;
  tokenCount: number;
  tokenUsageStatus: TokenUsageStatus;
  executionType: ExecutionType;
  telemetry: ModelTelemetry;
}

export interface ModelProvider {
  readonly providerName: string;
  readonly modelName: string;
  generateStructured<T>(options: ModelRequestOptions): Promise<ModelResponse<T>>;
}

export const MODEL_PROVIDER_NAME = 'ModelProvider';
