/**
 * brat chat
 *
 * Sprint 363: Chat command migration (Pattern 2: Business Logic Module)
 *
 * Interactive chat with BitBrat platform via WebSocket gateway.
 * Delegates to ChatController from business/chat.ts
 */

import { Flags } from '@oclif/core';
import { BratCommand } from './base';
import { ChatController } from '../business/chat';

export default class Chat extends BratCommand {
  static override description = 'Interactive chat with platform via WebSocket gateway';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context local',
    '<%= config.bin %> <%= command.id %> --message "!ping" --user TestUser --context staging',
    '<%= config.bin %> <%= command.id %> --url ws://localhost:3004/ws/v1',
    '<%= config.bin %> <%= command.id %> --message "test" --context dev',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    url: Flags.string({
      description: 'Gateway WebSocket URL (overrides context resolution)',
      required: false,
    }),
    message: Flags.string({
      char: 'm',
      description: 'One-shot message (non-interactive mode)',
      required: false,
    }),
    user: Flags.string({
      char: 'u',
      description: 'User name for chat session',
      required: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Chat);

    const controller = new ChatController({
      rootDir: this.repoRoot,
      context: this.context.name,
      url: flags.url,
      message: flags.message,
      user: flags.user,
    });

    this.logger.info({
      action: 'chat',
      context: this.context.name,
      mode: flags.message ? 'one-shot' : 'interactive',
      url: flags.url || 'resolved-from-context'
    }, 'Starting chat session');

    // Start the chat session - this will block in interactive mode
    // until the user exits (Ctrl+D) or the connection closes
    await controller.start();

    // Don't call disconnect() here - it's handled by the controller's
    // cleanup handlers (rl.on('close'), ws.on('close'))
  }
}
