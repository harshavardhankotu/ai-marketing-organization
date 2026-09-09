import { describe, it, expect } from 'vitest';
import { AGENT_REGISTRY, getAgentById, getAgentsByCategory } from '@ai-marketing/shared';

describe('80-Agent Registry & Specification Conformity', () => {
  it('contains exactly 80 specialized agents', () => {
    expect(AGENT_REGISTRY).toHaveLength(80);
  });

  it('contains exactly 20 agents in each of the 4 core divisions', () => {
    const research = getAgentsByCategory('RESEARCH_INTELLIGENCE');
    const content = getAgentsByCategory('CONTENT');
    const marketing = getAgentsByCategory('MARKETING_GROWTH');
    const analytics = getAgentsByCategory('ANALYTICS_LEARNING');

    expect(research).toHaveLength(20);
    expect(content).toHaveLength(20);
    expect(marketing).toHaveLength(20);
    expect(analytics).toHaveLength(20);
  });

  it('every agent conforms to the strict canonical contract', () => {
    for (const agent of AGENT_REGISTRY) {
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBeTruthy();
      expect(agent.role).toBeTruthy();
      expect(agent.systemInstruction).toBeTruthy();
      expect(agent.systemInstruction.length).toBeGreaterThan(20);
      expect(agent.capabilities.length).toBeGreaterThan(0);
      expect(agent.allowedTools.length).toBeGreaterThan(0);
      expect(agent.confidenceThreshold).toBeGreaterThan(0.5);
      expect(agent.executionLimits.maxRetries).toBeGreaterThanOrEqual(1);
      expect(agent.status).toBe('IDLE');
      expect(agent.version).toBeTruthy();
    }
  });

  it('can look up agents by id correctly', () => {
    const ceo = getAgentById('mkt-01');
    expect(ceo).toBeDefined();
    expect(ceo?.name).toBe('Marketing Strategist');

    const res20 = getAgentById('res-20');
    expect(res20).toBeDefined();
    expect(res20?.name).toBe('Research Synthesis Agent');
  });
});