import { TwitchIrcClient } from '../twitch-irc-client';
import { logger } from '../../../../common/logging';

describe('TwitchIrcClient Tracer Logic', () => {
  const builder = { build: jest.fn() } as any;
  const publisher = { publish: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'info').mockImplementation();
    jest.spyOn(logger, 'debug').mockImplementation();
    jest.spyOn(logger, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('detects !trace command and sets qos.tracer to true', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan1']);
    // Spy on sendText since we want to verify feedback
    const sendTextSpy = jest.spyOn(client, 'sendText').mockResolvedValue(undefined as any);

    const mockEvent: any = {
      v: '2',
      correlationId: 'test-corr-id',
      traceId: 'test-trace-id',
      qos: {}
    };
    builder.build.mockReturnValue(mockEvent);

    await client.handleMessage('#chan1', 'user1', '!trace some command');

    expect(mockEvent.qos).toMatchObject({ tracer: true });
    expect(sendTextSpy).toHaveBeenCalledWith(
      expect.stringContaining('test-corr-id'),
      '#chan1'
    );
    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      qos: expect.objectContaining({ tracer: true })
    }));
  });

  it('does not set tracer if message does not start with !trace', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan1']);
    const sendTextSpy = jest.spyOn(client, 'sendText').mockResolvedValue(undefined as any);

    const mockEvent: any = {
      v: '2',
      correlationId: 'test-corr-id',
      qos: {}
    };
    builder.build.mockReturnValue(mockEvent);

    await client.handleMessage('#chan1', 'user1', 'Hello world');

    expect(mockEvent.qos.tracer).toBeUndefined();
    expect(sendTextSpy).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      qos: expect.not.objectContaining({ tracer: true })
    }));
  });

  it('handles !debug command for authorized users', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan1'], {
      debugUsers: ['twitch:authorized_user']
    });
    const sendTextSpy = jest.spyOn(client, 'sendText').mockResolvedValue(undefined as any);

    const mockEvent: any = {
      v: '2',
      correlationId: 'debug-corr-id',
      qos: {}
    };
    builder.build.mockImplementation((msg: any) => {
      // In a real builder, text would be mapped to message.text
      // Here we just verify the builder receives the stripped text
      expect(msg.text).toBe('my message');
      return { ...mockEvent, message: { text: msg.text } };
    });

    await client.handleMessage('#chan1', 'authorized_user', '!debug my message');

    expect(builder.build).toHaveBeenCalledWith(expect.objectContaining({
      text: 'my message'
    }));
    expect(sendTextSpy).toHaveBeenCalledWith(
      expect.stringContaining('debug-corr-id'),
      '#chan1'
    );
    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      qos: expect.objectContaining({ tracer: true }),
      message: expect.objectContaining({ text: 'my message' })
    }));
  });

  it('ignores !debug command for unauthorized users', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan1'], {
      debugUsers: ['twitch:other_user']
    });
    const sendTextSpy = jest.spyOn(client, 'sendText').mockResolvedValue(undefined as any);

    const mockEvent: any = {
      v: '2',
      correlationId: 'normal-corr-id',
      qos: {}
    };
    builder.build.mockImplementation((msg: any) => ({ ...mockEvent, message: { text: msg.text } }));

    await client.handleMessage('#chan1', 'unauthorized_user', '!debug my message');

    expect(builder.build).toHaveBeenCalledWith(expect.objectContaining({
      text: '!debug my message'
    }));
    expect(sendTextSpy).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      qos: expect.not.objectContaining({ tracer: true }),
      message: expect.objectContaining({ text: '!debug my message' })
    }));
  });

  it('is case-insensitive for authorized user detection', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan1'], {
      debugUsers: ['Twitch:Authorized_User'] // Mixed case in config
    });
    const sendTextSpy = jest.spyOn(client, 'sendText').mockResolvedValue(undefined as any);

    const mockEvent: any = {
      v: '2',
      correlationId: 'debug-corr-id',
      qos: {}
    };
    builder.build.mockImplementation((msg: any) => ({ ...mockEvent, message: { text: msg.text } }));

    // User types in different case, command in different case
    await client.handleMessage('#chan1', 'authorized_user', '!DEBUG my message');

    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      qos: expect.objectContaining({ tracer: true }),
      message: expect.objectContaining({ text: 'my message' })
    }));
  });

  it('reproduces issue with gonj_the_unjust', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan1'], {
      debugUsers: ['twitch:gonj_the_unjust']
    });
    const sendTextSpy = jest.spyOn(client, 'sendText').mockResolvedValue(undefined as any);

    const mockEvent: any = {
      v: '2',
      correlationId: 'debug-corr-id',
      qos: {}
    };
    builder.build.mockImplementation((msg: any) => ({ ...mockEvent, message: { text: msg.text } }));

    await client.handleMessage('#chan1', 'gonj_the_unjust', '!debug test message');

    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      qos: expect.objectContaining({ tracer: true }),
      message: expect.objectContaining({ text: 'test message' })
    }));
  });
  it('reproduces issue with gonj_the_unjust and space in config', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan1'], {
      // Sometimes users add spaces after commas in config strings
      debugUsers: ['twitch:authorized_user', ' twitch:gonj_the_unjust']
    });
    const sendTextSpy = jest.spyOn(client, 'sendText').mockResolvedValue(undefined as any);

    const mockEvent: any = {
      v: '2',
      correlationId: 'debug-corr-id',
      qos: {}
    };
    builder.build.mockImplementation((msg: any) => ({ ...mockEvent, message: { text: msg.text } }));

    await client.handleMessage('#chan1', 'gonj_the_unjust', '!debug test message');

    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      qos: expect.objectContaining({ tracer: true }),
      message: expect.objectContaining({ text: 'test message' })
    }));
  });
  it('reproduces issue with gonj_the_unjust and numerical ID in config', async () => {
    const client = new TwitchIrcClient(builder, publisher, ['chan1'], {
      // Numerical ID in config (as seen in global.yaml)
      debugUsers: ['twitch:91960688']
    });
    const sendTextSpy = jest.spyOn(client, 'sendText').mockResolvedValue(undefined as any);

    const mockEvent: any = {
      v: '2',
      correlationId: 'debug-corr-id',
      qos: {}
    };
    builder.build.mockImplementation((msg: any) => ({ ...mockEvent, message: { text: msg.text } }));

    // Twurple provides login name, not ID, in onMessage
    await client.handleMessage('#chan1', 'gonj_the_unjust', '!debug test message', { userId: '91960688' });

    expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      qos: expect.objectContaining({ tracer: true }),
      message: expect.objectContaining({ text: 'test message' })
    }));
  });
});
