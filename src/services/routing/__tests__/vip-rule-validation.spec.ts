import { RouterEngine } from '../router-engine';
import type { RuleDoc } from '../../router/rule-loader';
import type { InternalEventV2 } from '../../../types/events';
import * as fs from 'fs';
import * as path from 'path';

describe('VIP Routing Rule Validation', () => {
  const rulePath = path.join(__dirname, '../../../../planning/sprint-165-b4e5f6/vip-routing-rule.json');
  const vipRule: RuleDoc = JSON.parse(fs.readFileSync(rulePath, 'utf8'));

  const engine = new RouterEngine();

  const baseEvent: InternalEventV2 = {
    v: '1',
    source: 'twitch',
    correlationId: 'c123',
    type: 'chat.message',
    channel: '#streamer',
    userId: 'u123',
    user: {
      id: 'u123',
      login: 'vipplayer',
      displayName: 'VIPPlayer',
      roles: ['VIP'],
      tags: ['FIRST_SESSION_MESSAGE']
    },
    message: {
      id: 'm123',
      role: 'user',
      text: 'Hello world!',
      rawPlatformPayload: { text: 'Hello world!' }
    },
    createdAt: new Date().toISOString()
  } as any;

  it('matches a VIP user on their first session message', () => {
    const { decision, evtOut } = engine.route(baseEvent, [vipRule]);
    
    expect(decision.matched).toBe(true);
    expect(decision.ruleId).toBe('vip-first-message-announcement');
    expect(decision.selectedTopic).toBe('internal.llmbot.v1');
    
    // Check annotations
    const personality = evtOut.annotations?.find(a => a.kind === 'personality');
    expect(personality?.value).toBe('bitbrat_the_ai');
    
    const prompt = evtOut.annotations?.find(a => a.kind === 'prompt');
    expect(prompt?.value).toBe('A VIP has arrived! Please announce their presance!');
  });

  it('does NOT match if the user is NOT a VIP', () => {
    const nonVipEvent = {
      ...baseEvent,
      user: { ...baseEvent.user, roles: ['viewer'] }
    } as any;
    
    const { decision } = engine.route(nonVipEvent, [vipRule]);
    expect(decision.matched).toBe(false);
  });

  it('does NOT match if it is NOT the first session message', () => {
    const secondMessageEvent = {
      ...baseEvent,
      user: { ...baseEvent.user, tags: [] }
    } as any;
    
    const { decision } = engine.route(secondMessageEvent, [vipRule]);
    expect(decision.matched).toBe(false);
  });

  it('does NOT match if the event type is NOT chat.message', () => {
    const commandEvent = {
      ...baseEvent,
      type: 'chat.command'
    } as any;
    
    const { decision } = engine.route(commandEvent, [vipRule]);
    expect(decision.matched).toBe(false);
  });
});
