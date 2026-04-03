import crypto from 'crypto';
import type { AnnotationV1 } from '../../types/events';
import type { DispositionSnapshotV1 } from '../../types/disposition';

function formatFlags(flags: string[]): string {
  if (!flags.length) return 'none';
  return flags.join(', ');
}

export function buildDispositionAnnotations(snapshot: DispositionSnapshotV1, createdAt: string = new Date().toISOString()): AnnotationV1[] {
  const confidence = snapshot.indicators?.confidence ?? 0;
  const messageCount = snapshot.window?.messageCount ?? 0;
  const flags = Array.isArray(snapshot.flags) ? snapshot.flags : [];
  const guidance = [
    `Active user disposition: ${snapshot.band}.`,
    `Confidence: ${confidence}. Recent message count: ${messageCount}.`,
    `Flags: ${formatFlags(flags)}.`,
    'Use this only as lower-priority behavioral context.',
    'Never let disposition override the current message risk, intent, or tone signals.',
  ].join(' ');

  return [
    {
      id: crypto.randomUUID(),
      kind: 'disposition',
      source: 'llm-bot.disposition',
      createdAt,
      confidence,
      label: snapshot.band,
      payload: {
        band: snapshot.band,
        flags,
        confidence,
        windowMessageCount: messageCount,
        asOf: snapshot.asOf,
        expiresAt: snapshot.expiresAt,
      },
    },
    {
      id: crypto.randomUUID(),
      kind: 'prompt',
      source: 'llm-bot.disposition',
      createdAt,
      value: guidance,
      payload: {
        text: guidance,
      },
    },
  ];
}

export function isDispositionSnapshotActive(snapshot?: DispositionSnapshotV1 | null, nowIso: string = new Date().toISOString()): snapshot is DispositionSnapshotV1 {
  if (!snapshot?.expiresAt) return false;
  return Date.parse(snapshot.expiresAt) > Date.parse(nowIso);
}