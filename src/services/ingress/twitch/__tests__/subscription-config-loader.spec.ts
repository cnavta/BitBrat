import { SubscriptionConfigLoader, SubscriptionConfig } from '../subscription-config-loader';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

// Mock fs and yaml modules
jest.mock('fs/promises');
jest.mock('js-yaml');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockYaml = yaml as jest.Mocked<typeof yaml>;

describe('SubscriptionConfigLoader', () => {
  let configPath: string;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    configPath = '/test/config/eventsub-subscriptions.yaml';
  });

  describe('load()', () => {
    it('should load valid YAML config', async () => {
      const validConfig: SubscriptionConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            version: 2,
            scope: 'moderator:read:followers',
            priority: 'high',
            builder: 'buildFollow',
            internalType: 'system.twitch.follow',
            description: 'New follower event'
          },
          'stream.online': {
            enabled: true,
            version: 1,
            priority: 'critical',
            builder: 'buildStreamOnline',
            internalType: 'system.stream.online',
            mutation: {
              key: 'stream.state',
              value: 'on',
              ttl: 21600
            }
          }
        },
        channelOverrides: {}
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(validConfig));
      mockYaml.load.mockReturnValue(validConfig);

      const loader = new SubscriptionConfigLoader(configPath);
      const config = await loader.load();

      expect(config.version).toBe(1);
      expect(config.subscriptions['channel.follow'].enabled).toBe(true);
      expect(config.subscriptions['stream.online'].mutation?.key).toBe('stream.state');
      expect(mockFs.readFile).toHaveBeenCalledWith(configPath, 'utf8');
      expect(mockYaml.load).toHaveBeenCalled();
    });

    it('should cache loaded config on subsequent calls', async () => {
      const validConfig: SubscriptionConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(validConfig));
      mockYaml.load.mockReturnValue(validConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      // First load
      await loader.load();
      expect(mockFs.readFile).toHaveBeenCalledTimes(1);

      // Second load (should use cache)
      await loader.load();
      expect(mockFs.readFile).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should fall back to default config if file not found', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      const loader = new SubscriptionConfigLoader(configPath);
      const config = await loader.load();

      expect(config.version).toBe(1);
      expect(config.subscriptions['channel.follow']).toBeDefined();
      expect(config.subscriptions['channel.update']).toBeDefined();
      expect(config.subscriptions['stream.online']).toBeDefined();
      expect(config.subscriptions['stream.offline']).toBeDefined();
    });

    it('should throw on invalid YAML parse error', async () => {
      const yamlError = new Error('Invalid YAML syntax');
      mockFs.readFile.mockResolvedValue('invalid: yaml: content:');
      mockYaml.load.mockImplementation(() => {
        throw yamlError;
      });

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('Invalid YAML syntax');
    });

    it('should throw on invalid version', async () => {
      const invalidConfig = {
        version: 2, // Invalid version
        subscriptions: {
          'channel.follow': {
            enabled: true,
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockYaml.load.mockReturnValue(invalidConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('eventsub_config_invalid_version');
    });

    it('should throw on missing subscriptions', async () => {
      const invalidConfig = {
        version: 1
        // Missing subscriptions
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockYaml.load.mockReturnValue(invalidConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('eventsub_config_missing_subscriptions');
    });
  });

  describe('validate()', () => {
    it('should reject config with invalid enabled type', async () => {
      const invalidConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: 'yes', // Should be boolean
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockYaml.load.mockReturnValue(invalidConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('eventsub_config_invalid_enabled');
    });

    it('should reject config with missing builder', async () => {
      const invalidConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            // Missing builder
            internalType: 'system.twitch.follow'
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockYaml.load.mockReturnValue(invalidConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('eventsub_config_missing_builder');
    });

    it('should reject config with missing internalType', async () => {
      const invalidConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            builder: 'buildFollow'
            // Missing internalType
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockYaml.load.mockReturnValue(invalidConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('eventsub_config_missing_internal_type');
    });

    it('should reject config with invalid builder naming convention', async () => {
      const invalidConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            builder: 'createFollow', // Should start with 'build'
            internalType: 'system.twitch.follow'
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockYaml.load.mockReturnValue(invalidConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('eventsub_config_invalid_builder_name');
    });

    it('should reject config with invalid internalType format', async () => {
      const invalidConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            builder: 'buildFollow',
            internalType: 'invalid.format' // Should start with 'system.' or 'chat.'
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockYaml.load.mockReturnValue(invalidConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('eventsub_config_invalid_internal_type');
    });

    it('should accept valid system. and chat. prefixes', async () => {
      const validConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          },
          'channel.chat.message': {
            enabled: true,
            builder: 'buildChatMessage',
            internalType: 'chat.message.v1'
          },
          'channel.hype_train.begin': {
            enabled: true,
            builder: 'buildHypeTrainBegin',
            internalType: 'system.twitch.hype_train.begin' // Underscores allowed
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(validConfig));
      mockYaml.load.mockReturnValue(validConfig);

      const loader = new SubscriptionConfigLoader(configPath);
      const config = await loader.load();

      expect(config.subscriptions['channel.follow'].internalType).toBe('system.twitch.follow');
      expect(config.subscriptions['channel.chat.message'].internalType).toBe('chat.message.v1');
      expect(config.subscriptions['channel.hype_train.begin'].internalType).toBe('system.twitch.hype_train.begin');
    });

    it('should reject config with invalid priority', async () => {
      const invalidConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            builder: 'buildFollow',
            internalType: 'system.twitch.follow',
            priority: 'super-high' // Invalid priority
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockYaml.load.mockReturnValue(invalidConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('eventsub_config_invalid_priority');
    });

    it('should accept valid priorities', async () => {
      const validConfig = {
        version: 1,
        subscriptions: {
          'event1': {
            enabled: true,
            builder: 'buildEvent1',
            internalType: 'system.test.event1',
            priority: 'critical'
          },
          'event2': {
            enabled: true,
            builder: 'buildEvent2',
            internalType: 'system.test.event2',
            priority: 'high'
          },
          'event3': {
            enabled: true,
            builder: 'buildEvent3',
            internalType: 'system.test.event3',
            priority: 'medium'
          },
          'event4': {
            enabled: true,
            builder: 'buildEvent4',
            internalType: 'system.test.event4',
            priority: 'low'
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(validConfig));
      mockYaml.load.mockReturnValue(validConfig);

      const loader = new SubscriptionConfigLoader(configPath);
      const config = await loader.load();

      expect(config.subscriptions['event1'].priority).toBe('critical');
      expect(config.subscriptions['event2'].priority).toBe('high');
      expect(config.subscriptions['event3'].priority).toBe('medium');
      expect(config.subscriptions['event4'].priority).toBe('low');
    });

    it('should validate mutation structure', async () => {
      const invalidConfig = {
        version: 1,
        subscriptions: {
          'stream.online': {
            enabled: true,
            builder: 'buildStreamOnline',
            internalType: 'system.stream.online',
            mutation: {
              // Missing key
              value: 'on'
            }
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockYaml.load.mockReturnValue(invalidConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('eventsub_config_invalid_mutation');
    });

    it('should validate mutation TTL range', async () => {
      const invalidConfig = {
        version: 1,
        subscriptions: {
          'stream.online': {
            enabled: true,
            builder: 'buildStreamOnline',
            internalType: 'system.stream.online',
            mutation: {
              key: 'stream.state',
              value: 'on',
              ttl: 100000 // Exceeds max (86400)
            }
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockYaml.load.mockReturnValue(invalidConfig);

      const loader = new SubscriptionConfigLoader(configPath);

      await expect(loader.load()).rejects.toThrow('eventsub_config_invalid_mutation');
    });
  });

  describe('reload()', () => {
    it('should clear cache and reload config', async () => {
      const config1: SubscriptionConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          }
        }
      };

      const config2: SubscriptionConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: false, // Changed
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          }
        }
      };

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(config1))
        .mockResolvedValueOnce(JSON.stringify(config2));

      mockYaml.load
        .mockReturnValueOnce(config1)
        .mockReturnValueOnce(config2);

      const loader = new SubscriptionConfigLoader(configPath);

      // First load
      const firstConfig = await loader.load();
      expect(firstConfig.subscriptions['channel.follow'].enabled).toBe(true);

      // Reload (should read file again)
      const reloadedConfig = await loader.reload();
      expect(reloadedConfig.subscriptions['channel.follow'].enabled).toBe(false);
      expect(mockFs.readFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('getDefaultConfig()', () => {
    it('should return default config with 4 existing events', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      const loader = new SubscriptionConfigLoader(configPath);
      const config = await loader.load();

      expect(config.version).toBe(1);
      expect(Object.keys(config.subscriptions).length).toBe(4);
      expect(config.subscriptions['channel.follow'].enabled).toBe(true);
      expect(config.subscriptions['channel.update'].enabled).toBe(true);
      expect(config.subscriptions['stream.online'].enabled).toBe(true);
      expect(config.subscriptions['stream.offline'].enabled).toBe(true);
    });

    it('should include mutations in default config', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      const loader = new SubscriptionConfigLoader(configPath);
      const config = await loader.load();

      expect(config.subscriptions['stream.online'].mutation).toBeDefined();
      expect(config.subscriptions['stream.online'].mutation?.key).toBe('stream.state');
      expect(config.subscriptions['stream.online'].mutation?.value).toBe('on');
      expect(config.subscriptions['stream.online'].mutation?.ttl).toBe(21600);

      expect(config.subscriptions['stream.offline'].mutation).toBeDefined();
      expect(config.subscriptions['stream.offline'].mutation?.value).toBe('off');
    });

    it('should cache default config', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      const loader = new SubscriptionConfigLoader(configPath);

      // First load (uses default)
      await loader.load();
      expect(mockFs.readFile).toHaveBeenCalledTimes(1);

      // Second load (should use cached default)
      await loader.load();
      expect(mockFs.readFile).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe('default config path', () => {
    it('should use default path when no path provided', async () => {
      const validConfig: SubscriptionConfig = {
        version: 1,
        subscriptions: {
          'channel.follow': {
            enabled: true,
            builder: 'buildFollow',
            internalType: 'system.twitch.follow'
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(validConfig));
      mockYaml.load.mockReturnValue(validConfig);

      const loader = new SubscriptionConfigLoader(); // No path provided
      await loader.load();

      const expectedPath = path.join(
        process.cwd(),
        'config/twitch-eventsub/subscriptions.yaml'
      );
      expect(mockFs.readFile).toHaveBeenCalledWith(expectedPath, 'utf8');
    });
  });
});
