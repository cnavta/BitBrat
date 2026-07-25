/**
 * Fleet Helpers Module Unit Tests
 * Sprint 360: Test suite for business/fleet-helpers.ts
 */

import {
  targetBit,
  requireBit,
  emit,
  renderFailure,
  forbiddenHint,
  readOrAll,
  mutate,
  FleetCommandArgs,
} from './fleet-helpers';
import { ConfigurationError } from '../orchestration/errors';
import type { FleetClient } from '../fleet';
import type { Logger } from '../orchestration/logger';
import type { FleetCallStatus } from '../fleet/types';

// Mock classifyFleetError
jest.mock('../fleet', () => ({
  classifyFleetError: jest.fn((msg: string) => {
    if (msg.includes('Forbidden') || msg.includes('403')) return 'forbidden';
    if (msg.includes('ECONNREFUSED') || msg.includes('unreachable')) return 'unreachable';
    return 'error';
  }),
}));

describe('Fleet Helpers Business Logic', () => {
  describe('targetBit', () => {
    it('should return direct Bit when --direct flag present', () => {
      const args: FleetCommandArgs = {
        direct: 'direct-bit',
        bit: 'regular-bit',
        positionals: ['other-bit'],
      };

      expect(targetBit(args)).toBe('direct-bit');
    });

    it('should return explicit bit when set', () => {
      const args: FleetCommandArgs = {
        bit: 'explicit-bit',
        positionals: ['other-bit'],
      };

      expect(targetBit(args)).toBe('explicit-bit');
    });

    it('should return first positional that is not a verb', () => {
      const args: FleetCommandArgs = {
        positionals: ['get', 'my-bit', 'set'],
      };

      expect(targetBit(args)).toBe('my-bit');
    });

    it('should return undefined if no Bit found', () => {
      const args: FleetCommandArgs = {
        positionals: ['get', 'set'],
      };

      expect(targetBit(args)).toBeUndefined();
    });

    it('should return undefined if no positionals', () => {
      const args: FleetCommandArgs = {};

      expect(targetBit(args)).toBeUndefined();
    });

    it('should prioritize direct over bit over positionals', () => {
      const args: FleetCommandArgs = {
        direct: 'direct-bit',
        bit: 'explicit-bit',
        positionals: ['positional-bit'],
      };

      expect(targetBit(args)).toBe('direct-bit');
    });
  });

  describe('requireBit', () => {
    it('should return Bit name when present', () => {
      const args: FleetCommandArgs = {
        bit: 'my-bit',
      };

      expect(requireBit(args)).toBe('my-bit');
    });

    it('should throw ConfigurationError when no Bit specified', () => {
      const args: FleetCommandArgs = {};

      expect(() => requireBit(args)).toThrow(ConfigurationError);
      expect(() => requireBit(args)).toThrow('This command requires a <bit>');
    });

    it('should extract Bit from direct flag', () => {
      const args: FleetCommandArgs = {
        direct: 'direct-bit',
      };

      expect(requireBit(args)).toBe('direct-bit');
    });

    it('should extract Bit from positionals', () => {
      const args: FleetCommandArgs = {
        positionals: ['get', 'my-bit'],
      };

      expect(requireBit(args)).toBe('my-bit');
    });
  });

  describe('emit', () => {
    let mockOut: jest.Mock;

    beforeEach(() => {
      mockOut = jest.fn();
    });

    it('should output JSON when json=true', () => {
      const payload = { foo: 'bar', num: 42 };

      emit(mockOut, true, 'label', payload);

      expect(mockOut).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
    });

    it('should output labeled format when json=false and payload is object', () => {
      const payload = { foo: 'bar' };

      emit(mockOut, false, 'my-label', payload);

      expect(mockOut).toHaveBeenCalledWith(`my-label: ${JSON.stringify(payload)}`);
    });

    it('should output labeled format when json=false and payload is string', () => {
      const payload = 'success';

      emit(mockOut, false, 'my-label', payload);

      expect(mockOut).toHaveBeenCalledWith('my-label: success');
    });

    it('should handle nested objects in JSON mode', () => {
      const payload = { nested: { deep: { value: 123 } } };

      emit(mockOut, true, 'label', payload);

      expect(mockOut).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
    });
  });

  describe('renderFailure', () => {
    it('should render forbidden failure', () => {
      const result = { status: 'forbidden', error: 'Forbidden' };

      expect(renderFailure(result)).toBe('forbidden (Forbidden)');
    });

    it('should render error failure', () => {
      const result = { status: 'error', error: 'Internal error' };

      expect(renderFailure(result)).toBe('error (Internal error)');
    });

    it('should render unreachable failure', () => {
      const result = { status: 'unreachable', error: 'ECONNREFUSED' };

      expect(renderFailure(result)).toBe('unreachable (ECONNREFUSED)');
    });

    it('should default to unreachable for unknown status', () => {
      const result = { status: 'unknown', error: 'Some error' };

      expect(renderFailure(result)).toBe('unreachable (Some error)');
    });

    it('should use "unknown" when no error message', () => {
      const result = { status: 'error' };

      expect(renderFailure(result)).toBe('error (unknown)');
    });
  });

  describe('forbiddenHint', () => {
    let mockOut: jest.Mock;

    beforeEach(() => {
      mockOut = jest.fn();
    });

    it('should show hint when forbidden errors present', () => {
      const results = [
        { ok: true },
        { ok: false, status: 'forbidden' },
        { ok: false, status: 'error' },
      ];

      forbiddenHint(mockOut, results);

      expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
      expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('--roles bit:operate'));
    });

    it('should not show hint when no forbidden errors', () => {
      const results = [
        { ok: true },
        { ok: false, status: 'error' },
        { ok: false, status: 'unreachable' },
      ];

      forbiddenHint(mockOut, results);

      expect(mockOut).not.toHaveBeenCalled();
    });

    it('should not show hint when all operations succeeded', () => {
      const results = [{ ok: true }, { ok: true }, { ok: true }];

      forbiddenHint(mockOut, results);

      expect(mockOut).not.toHaveBeenCalled();
    });
  });

  describe('readOrAll', () => {
    let mockClient: jest.Mocked<FleetClient>;
    let mockOut: jest.Mock;

    beforeEach(() => {
      mockOut = jest.fn();
      mockClient = {
        call: jest.fn(),
        callAll: jest.fn(),
        list: jest.fn(),
        close: jest.fn(),
      } as any;
    });

    describe('Single Bit', () => {
      it('should call single Bit and emit result', async () => {
        const args: FleetCommandArgs = { bit: 'my-bit' };
        mockClient.call.mockResolvedValue({ status: 'healthy' });

        const result = await readOrAll(args, mockClient, 'bit.health', mockOut);

        expect(mockClient.call).toHaveBeenCalledWith('my-bit', 'bit.health');
        expect(result).toEqual({ status: 'healthy' });
        expect(mockOut).toHaveBeenCalledWith('my-bit bit.health: {"status":"healthy"}');
      });

      it('should output JSON when json=true', async () => {
        const args: FleetCommandArgs = { bit: 'my-bit', json: true };
        mockClient.call.mockResolvedValue({ status: 'healthy' });

        await readOrAll(args, mockClient, 'bit.health', mockOut);

        expect(mockOut).toHaveBeenCalledWith(JSON.stringify({ status: 'healthy' }, null, 2));
      });

      it('should throw when no Bit specified', async () => {
        const args: FleetCommandArgs = {};

        await expect(readOrAll(args, mockClient, 'bit.health', mockOut)).rejects.toThrow(
          ConfigurationError
        );
      });
    });

    describe('--all Fan-out', () => {
      it('should call all Bits and format results', async () => {
        const args: FleetCommandArgs = { all: true };
        const results = [
          { bit: 'bit-1', ok: true, result: { status: 'healthy' } },
          { bit: 'bit-2', ok: true, result: { status: 'healthy' } },
        ];
        mockClient.callAll.mockResolvedValue(results);

        const result = await readOrAll(args, mockClient, 'bit.health', mockOut);

        expect(mockClient.callAll).toHaveBeenCalledWith('bit.health');
        expect(result).toEqual(results);
        expect(mockOut).toHaveBeenCalledWith('BIT                 bit.health');
        expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('bit-1'));
        expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('bit-2'));
      });

      it('should show forbidden hint when forbidden errors present', async () => {
        const args: FleetCommandArgs = { all: true };
        const results = [
          { bit: 'bit-1', ok: true, result: { status: 'healthy' } },
          { bit: 'bit-2', ok: false, status: 'forbidden' as FleetCallStatus, error: 'Forbidden' },
        ];
        mockClient.callAll.mockResolvedValue(results);

        await readOrAll(args, mockClient, 'bit.health', mockOut);

        expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
        expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('--roles bit:operate'));
      });

      it('should output JSON when json=true', async () => {
        const args: FleetCommandArgs = { all: true, json: true };
        const results = [
          { bit: 'bit-1', ok: true, result: { status: 'healthy' } },
        ];
        mockClient.callAll.mockResolvedValue(results);

        await readOrAll(args, mockClient, 'bit.health', mockOut);

        expect(mockOut).toHaveBeenCalledWith(JSON.stringify(results, null, 2));
      });

      it('should render failures correctly', async () => {
        const args: FleetCommandArgs = { all: true };
        const results = [
          { bit: 'bit-1', ok: false, status: 'unreachable' as FleetCallStatus, error: 'ECONNREFUSED' },
        ];
        mockClient.callAll.mockResolvedValue(results);

        await readOrAll(args, mockClient, 'bit.health', mockOut);

        expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('unreachable (ECONNREFUSED)'));
      });
    });
  });

  describe('mutate', () => {
    let mockClient: jest.Mocked<FleetClient>;
    let mockOut: jest.Mock;
    let mockLogger: Logger;

    beforeEach(() => {
      mockOut = jest.fn();
      mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as any;
      mockClient = {
        call: jest.fn(),
        callAll: jest.fn(),
        list: jest.fn(),
        close: jest.fn(),
      } as any;
    });

    describe('Single Bit', () => {
      it('should call single Bit and emit result', async () => {
        const args: FleetCommandArgs = { bit: 'my-bit' };
        mockClient.call.mockResolvedValue({ success: true });

        const result = await mutate(args, mockClient, 'bit.drain', mockOut, mockLogger);

        expect(mockClient.call).toHaveBeenCalledWith('my-bit', 'bit.drain');
        expect(result).toEqual({ success: true });
        expect(mockOut).toHaveBeenCalledWith('my-bit bit.drain: {"success":true}');
      });

      it('should output JSON when json=true', async () => {
        const args: FleetCommandArgs = { bit: 'my-bit', json: true };
        mockClient.call.mockResolvedValue({ success: true });

        await mutate(args, mockClient, 'bit.drain', mockOut, mockLogger);

        expect(mockOut).toHaveBeenCalledWith(JSON.stringify({ success: true }, null, 2));
      });
    });

    describe('--all with --confirm', () => {
      it('should require --confirm for --all', async () => {
        const args: FleetCommandArgs = { all: true };

        await expect(mutate(args, mockClient, 'bit.drain', mockOut, mockLogger)).rejects.toThrow(
          ConfigurationError
        );
        await expect(mutate(args, mockClient, 'bit.drain', mockOut, mockLogger)).rejects.toThrow(
          'high blast radius'
        );
      });

      it('should mutate all Bits sequentially with --confirm', async () => {
        const args: FleetCommandArgs = { all: true, confirm: true };
        mockClient.list.mockResolvedValue([
          { name: 'bit-1', profile: 'core', exposure: 'platform-only' },
          { name: 'bit-2', profile: 'core', exposure: 'platform-only' },
        ]);
        mockClient.call.mockResolvedValue({ success: true });

        const result = await mutate(args, mockClient, 'bit.drain', mockOut, mockLogger);

        expect(mockClient.list).toHaveBeenCalled();
        expect(mockClient.call).toHaveBeenCalledWith('bit-1', 'bit.drain');
        expect(mockClient.call).toHaveBeenCalledWith('bit-2', 'bit.drain');
        expect(mockLogger.info).toHaveBeenCalledTimes(2);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ bit: 'bit-1', ok: true });
        expect(result[1]).toMatchObject({ bit: 'bit-2', ok: true });
      });

      it('should collect failures and continue to next Bit', async () => {
        const args: FleetCommandArgs = { all: true, confirm: true };
        mockClient.list.mockResolvedValue([
          { name: 'bit-1', profile: 'core', exposure: 'platform-only' },
          { name: 'bit-2', profile: 'core', exposure: 'platform-only' },
        ]);
        mockClient.call
          .mockRejectedValueOnce(new Error('Forbidden'))
          .mockResolvedValueOnce({ success: true });

        const result = await mutate(args, mockClient, 'bit.drain', mockOut, mockLogger);

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
          bit: 'bit-1',
          ok: false,
          status: 'forbidden',
          error: 'Forbidden',
        });
        expect(result[1]).toMatchObject({ bit: 'bit-2', ok: true });
      });

      it('should show forbidden hint when forbidden errors present', async () => {
        const args: FleetCommandArgs = { all: true, confirm: true };
        mockClient.list.mockResolvedValue([
          { name: 'bit-1', profile: 'core', exposure: 'platform-only' },
        ]);
        mockClient.call.mockRejectedValue(new Error('Forbidden'));

        await mutate(args, mockClient, 'bit.drain', mockOut, mockLogger);

        expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
        expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('--roles bit:operate'));
      });

      it('should output JSON when json=true', async () => {
        const args: FleetCommandArgs = { all: true, confirm: true, json: true };
        mockClient.list.mockResolvedValue([
          { name: 'bit-1', profile: 'core', exposure: 'platform-only' },
        ]);
        mockClient.call.mockResolvedValue({ success: true });

        await mutate(args, mockClient, 'bit.drain', mockOut, mockLogger);

        expect(mockOut).toHaveBeenCalledWith(
          expect.stringContaining('"bit": "bit-1"')
        );
      });

      it('should classify different error types', async () => {
        const args: FleetCommandArgs = { all: true, confirm: true };
        mockClient.list.mockResolvedValue([
          { name: 'bit-1', profile: 'core', exposure: 'platform-only' },
          { name: 'bit-2', profile: 'core', exposure: 'platform-only' },
          { name: 'bit-3', profile: 'core', exposure: 'platform-only' },
        ]);
        mockClient.call
          .mockRejectedValueOnce(new Error('Forbidden'))
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockRejectedValueOnce(new Error('Unknown error'));

        const result = await mutate(args, mockClient, 'bit.drain', mockOut, mockLogger);

        expect(result[0]).toMatchObject({ status: 'forbidden' });
        expect(result[1]).toMatchObject({ status: 'unreachable' });
        expect(result[2]).toMatchObject({ status: 'error' });
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty fleet for --all', async () => {
        const args: FleetCommandArgs = { all: true, confirm: true };
        mockClient.list.mockResolvedValue([]);

        const result = await mutate(args, mockClient, 'bit.drain', mockOut, mockLogger);

        expect(result).toHaveLength(0);
      });

      it('should handle non-Error exceptions', async () => {
        const args: FleetCommandArgs = { all: true, confirm: true };
        mockClient.list.mockResolvedValue([
          { name: 'bit-1', profile: 'core', exposure: 'platform-only' },
        ]);
        mockClient.call.mockRejectedValue('string error');

        const result = await mutate(args, mockClient, 'bit.drain', mockOut, mockLogger);

        expect(result[0]).toMatchObject({
          bit: 'bit-1',
          ok: false,
          error: 'string error',
        });
      });
    });
  });
});
