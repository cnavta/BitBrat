import {
  CONFIG_BACKUP_REGISTRY,
  FORBIDDEN_PREFIXES,
  assertRegistrySafe,
  isForbiddenPath,
  BackupCollectionSpec,
} from '../registry';
import { ConfigurationError } from '../../orchestration/errors';

describe('backup registry exclusion guard (highest-priority test)', () => {
  const LOG_COLLECTIONS = [
    'events',
    'snapshots',
    'mutation_log',
    'state',
    'summarization_runs',
    'tool_usage',
    'prompt_logs',
  ];

  it('the default registry never contains log/event collections at any level', () => {
    for (const spec of CONFIG_BACKUP_REGISTRY) {
      expect(isForbiddenPath(spec.path)).toBe(false);
    }
    // The default registry itself must pass the guard.
    expect(() => assertRegistrySafe()).not.toThrow();
  });

  it('includes the personalities config collection in the export set', () => {
    // Regression: bot personality definitions must be part of the backup allowlist; they were
    // previously omitted so `brat backup export` silently dropped the `personalities` collection.
    const registryPaths = CONFIG_BACKUP_REGISTRY.map((s) => s.path);
    expect(registryPaths).toContain('personalities');
  });

  it('asserts events and other log collections are excluded from the export set', () => {
    const registryPaths = CONFIG_BACKUP_REGISTRY.map((s) => s.path);
    for (const forbidden of FORBIDDEN_PREFIXES) {
      expect(registryPaths).not.toContain(forbidden);
    }
    // events + snapshots subcollection are never representable as a top-level config collection.
    expect(registryPaths).not.toContain('events');
    expect(registryPaths).not.toContain('events/x/snapshots');
  });

  it.each(LOG_COLLECTIONS.filter((c) => c !== 'snapshots'))(
    'flags a top-level forbidden collection: %s',
    (collectionId) => {
      expect(isForbiddenPath(collectionId)).toBe(true);
    },
  );

  it('flags a forbidden collection nested under a config parent', () => {
    // e.g. a hand-crafted attempt to smuggle prompt_logs under services/{svc}
    expect(isForbiddenPath('services/llm-bot/prompt_logs')).toBe(true);
    expect(isForbiddenPath('events/abc/snapshots')).toBe(true);
  });

  it('throws ConfigurationError at startup if a registry entry matches FORBIDDEN_PREFIXES', () => {
    const tainted: BackupCollectionSpec[] = [
      ...CONFIG_BACKUP_REGISTRY,
      { path: 'events', rationale: 'should never be allowed' },
    ];
    expect(() => assertRegistrySafe(tainted)).toThrow(ConfigurationError);
  });

  it('throws when a forbidden collection is nested in a registry path', () => {
    const tainted: BackupCollectionSpec[] = [
      { path: 'configs/foo/mutation_log', rationale: 'nested forbidden' },
    ];
    expect(() => assertRegistrySafe(tainted)).toThrow(ConfigurationError);
  });
});
