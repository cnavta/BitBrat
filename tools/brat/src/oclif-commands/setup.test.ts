/**
 * Setup Command Tests
 * Sprint 359: Integration tests for brat setup command
 */

import { test } from '@oclif/test';
import * as fs from 'fs';
import inquirer from 'inquirer';
import Setup from './setup';
import { cmdSetup, isAlreadyInitialized } from '../cli/setup';

// Mock dependencies
jest.mock('fs');
jest.mock('inquirer');
jest.mock('../cli/setup');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockCmdSetup = cmdSetup as jest.MockedFunction<typeof cmdSetup>;
const mockIsAlreadyInitialized = isAlreadyInitialized as jest.MockedFunction<
  typeof isAlreadyInitialized
>;

describe('brat setup', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default: not initialized
    mockIsAlreadyInitialized.mockReturnValue([]);

    // Mock cmdSetup to resolve successfully
    mockCmdSetup.mockResolvedValue(undefined);

    // Mock fs operations
    mockFs.existsSync.mockReturnValue(false);
  });

  describe('Non-Interactive Mode', () => {
    test
      .stdout()
      .command([
        'setup',
        '--non-interactive',
        '--project-id=test-project',
        '--openai-key=sk-test123',
        '--bot-name=TestBot',
      ])
      .it('should run setup with flags', (ctx) => {
        expect(mockCmdSetup).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: 'test-project',
            openaiKey: 'sk-test123',
            botName: 'TestBot',
          }),
          expect.anything()
        );
        expect(ctx.stdout).toContain('✓ Setup complete!');
      });

    test
      .stdout()
      .command(['setup', '--non-interactive', '--project-id=test-project', '--bot-name=TestBot'])
      .catch((error) => {
        expect(error.message).toContain('OpenAI API Key required');
      })
      .it('should require OpenAI key in non-interactive mode');

    test
      .stdout()
      .command(['setup', '--non-interactive', '--openai-key=sk-test123'])
      .it('should use defaults for optional flags', (ctx) => {
        expect(mockCmdSetup).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: 'bitbrat-dev',
            botName: 'BitBrat',
          }),
          expect.anything()
        );
      });

    test
      .env({ OPENAI_API_KEY: 'sk-env-key' })
      .stdout()
      .command(['setup', '--non-interactive'])
      .it('should use OPENAI_API_KEY env var', () => {
        expect(mockCmdSetup).toHaveBeenCalledWith(
          expect.objectContaining({
            openaiKey: 'sk-env-key',
          }),
          expect.anything()
        );
      });
  });

  describe('Interactive Mode', () => {
    test
      .stdout()
      .do(() => {
        mockInquirer.prompt = jest.fn().mockResolvedValue({
          projectId: 'interactive-project',
          openaiKey: 'sk-interactive',
          botName: 'InteractiveBot',
        });
      })
      .command(['setup'])
      .it('should prompt for inputs in interactive mode', () => {
        expect(mockInquirer.prompt).toHaveBeenCalled();
        expect(mockCmdSetup).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: 'interactive-project',
            openaiKey: 'sk-interactive',
            botName: 'InteractiveBot',
          }),
          expect.anything()
        );
      });

    test
      .stdout()
      .do(() => {
        mockInquirer.prompt = jest.fn().mockResolvedValue({
          projectId: '',
          openaiKey: 'sk-test',
          botName: 'Bot',
        });
      })
      .command(['setup'])
      .it('should validate project ID is required', () => {
        // Validation happens in promptSetupQuestions
        expect(mockInquirer.prompt).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'projectId',
              validate: expect.any(Function),
            }),
          ])
        );
      });

    test
      .stdout()
      .do(() => {
        mockInquirer.prompt = jest.fn().mockResolvedValue({
          projectId: 'test',
          openaiKey: 'invalid-key',
          botName: 'Bot',
        });
      })
      .command(['setup'])
      .it('should validate OpenAI key format', () => {
        expect(mockInquirer.prompt).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'openaiKey',
              validate: expect.any(Function),
            }),
          ])
        );
      });

    test
      .stdout()
      .do(() => {
        mockInquirer.prompt = jest.fn().mockResolvedValue({
          projectId: 'test',
          openaiKey: 'sk-test',
          botName: 'A',
        });
      })
      .command(['setup'])
      .it('should validate bot name length', () => {
        expect(mockInquirer.prompt).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'botName',
              validate: expect.any(Function),
            }),
          ])
        );
      });
  });

  describe('Initialization Detection', () => {
    test
      .stdout()
      .do(() => {
        mockIsAlreadyInitialized.mockReturnValue(['.bitbrat.json', '.secure.local']);
        mockInquirer.prompt = jest.fn().mockResolvedValue({
          confirm: false,
        });
      })
      .command(['setup'])
      .it('should detect existing initialization and abort if user declines', (ctx) => {
        expect(mockIsAlreadyInitialized).toHaveBeenCalled();
        expect(ctx.stdout).toContain('Setup aborted');
        expect(mockCmdSetup).not.toHaveBeenCalled();
      });

    test
      .stdout()
      .do(() => {
        mockIsAlreadyInitialized.mockReturnValue(['.bitbrat.json']);
        mockInquirer.prompt = jest.fn().mockResolvedValue({
          confirm: true,
          projectId: 'test',
          openaiKey: 'sk-test',
          botName: 'Bot',
        });
      })
      .command(['setup'])
      .it('should proceed if user confirms overwrite', () => {
        expect(mockCmdSetup).toHaveBeenCalled();
      });

    test
      .stdout()
      .do(() => {
        mockIsAlreadyInitialized.mockReturnValue(['.bitbrat.json']);
      })
      .command(['setup', '--force', '--non-interactive', '--openai-key=sk-test'])
      .it('should skip confirmation with --force flag', () => {
        expect(mockInquirer.prompt).not.toHaveBeenCalled();
        expect(mockCmdSetup).toHaveBeenCalled();
      });

    test
      .stdout()
      .do(() => {
        mockIsAlreadyInitialized.mockReturnValue(['.bitbrat.json']);
      })
      .command(['setup', '--non-interactive', '--openai-key=sk-test'])
      .catch((error) => {
        expect(error.message).toContain('Already initialized');
        expect(error.message).toContain('--force');
      })
      .it('should error in non-interactive mode if already initialized');
  });

  describe('Help Text', () => {
    test
      .stdout()
      .command(['setup', '--help'])
      .it('should display help text', (ctx) => {
        expect(ctx.stdout).toContain('Interactive platform setup wizard');
        expect(ctx.stdout).toContain('--project-id');
        expect(ctx.stdout).toContain('--openai-key');
        expect(ctx.stdout).toContain('--bot-name');
        expect(ctx.stdout).toContain('--non-interactive');
        expect(ctx.stdout).toContain('--force');
      });
  });

  describe('Error Handling', () => {
    test
      .stdout()
      .do(() => {
        mockCmdSetup.mockRejectedValue(new Error('Setup failed: Database connection error'));
      })
      .command(['setup', '--non-interactive', '--openai-key=sk-test'])
      .catch((error: any) => {
        expect(error.message).toContain('Setup failed');
      })
      .it('should handle cmdSetup errors gracefully');

    test
      .stdout()
      .do(() => {
        mockInquirer.prompt = jest.fn().mockRejectedValue(new Error('Prompt error'));
      })
      .command(['setup'])
      .catch((error: any) => {
        expect(error.message).toContain('Prompt error');
      })
      .it('should handle inquirer errors');
  });

  describe('Context Integration', () => {
    test
      .stdout()
      .command([
        'setup',
        '--context=local',
        '--non-interactive',
        '--openai-key=sk-test',
      ])
      .it('should accept --context flag from BratCommand');

    test
      .stdout()
      .command([
        'setup',
        '--verbose',
        '--non-interactive',
        '--openai-key=sk-test',
      ])
      .it('should accept --verbose flag from BratCommand');
  });

  describe('Next Steps Display', () => {
    test
      .stdout()
      .command(['setup', '--non-interactive', '--openai-key=sk-test'])
      .it('should display next steps after setup', (ctx) => {
        expect(ctx.stdout).toContain('Next steps:');
        expect(ctx.stdout).toContain('npm run local');
        expect(ctx.stdout).toContain('npm run local:logs');
        expect(ctx.stdout).toContain('npm run brat -- chat');
      });
  });

  describe('Flag Precedence', () => {
    test
      .env({ OPENAI_API_KEY: 'sk-env' })
      .stdout()
      .command([
        'setup',
        '--non-interactive',
        '--openai-key=sk-flag',
      ])
      .it('should prefer flag over env var', () => {
        expect(mockCmdSetup).toHaveBeenCalledWith(
          expect.objectContaining({
            openaiKey: 'sk-flag',
          }),
          expect.anything()
        );
      });

    test
      .stdout()
      .command([
        'setup',
        '--non-interactive',
        '--openai-key=sk-test',
        '--project-id=custom-project',
        '--bot-name=CustomBot',
      ])
      .it('should use all provided flags', () => {
        expect(mockCmdSetup).toHaveBeenCalledWith(
          {
            projectId: 'custom-project',
            openaiKey: 'sk-test',
            botName: 'CustomBot',
          },
          expect.anything()
        );
      });
  });

  describe('Logging', () => {
    test
      .stdout()
      .command(['setup', '--non-interactive', '--openai-key=sk-test'])
      .it('should log setup progress', (ctx) => {
        expect(ctx.stdout).toContain('Setting up BitBrat Platform');
        expect(ctx.stdout).toContain('Setup complete');
      });

    test
      .stdout()
      .do(() => {
        mockIsAlreadyInitialized.mockReturnValue(['.bitbrat.json', '.secure.local']);
        mockInquirer.prompt = jest.fn().mockResolvedValue({ confirm: false });
      })
      .command(['setup'])
      .it('should warn about existing initialization', (ctx) => {
        expect(ctx.stdout).toMatch(/already initialized|detected/i);
      });
  });
});
