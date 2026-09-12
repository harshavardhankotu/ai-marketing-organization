import { TaskPriority, ExecutionType } from '@ai-marketing/shared';

export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high';

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
  executionType: ExecutionType;
}

export interface ModelProvider {
  readonly modelName: string;
  generateStructured<T>(options: ModelRequestOptions): Promise<ModelResponse<T>>;
}

export const MODEL_PROVIDER_NAME = 'ModelProvider';
