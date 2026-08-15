/**
 * oclif Command: integration create
 * Sprint 13: DX-011
 *
 * Scaffolds a new platform integration with all necessary boilerplate.
 * Generates connector adapter, client, YAML config, and test files.
 *
 * Examples:
 *   brat integration create telegram --api-client "@telegraf/telegraf" --docs "https://core.telegram.org/bots/api"
 *   brat integration create matrix --api-client "matrix-js-sdk" --docs "https://matrix.org/docs/api"
 */

import { Flags, Args } from '@oclif/core';
import { BratCommand } from '../base';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as ejs from 'ejs';

interface TemplateContext {
  platformName: string;
  platformTitle: string;
  platformClass: string;
  apiClient: string;
  docsUrl: string;
  createdAt: string;
  sprintNumber?: string;
}

export default class IntegrationCreate extends BratCommand {
  static description = 'Scaffold a new platform integration';

  static examples = [
    '<%= config.bin %> <%= command.id %> telegram --api-client "@telegraf/telegraf" --docs "https://core.telegram.org/bots/api"',
    '<%= config.bin %> <%= command.id %> matrix --api-client "matrix-js-sdk" --docs "https://matrix.org/docs/api"',
    '<%= config.bin %> <%= command.id %> teams --api-client "@microsoft/teams-js" --docs "https://docs.microsoft.com/en-us/microsoftteams/platform"',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    'api-client': Flags.string({
      description: 'NPM package name for platform SDK (e.g., "@telegraf/telegraf")',
      required: true,
    }),
    docs: Flags.string({
      description: 'Platform API documentation URL',
      required: true,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be generated without creating files',
      default: false,
    }),
  };

