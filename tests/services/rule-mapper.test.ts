import { RuleMapper, SERVICE_TOPIC_MAP } from '../../src/services/router/rule-mapper';

describe('RuleMapper', () => {
  it('should map service names to topics correctly', () => {
    const params = {
      logic: '{"==": [{"var": "foo"}, "bar"]}',
      services: ['llm-bot', 'auth', 'unknown-svc'],
    };
    const rule = RuleMapper.mapToRuleDoc(params);

    expect(rule.routingSlip).toHaveLength(3);
    expect(rule.routingSlip?.[0]).toEqual({ id: 'llmbot', nextTopic: 'internal.llmbot.v1' });
    expect(rule.routingSlip?.[1]).toEqual({ id: 'auth', nextTopic: 'internal.auth.v1' });
    expect(rule.routingSlip?.[2]).toEqual({ id: 'unknownsvc', nextTopic: 'internal.unknownsvc.v1' });
  });

  it('should throw if logic is invalid JSON', () => {
    const params = {
      logic: '{invalid-json}',
      services: ['llm-bot'],
    };
    expect(() => RuleMapper.mapToRuleDoc(params)).toThrow(/Invalid logic/);
  });

  it('should construct enrichments correctly', () => {
    const params = {
      logic: 'true',
      services: ['llm-bot'],
      promptTemplate: 'System prompt here',
      responseTemplate: 'Assistant response here',
      personalityId: 'test-personality',
      customAnnotation: { key: 'foo', value: 'bar' },
    };
    const rule = RuleMapper.mapToRuleDoc(params);

    expect(rule.enrichments?.annotations).toHaveLength(3);
    expect(rule.enrichments?.candidates).toHaveLength(1);

    const promptAnn = rule.enrichments?.annotations?.find(a => a.kind === 'prompt');
    expect(promptAnn?.value).toBe('System prompt here');

    const personalityAnn = rule.enrichments?.annotations?.find(a => a.kind === 'personality');
    expect(personalityAnn?.value).toBe('test-personality');

    const customAnn = rule.enrichments?.annotations?.find(a => a.kind === 'custom');
    expect(customAnn?.label).toBe('foo');
    expect(customAnn?.value).toBe('bar');

    const textCand = rule.enrichments?.candidates?.[0];
    expect(textCand?.kind).toBe('text');
    expect(textCand?.text).toBe('Assistant response here');
  });
});
