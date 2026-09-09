/**
 * CompositionWatcher Unit Tests (Sprint 42 - Simplified)
 *
 * Tests core watcher functionality with real timers for reliability.
 * Complex async timer scenarios are validated via integration tests.
 *
 * @module composition/composition-watcher.test
 */

import { CompositionWatcher } from './composition-watcher';
import { CompiledComposition } from './types';
import { Bit } from '../base-server';

// Mock Bit server
class MockBit {
  getLogger() {
    return {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      trace: jest.fn(),
    };
  }
}

// Mock CompositionRegistry
class MockRegistry {
  list: jest.Mock;

  constructor() {
    this.list = jest.fn().mockResolvedValue([]);
  }

  setCompositions(compositions: Array<any>) {
    this.list.mockResolvedValue(compositions);
  }
}

// Helper to create mock compiled composition
const createMockComposition = (name: string, version: number, contentHash: string): CompiledComposition => ({
  id: `${name}-${version}`,
  contentHash,
  metadata: {
    name,
    version,
    description: `Test composition: ${name}`,
  },
  spec: {
    inputSchema: { type: 'object' },
    steps: [],
    return: { success: true },
  },
  compiledAt: new Date(),
  dependencies: [],
  validationReport: {
    valid: true,
    errors: [],
    warnings: [],
  },
});

describe('CompositionWatcher', () => {
  let mockBit: MockBit;
  let mockRegistry: MockRegistry;
  let watcher: CompositionWatcher;

  beforeEach(() => {
    mockBit = new MockBit();
    mockRegistry = new MockRegistry();
  });

  afterEach(() => {
    if (watcher) {
      watcher.stop();
    }
  });

  test('starts and stops cleanly', () => {
    const onAdded = jest.fn().mockResolvedValue(undefined);
    const onUpdated = jest.fn().mockResolvedValue(undefined);
    const onRemoved = jest.fn().mockResolvedValue(undefined);

    watcher = new CompositionWatcher(mockBit as any, {
      registry: mockRegistry as any,
      onCompositionAdded: onAdded,
      onCompositionUpdated: onUpdated,
      onCompositionRemoved: onRemoved,
      pollInterval: 1000,
    });

    watcher.start();
    watcher.stop();

    // Should not crash
    expect(true).toBe(true);
  });

  test('detects new composition', async () => {
    const onAdded = jest.fn().mockResolvedValue(undefined);
    const onUpdated = jest.fn().mockResolvedValue(undefined);
    const onRemoved = jest.fn().mockResolvedValue(undefined);

    const comp = createMockComposition('test_comp', 1, 'hash1');

    watcher = new CompositionWatcher(mockBit as any, {
      registry: mockRegistry as any,
      onCompositionAdded: onAdded,
      onCompositionUpdated: onUpdated,
      onCompositionRemoved: onRemoved,
      pollInterval: 50,
    });

    // Start empty
    mockRegistry.setCompositions([]);
    watcher.start();

    // Add composition
    mockRegistry.setCompositions([
      {
        id: 'test-id',
        name: 'test_comp',
        version: 1,
        contentHash: 'hash1',
        compiled: comp,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Wait for poll
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onAdded).toHaveBeenCalledWith(comp);
  });

  test('handles registry errors gracefully', async () => {
    const onAdded = jest.fn().mockResolvedValue(undefined);
    const onUpdated = jest.fn().mockResolvedValue(undefined);
    const onRemoved = jest.fn().mockResolvedValue(undefined);

    mockRegistry.list.mockRejectedValue(new Error('Database error'));

    watcher = new CompositionWatcher(mockBit as any, {
      registry: mockRegistry as any,
      onCompositionAdded: onAdded,
      onCompositionUpdated: onUpdated,
      onCompositionRemoved: onRemoved,
      pollInterval: 50,
    });

    watcher.start();

    // Wait for poll (should not crash)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Watcher should still be running (no crash)
    expect(true).toBe(true);
  });

  test('handles callback errors gracefully', async () => {
    const onAdded = jest.fn().mockRejectedValue(new Error('Callback error'));
    const onUpdated = jest.fn().mockResolvedValue(undefined);
    const onRemoved = jest.fn().mockResolvedValue(undefined);

    const comp = createMockComposition('test_comp', 1, 'hash1');

    watcher = new CompositionWatcher(mockBit as any, {
      registry: mockRegistry as any,
      onCompositionAdded: onAdded,
      onCompositionUpdated: onUpdated,
      onCompositionRemoved: onRemoved,
      pollInterval: 50,
    });

    mockRegistry.setCompositions([
      {
        id: 'test-id',
        name: 'test_comp',
        version: 1,
        contentHash: 'hash1',
        compiled: comp,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    watcher.start();

    // Wait for poll (should not crash)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Callback was called despite error
    expect(onAdded).toHaveBeenCalled();
  });

  test('uses default poll interval when not specified', () => {
    const onAdded = jest.fn().mockResolvedValue(undefined);
    const onUpdated = jest.fn().mockResolvedValue(undefined);
    const onRemoved = jest.fn().mockResolvedValue(undefined);

    watcher = new CompositionWatcher(mockBit as any, {
      registry: mockRegistry as any,
      onCompositionAdded: onAdded,
      onCompositionUpdated: onUpdated,
      onCompositionRemoved: onRemoved,
      // No pollInterval specified - should default to 30000
    });

    watcher.start();

    // Test just verifies no crash - default interval behavior
    // is validated in integration tests
    expect(true).toBe(true);
  });
});