  static args = {
    platform: Args.string({
      description: 'Platform name (lowercase, e.g., telegram, matrix, teams)',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(IntegrationCreate);

    const platformName = args.platform.toLowerCase();
    const apiClient = flags['api-client'];
    const docsUrl = flags.docs;
    const dryRun = flags['dry-run'];

    // Validate platform name format
    if (!/^[a-z][a-z0-9-]*$/.test(platformName)) {
      this.error(
        `Invalid platform name: "${platformName}". Must be lowercase, start with a letter, and contain only letters, numbers, and hyphens.`
      );
    }

    this.logger.info(`Creating ${platformName} integration (api-client: ${apiClient}, dry-run: ${dryRun})`);

    // Generate template context
    const context = this.buildTemplateContext(platformName, apiClient, docsUrl);

    // Define target paths
    const targetPaths = this.getTargetPaths(platformName);

    // Check if platform already exists
    const exists = await this.checkPlatformExists(targetPaths);
    if (exists) {
      this.error(
        `Platform "${platformName}" already exists at ${targetPaths.connectorDir}.\n` +
        'Remove the existing files or choose a different platform name.'
      );
    }

    // Generate files
    if (dryRun) {
      this.log('\n📋 Dry run mode - would create:\n');
      this.displayPlan(targetPaths);
      return;
    }

    try {
      await this.generateFiles(context, targetPaths);
      this.displaySuccess(platformName, targetPaths, apiClient);
    } catch (err: any) {
      this.error(`Failed to generate integration: ${err.message}`);
    }
  }

  /**
   * Builds the template context from platform name and options
   */
  private buildTemplateContext(
    platformName: string,
    apiClient: string,
    docsUrl: string
  ): TemplateContext {
    // Generate platform title (capitalize first letter, handle hyphens)
    const platformTitle = platformName
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    // Generate class name (PascalCase, remove hyphens)
    const platformClass = platformName
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    return {
      platformName,
      platformTitle,
      platformClass,
      apiClient,
      docsUrl,
      createdAt: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      sprintNumber: '13',
    };
  }

  /**
   * Gets target file paths for the generated integration
   */
  private getTargetPaths(platformName: string) {
    return {
      connectorDir: path.join(this.repoRoot, 'src', 'services', 'ingress', platformName),
      connectorAdapter: path.join(this.repoRoot, 'src', 'services', 'ingress', platformName, 'connector-adapter.ts'),
      client: path.join(this.repoRoot, 'src', 'services', 'ingress', platformName, `${platformName}-ingress-client.ts`),
      test: path.join(this.repoRoot, 'src', 'services', 'ingress', platformName, 'connector-adapter.test.ts'),
      configDir: path.join(this.repoRoot, 'config', 'platforms', platformName),
      yamlConfig: path.join(this.repoRoot, 'config', 'platforms', platformName, 'chat-message.v1.yaml'),
    };
  }

  /**
   * Checks if platform integration already exists
   */
  private async checkPlatformExists(targetPaths: ReturnType<typeof this.getTargetPaths>): Promise<boolean> {
    try {
      await fs.access(targetPaths.connectorDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generates all integration files from templates
   */
  private async generateFiles(
    context: TemplateContext,
    targetPaths: ReturnType<typeof this.getTargetPaths>
  ): Promise<void> {
    const templatesDir = path.join(this.repoRoot, 'templates', 'integration');

    this.logger.info(`Generating ${context.platformName} integration files...`);

    // Create directories
    await fs.mkdir(targetPaths.connectorDir, { recursive: true });
    await fs.mkdir(targetPaths.configDir, { recursive: true });

    // Generate connector adapter
    this.logger.debug('Generating connector-adapter.ts');
    const connectorAdapterTemplate = await fs.readFile(
      path.join(templatesDir, 'connector-adapter.ts.ejs'),
      'utf-8'
    );
    const connectorAdapterContent = ejs.render(connectorAdapterTemplate, context);
    await fs.writeFile(targetPaths.connectorAdapter, connectorAdapterContent);

    // Generate client
    this.logger.debug('Generating ingress client');
    const clientTemplate = await fs.readFile(
      path.join(templatesDir, 'client.ts.ejs'),
      'utf-8'
    );
    const clientContent = ejs.render(clientTemplate, context);
    await fs.writeFile(targetPaths.client, clientContent);

    // Generate test
    this.logger.debug('Generating tests');
    const testTemplate = await fs.readFile(
      path.join(templatesDir, 'connector-adapter.test.ts.ejs'),
      'utf-8'
    );
    const testContent = ejs.render(testTemplate, context);
    await fs.writeFile(targetPaths.test, testContent);

    // Generate YAML config
    this.logger.debug('Generating YAML config');
    const yamlTemplate = await fs.readFile(
      path.join(templatesDir, 'chat-message.v1.yaml.ejs'),
      'utf-8'
    );
    const yamlContent = ejs.render(yamlTemplate, context);
    await fs.writeFile(targetPaths.yamlConfig, yamlContent);

    this.logger.info(`Successfully generated ${context.platformName} integration`);
  }

  /**
   * Displays what would be created in dry-run mode
   */
  private displayPlan(targetPaths: ReturnType<typeof this.getTargetPaths>): void {
    this.log(`  📁 ${path.relative(this.repoRoot, targetPaths.connectorDir)}/`);
    this.log(`     └─ ${path.basename(targetPaths.connectorAdapter)}`);
    this.log(`     └─ ${path.basename(targetPaths.client)}`);
    this.log(`     └─ ${path.basename(targetPaths.test)}`);
    this.log('');
    this.log(`  📁 ${path.relative(this.repoRoot, targetPaths.configDir)}/`);
    this.log(`     └─ ${path.basename(targetPaths.yamlConfig)}`);
    this.log('');
  }

  /**
   * Displays success message with next steps
   */
  private displaySuccess(
    platformName: string,
    targetPaths: ReturnType<typeof this.getTargetPaths>,
    apiClient: string
  ): void {
    this.log('');
    this.log('✅ Integration scaffolded successfully!');
    this.log('');
    this.log('📦 Files created:');
    this.displayPlan(targetPaths);

    this.log('');
    this.log('🚀 Next steps:');
    this.log('');
    this.log(`1. Install the API client:`);
    this.log(`   npm install ${apiClient}`);
    this.log('');
    this.log(`2. Update the YAML config to match ${platformName}'s event structure:`);
    this.log(`   ${path.relative(this.repoRoot, targetPaths.yamlConfig)}`);
    this.log('');
    this.log('3. Implement the client methods:');
    this.log(`   ${path.relative(this.repoRoot, targetPaths.client)}`);
    this.log('');
    this.log(`4. Test your integration:`);
    this.log(`   npm run brat -- integration validate ${platformName}`);
    this.log(`   npm run brat -- integration test ${platformName} --event message --fixture <path-to-fixture>`);
    this.log('');
    this.log('5. Register the connector in ingress-egress-service.ts');
    this.log('');
    this.log('📚 Documentation:');
    this.log('   ./documentation/guides/adding-ingress-platform.md');
    this.log('');
  }
}
