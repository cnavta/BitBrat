import { EventStreamAnalyzerServer } from './event-stream-analyzer-service';

describe('event-stream-analyzer', () => {
  let server: EventStreamAnalyzerServer;

  beforeAll(async () => {
    server = new EventStreamAnalyzerServer();
    // Note: setup() is called in start(), not needed for these tests
  });

  afterAll(async () => {
    // Only close if windowManager was initialized
    if ((server as any).windowManager) {
      await server.close('test');
    }
  });

  it('should instantiate successfully', () => {
    expect(server).toBeDefined();
    expect(server).toBeInstanceOf(EventStreamAnalyzerServer);
  });
});
