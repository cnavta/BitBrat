import { IngressManager } from '../ingress';
import { Logger } from '../../../common/logging';

describe('IngressManager', () => {
  let mockPublisher: any;
  let mockPublishers: any;
  let mockLogger: Logger;

  beforeEach(() => {
    mockPublisher = {
      publishJson: jest.fn().mockResolvedValue({ messageId: '123' })
    };
    mockPublishers = {
      create: jest.fn().mockReturnValue(mockPublisher)
    };
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    } as any;
  });

  it('should set egress destination to the provided topic', async () => {
    const egressTopic = 'internal.api.egress.v1.test-instance';
    const manager = new IngressManager(mockPublishers, mockLogger, egressTopic);
    
    const payload = { text: 'hello' };
    const frame = JSON.stringify({
      type: 'chat.message.send',
      payload
    });

    await manager.handleMessage('user-1', frame);

    expect(mockPublisher.publishJson).toHaveBeenCalledWith(
      expect.objectContaining({
        egress: {
          destination: egressTopic,
          type: 'chat'
        }
      }),
      expect.anything()
    );
  });

  it('should fallback to api-gateway if no topic provided', async () => {
    const manager = new IngressManager(mockPublishers, mockLogger);
    
    const frame = JSON.stringify({
      type: 'chat.message.send',
      payload: { text: 'hello' }
    });

    await manager.handleMessage('user-1', frame);

    expect(mockPublisher.publishJson).toHaveBeenCalledWith(
      expect.objectContaining({
        egress: {
          destination: 'api-gateway',
          type: 'chat'
        }
      }),
      expect.anything()
    );
  });
});
