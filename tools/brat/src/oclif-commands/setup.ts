/**
 * Setup Command
 *
 * Interactive platform setup wizard.
 * Creates local configuration files and initializes Firestore/PostgreSQL with seed data.
 *
 * Effects:
 * - Creates .bitbrat.json configuration file
 * - Creates .secure.local with secrets
 * - Creates env/local/global.yaml
 * - Seeds database with initial routing rules and personalities
 */

import { Flags } from '@oclif/core';
import { BratCommand } from './base';
import inquirer from 'inquirer';
import * as path from 'path';
import * as fs from 'fs';
import { cmdSetup, isAlreadyInitialized, SetupOptions } from '../cli/setup';

export default class Setup extends BratCommand {
  static description = 'Interactive platform setup wizard';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --project-id my-project',
    '<%= config.bin %> <%= command.id %> --non-interactive',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP Project ID',
    }),
    'openai-key': Flags.string({
      description: 'OpenAI API Key',
    }),
    'bot-name': Flags.string({
      description: 'Bot name',
    }),
    'non-interactive': Flags.boolean({
      description: 'Run in non-interactive mode with defaults',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force setup even if already initialized',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Setup);

    this.logger.info({ action: 'setup.start' }, 'Starting BitBrat Platform Setup');

    // Check if already initialized
    const markers = isAlreadyInitialized(this.repoRoot);
    if (markers.length > 0 && !flags.force) {
      this.warn('Platform appears to be already initialized.');
      this.warn(`Detected: ${markers.join(', ')}`);

      if (!flags['non-interactive']) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Continue and overwrite existing local settings?',
            default: false,
          },
        ]);

        if (!confirm) {
          this.log('Setup aborted.');
          this.logger.info({ action: 'setup.aborted' }, 'User aborted setup');
          return;
        }
      } else {
        this.error('Platform already initialized. Use --force to overwrite.', { exit: 1 });
      }
    }

    try {
      let setupOptions: SetupOptions = {};

      if (flags['non-interactive']) {
        // Non-interactive mode: use flags or defaults
        setupOptions = {
          projectId: flags['project-id'] || 'bitbrat-dev',
          openaiKey: flags['openai-key'] || process.env.OPENAI_API_KEY,
          botName: flags['bot-name'] || 'BitBrat',
        };

        if (!setupOptions.openaiKey) {
          this.error('OpenAI API Key required in non-interactive mode. Use --openai-key or set OPENAI_API_KEY.', {
            exit: 1,
          });
        }

        this.log(`Using project ID: ${setupOptions.projectId}`);
        this.log(`Using bot name: ${setupOptions.botName}`);
      } else {
        // Interactive mode: prompt user
        const answers = await this.promptSetupQuestions(flags);
        setupOptions = {
          projectId: answers.projectId,
          openaiKey: answers.openaiKey,
          botName: answers.botName,
        };
      }

      // Delegate to existing setup implementation
      this.log('');
      this.log('Setting up BitBrat Platform...');

      await cmdSetup(setupOptions, this.logger);

      this.log('');
      this.log('✓ Setup complete!');
      this.log('');
      this.log('Next steps:');
      this.log('  1. Start the local stack: npm run local');
      this.log('  2. View logs: npm run local:logs');
      this.log('  3. Test with chat: npm run brat -- chat');
    } catch (error: any) {
      this.logger.error({ error: error.message, stack: error.stack }, 'Setup failed');
      this.error(error.message || 'Setup failed', { exit: 1 });
    }
  }

  /**
   * Prompt user for setup questions interactively
   */
  private async promptSetupQuestions(flags: any): Promise<{
    projectId: string;
    openaiKey: string;
    botName: string;
  }> {
    this.log('');
    this.log('=== BitBrat Platform Setup ===');
    this.log('');

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'projectId',
        message: 'GCP Project ID:',
        default: flags['project-id'] || 'bitbrat-dev',
        validate: (input: string) => {
          if (!input) {
            return 'Project ID is required';
          }
          return true;
        },
      },
      {
        type: 'password',
        name: 'openaiKey',
        message: 'OpenAI API Key:',
        default: flags['openai-key'] || process.env.OPENAI_API_KEY,
        validate: (input: string) => {
          if (!input) {
            return 'OpenAI API Key is required';
          }
          if (!input.startsWith('sk-')) {
            return 'OpenAI API Key should start with "sk-"';
          }
          return true;
        },
      },
      {
        type: 'input',
        name: 'botName',
        message: 'Bot Name:',
        default: flags['bot-name'] || 'BitBrat',
        validate: (input: string) => {
          if (!input) {
            return 'Bot name is required';
          }
          if (input.length < 2) {
            return 'Bot name must be at least 2 characters';
          }
          return true;
        },
      },
    ]);

    return answers;
  }
}
