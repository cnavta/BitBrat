/**
 * Fleet Dispatcher Module Unit Tests
 * Sprint 360: Test suite for business/fleet-dispatcher.ts
 */

import { dispatchFleetCommand, FleetDispatchOptions } from './fleet-dispatcher';
import { ConfigurationError } from '../orchestration/errors';
import type { FleetClient } from '../fleet';
import type { Logger } from '../orchestration/logger';
import type { FleetCallStatus } from '../fleet/types';

// Mock dependencies
jest.mock('./fleet-helpers', () => ({
  ...jest.requireActual('./fleet-helpers'),
  requireBit: jest.fn(() => 'test-bit'),
}));

describe('Fleet Dispatcher Business Logic', () => {
  let mockClient: jest.Mocked<FleetClient>;
  let mockOut: jest.Mock;
  let mockLogger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();

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

  describe('dispatchFleetCommand', () => {
    it('should throw for unknown subcommand', async () => {
      const options: FleetDispatchOptions = {
        subcommand: 'unknown',
      };

      await expect(
        dispatchFleetCommand(options, mockClient, mockOut, mockLogger)
      ).rejects.toThrow(ConfigurationError);
      await expect(
        dispatchFleetCommand(options, mockClient, mockOut, mockLogger)
      ).rejects.toThrow('Unknown fleet subcommand: unknown');
    });
  });

  describe('list command', () => {
    beforeEach(() => {
      mockClient.list.mockResolvedValue([
        { name: 'llm-bot', profile: 'llm', exposure: 'platform-only' },
        { name: 'tool-gateway', profile: 'gateway', exposure: 'platform+domain' },
        { name: 'auth', profile: 'core', exposure: 'platform-only' },
      ]);
    });

    it('should list all Bits with tabular output', async () => {
      const options: FleetDispatchOptions = {
        subcommand: 'list',
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.list).toHaveBeenCalled();
      expect(result).toHaveLength(3);
      expect(mockOut).toHaveBeenCalledWith('BIT                 PROFILE      EXPOSURE');
      expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('llm-bot'));
      expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('tool-gateway'));
      expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('auth'));
    });

    it('should output JSON when json=true', async () => {
      const options: FleetDispatchOptions = {
        subcommand: 'list',
        json: true,
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockOut).toHaveBeenCalledWith(
        expect.stringContaining('"name": "llm-bot"')
      );
      expect(result).toHaveLength(3);
    });

    it('should handle empty fleet', async () => {
      mockClient.list.mockResolvedValue([]);

      const options: FleetDispatchOptions = {
        subcommand: 'list',
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(result).toHaveLength(0);
      expect(mockOut).toHaveBeenCalledWith('BIT                 PROFILE      EXPOSURE');
    });

    it('should handle missing profile/exposure', async () => {
      mockClient.list.mockResolvedValue([
        { name: 'minimal-bit' } as any,
      ]);

      const options: FleetDispatchOptions = {
        subcommand: 'list',
      };

      await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('minimal-bit'));
      expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('-'));
    });
  });

  describe('info command', () => {
    it('should call bit.info on single Bit', async () => {
      mockClient.call.mockResolvedValue({ version: '1.0.0', uptime: 3600 });

      const options: FleetDispatchOptions = {
        subcommand: 'info',
        bit: 'llm-bot',
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.call).toHaveBeenCalledWith('llm-bot', 'bit.info');
      expect(result).toEqual({ version: '1.0.0', uptime: 3600 });
    });

    it('should fan out to all Bits with --all', async () => {
      mockClient.callAll.mockResolvedValue([
        { bit: 'bit-1', ok: true, result: { version: '1.0.0' } },
        { bit: 'bit-2', ok: true, result: { version: '1.0.1' } },
      ]);

      const options: FleetDispatchOptions = {
        subcommand: 'info',
        all: true,
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.callAll).toHaveBeenCalledWith('bit.info');
      expect(result).toHaveLength(2);
    });
  });

  describe('health command', () => {
    it('should call bit.health on single Bit', async () => {
      mockClient.call.mockResolvedValue({ status: 'healthy' });

      const options: FleetDispatchOptions = {
        subcommand: 'health',
        bit: 'llm-bot',
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.call).toHaveBeenCalledWith('llm-bot', 'bit.health');
      expect(result).toEqual({ status: 'healthy' });
    });

    it('should fan out to all Bits with --all', async () => {
      mockClient.callAll.mockResolvedValue([
        { bit: 'bit-1', ok: true, result: { status: 'healthy' } },
        { bit: 'bit-2', ok: false, status: 'unreachable' as FleetCallStatus, error: 'ECONNREFUSED' },
      ]);

      const options: FleetDispatchOptions = {
        subcommand: 'health',
        all: true,
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.callAll).toHaveBeenCalledWith('bit.health');
      expect(result).toHaveLength(2);
    });
  });

  describe('config command', () => {
    it('should call bit.config.get by default', async () => {
      mockClient.call.mockResolvedValue({ PORT: '3000', NODE_ENV: 'production' });

      const options: FleetDispatchOptions = {
        subcommand: 'config',
        bit: 'llm-bot',
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.call).toHaveBeenCalledWith('test-bit', 'bit.config.get');
      expect(result).toEqual({ PORT: '3000', NODE_ENV: 'production' });
      expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('bit.config.get'));
    });

    it('should call bit.config.describe with --describe flag', async () => {
      mockClient.call.mockResolvedValue({
        PORT: { value: '3000', description: 'HTTP port' },
      });

      const options: FleetDispatchOptions = {
        subcommand: 'config',
        bit: 'llm-bot',
        describe: true,
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.call).toHaveBeenCalledWith('test-bit', 'bit.config.describe');
      expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('bit.config.describe'));
    });

    it('should output JSON when json=true', async () => {
      mockClient.call.mockResolvedValue({ PORT: '3000' });

      const options: FleetDispatchOptions = {
        subcommand: 'config',
        bit: 'llm-bot',
        json: true,
      };

      await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockOut).toHaveBeenCalledWith(
        expect.stringContaining('"PORT": "3000"')
      );
    });
  });

  describe('flags command', () => {
    describe('get flags', () => {
      it('should get all flags without --key', async () => {
        mockClient.call.mockResolvedValue({
          'feature.new-ui': true,
          'debug.verbose': false,
        });

        const options: FleetDispatchOptions = {
          subcommand: 'flags',
          bit: 'llm-bot',
        };

        const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

        expect(mockClient.call).toHaveBeenCalledWith('test-bit', 'bit.flags.get', {});
        expect(result).toEqual({
          'feature.new-ui': true,
          'debug.verbose': false,
        });
      });

      it('should get single flag with --key', async () => {
        mockClient.call.mockResolvedValue({ value: true });

        const options: FleetDispatchOptions = {
          subcommand: 'flags',
          bit: 'llm-bot',
          key: 'feature.new-ui',
        };

        const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

        expect(mockClient.call).toHaveBeenCalledWith('test-bit', 'bit.flags.get', {
          key: 'feature.new-ui',
        });
        expect(result).toEqual({ value: true });
      });
    });

    describe('set flags', () => {
      it('should set flag with set verb and --key', async () => {
        mockClient.call.mockResolvedValue({ success: true });

        const options: FleetDispatchOptions = {
          subcommand: 'flags',
          bit: 'llm-bot',
          positionals: ['set'],
          key: 'feature.new-ui',
          value: 'true',
        };

        const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

        expect(mockClient.call).toHaveBeenCalledWith('test-bit', 'bit.flags.set', {
          key: 'feature.new-ui',
          value: 'true',
        });
        expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('bit.flags.set'));
      });

      it('should set flag without --value (toggle)', async () => {
        mockClient.call.mockResolvedValue({ success: true });

        const options: FleetDispatchOptions = {
          subcommand: 'flags',
          bit: 'llm-bot',
          positionals: ['set'],
          key: 'feature.new-ui',
          // No value - toggle
        };

        const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

        expect(mockClient.call).toHaveBeenCalledWith('test-bit', 'bit.flags.set', {
          key: 'feature.new-ui',
          value: undefined,
        });
      });

      it('should throw error when set without --key', async () => {
        const options: FleetDispatchOptions = {
          subcommand: 'flags',
          bit: 'llm-bot',
          positionals: ['set'],
          // Missing key
        };

        await expect(
          dispatchFleetCommand(options, mockClient, mockOut, mockLogger)
        ).rejects.toThrow(ConfigurationError);
        await expect(
          dispatchFleetCommand(options, mockClient, mockOut, mockLogger)
        ).rejects.toThrow('flags set requires --key');
      });
    });
  });

  describe('log command', () => {
    it('should set log level', async () => {
      mockClient.call.mockResolvedValue({ level: 'debug' });

      const options: FleetDispatchOptions = {
        subcommand: 'log',
        bit: 'llm-bot',
        level: 'debug',
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.call).toHaveBeenCalledWith('test-bit', 'bit.log.level', {
        level: 'debug',
      });
      expect(result).toEqual({ level: 'debug' });
      expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('bit.log.level'));
    });

    it('should throw error when --level not provided', async () => {
      const options: FleetDispatchOptions = {
        subcommand: 'log',
        bit: 'llm-bot',
        // Missing level
      };

      await expect(
        dispatchFleetCommand(options, mockClient, mockOut, mockLogger)
      ).rejects.toThrow(ConfigurationError);
      await expect(
        dispatchFleetCommand(options, mockClient, mockOut, mockLogger)
      ).rejects.toThrow('log requires --level');
    });

    it('should accept valid log levels', async () => {
      mockClient.call.mockResolvedValue({ success: true });

      for (const level of ['error', 'warn', 'info', 'debug']) {
        const options: FleetDispatchOptions = {
          subcommand: 'log',
          bit: 'llm-bot',
          level,
        };

        await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

        expect(mockClient.call).toHaveBeenCalledWith('test-bit', 'bit.log.level', { level });
      }
    });
  });

  describe('drain command', () => {
    it('should drain single Bit', async () => {
      mockClient.call.mockResolvedValue({ drained: true });

      const options: FleetDispatchOptions = {
        subcommand: 'drain',
        bit: 'llm-bot',
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.call).toHaveBeenCalledWith('llm-bot', 'bit.drain');
      expect(result).toEqual({ drained: true });
    });

    it('should require --confirm for --all', async () => {
      const options: FleetDispatchOptions = {
        subcommand: 'drain',
        all: true,
        // Missing confirm
      };

      await expect(
        dispatchFleetCommand(options, mockClient, mockOut, mockLogger)
      ).rejects.toThrow(ConfigurationError);
      await expect(
        dispatchFleetCommand(options, mockClient, mockOut, mockLogger)
      ).rejects.toThrow('high blast radius');
    });

    it('should drain all Bits with --all --confirm', async () => {
      mockClient.list.mockResolvedValue([
        { name: 'bit-1', profile: 'core', exposure: 'platform-only' },
        { name: 'bit-2', profile: 'core', exposure: 'platform-only' },
      ]);
      mockClient.call.mockResolvedValue({ drained: true });

      const options: FleetDispatchOptions = {
        subcommand: 'drain',
        all: true,
        confirm: true,
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.list).toHaveBeenCalled();
      expect(mockClient.call).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });
  });

  describe('shutdown command', () => {
    it('should shutdown single Bit', async () => {
      mockClient.call.mockResolvedValue({ shutdown: true });

      const options: FleetDispatchOptions = {
        subcommand: 'shutdown',
        bit: 'llm-bot',
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.call).toHaveBeenCalledWith('llm-bot', 'bit.shutdown');
      expect(result).toEqual({ shutdown: true });
    });

    it('should require --confirm for --all', async () => {
      const options: FleetDispatchOptions = {
        subcommand: 'shutdown',
        all: true,
        // Missing confirm
      };

      await expect(
        dispatchFleetCommand(options, mockClient, mockOut, mockLogger)
      ).rejects.toThrow(ConfigurationError);
    });

    it('should shutdown all Bits with --all --confirm', async () => {
      mockClient.list.mockResolvedValue([
        { name: 'bit-1', profile: 'core', exposure: 'platform-only' },
      ]);
      mockClient.call.mockResolvedValue({ shutdown: true });

      const options: FleetDispatchOptions = {
        subcommand: 'shutdown',
        all: true,
        confirm: true,
      };

      await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.call).toHaveBeenCalledWith('bit-1', 'bit.shutdown');
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('restart command', () => {
    it('should restart single Bit', async () => {
      mockClient.call.mockResolvedValue({ restarted: true });

      const options: FleetDispatchOptions = {
        subcommand: 'restart',
        bit: 'llm-bot',
      };

      const result = await dispatchFleetCommand(options, mockClient, mockOut, mockLogger);

      expect(mockClient.call).toHaveBeenCalledWith('llm-bot', 'bit.restart');
      expect(result).toEqual({ restarted: true });
    });

    it('should require --confirm for --all', async () => {
      const options: FleetDispatchOptions = {
        subcommand: 'restart',
        all: true,
        // Missing confirm
      };

      await expect(
        dispatchFleetCommand(options, mockClient, mockOut, mockLogger)
      ).rejects.toThrow(ConfigurationError);
    });
  });
});
