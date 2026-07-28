#!/usr/bin/env ts-node
/**
 * Diagnostic Tool: Slack Event Extraction
 *
 * Traces the exact path of Slack events through the ingress pipeline.
 * Helps diagnose why event fields (text, user, channel) are empty/unknown.
 */

import { buildSlackEnvelope } from '../src/services/ingress/slack/envelope-builder';

console.log('=== Slack Event Diagnostic ===\n');

// Test Case 1: Empty/undefined event (matches the issue)
console.log('Test 1: Empty event (current issue)');
const emptyEvent = {
  type: undefined,
  user: undefined,
  channel: undefined,
  text: undefined,
  ts: undefined,
  thread_ts: undefined,
  team: undefined,
  event_ts: undefined,
};

const emptyEnvelope = buildSlackEnvelope(emptyEvent as any);
console.log('Result:');
console.log(JSON.stringify({
  messageText: emptyEnvelope.message?.text,
  userId: emptyEnvelope.identity?.external?.id,
  channelId: emptyEnvelope.ingress?.channel,
  rawPayload: emptyEnvelope.message?.rawPlatformPayload,
}, null, 2));
console.log('\n---\n');

// Test Case 2: Proper Slack message event
console.log('Test 2: Proper Slack message event');
const properEvent = {
  type: 'message',
  user: 'U123456789',
  channel: 'C987654321',
  text: 'Hello from Slack!',
  ts: '1234567890.123456',
  thread_ts: undefined,
  team: 'T11111111',
  event_ts: '1234567890.123456',
};

const properEnvelope = buildSlackEnvelope(properEvent);
console.log('Result:');
console.log(JSON.stringify({
  messageText: properEnvelope.message?.text,
  userId: properEnvelope.identity?.external?.id,
  channelId: properEnvelope.ingress?.channel,
  rawPayload: properEnvelope.message?.rawPlatformPayload,
}, null, 2));
console.log('\n---\n');

// Test Case 3: Socket Mode wrapped event (how Slack SDK delivers events)
console.log('Test 3: Socket Mode wrapped event');
const socketModeEvent = {
  envelope_id: 'abc-123',
  type: 'events_api',
  accepts_response_payload: false,
  payload: {
    token: 'verification-token',
    team_id: 'T11111111',
    api_app_id: 'A123456',
    event: {
      type: 'message',
      user: 'U123456789',
      channel: 'C987654321',
      text: 'Hello from Socket Mode!',
      ts: '1234567890.123456',
      event_ts: '1234567890.123456',
    },
    type: 'event_callback',
    event_id: 'Ev123',
    event_time: 1234567890,
  },
};

// This is how slack-ingress-client.ts:224 extracts the actual event
const actualEvent = socketModeEvent?.payload?.event || socketModeEvent;
console.log('Extracted event:');
console.log(JSON.stringify({
  type: actualEvent.type,
  user: actualEvent.user,
  channel: actualEvent.channel,
  text: actualEvent.text,
}, null, 2));

const socketEnvelope = buildSlackEnvelope(actualEvent);
console.log('Envelope result:');
console.log(JSON.stringify({
  messageText: socketEnvelope.message?.text,
  userId: socketEnvelope.identity?.external?.id,
  channelId: socketEnvelope.ingress?.channel,
  rawPayload: socketEnvelope.message?.rawPlatformPayload,
}, null, 2));
console.log('\n---\n');

// Test Case 4: Malformed Socket Mode event (missing nested event)
console.log('Test 4: Malformed Socket Mode event (missing payload.event)');
const malformedSocketEvent = {
  envelope_id: 'abc-123',
  type: 'events_api',
  payload: {
    token: 'verification-token',
    team_id: 'T11111111',
    type: 'event_callback',
    // Missing event field!
  },
};

const extractedMalformed = (malformedSocketEvent?.payload as any)?.event || malformedSocketEvent;
console.log('Extracted event:', extractedMalformed);

const malformedEnvelope = buildSlackEnvelope(extractedMalformed as any);
console.log('Envelope result (should match issue):');
console.log(JSON.stringify({
  messageText: malformedEnvelope.message?.text,
  userId: malformedEnvelope.identity?.external?.id,
  channelId: malformedEnvelope.ingress?.channel,
  rawPayload: malformedEnvelope.message?.rawPlatformPayload,
}, null, 2));

console.log('\n=== Diagnosis ===');
console.log('If your event matches Test 1 or Test 4, the Socket Mode event is malformed.');
console.log('Check Slack App configuration:');
console.log('  - Is Socket Mode enabled?');
console.log('  - Are Event Subscriptions configured?');
console.log('  - Is the app subscribed to message.channels, message.im, or app_mention events?');
console.log('  - Are the SLACK_APP_TOKEN and SLACK_BOT_TOKEN correct?');
