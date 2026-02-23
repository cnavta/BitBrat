import { RegistryWatcher } from '../../../src/common/mcp/registry-watcher';
import { getFirestore } from '../../../src/common/firebase';

jest.mock('../../../src/common/firebase');

describe('RegistryWatcher', () => {
  let mockServer: any;
  let mockFirestore: any;
  let snapshotCallback: any;
  let options: any;
  let watcher: RegistryWatcher;

  beforeEach(() => {
    jest.clearAllMocks();

    mockServer = {
      getLogger: jest.fn().mockReturnValue({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    };

    mockFirestore = {
      collection: jest.fn().mockReturnThis(),
      onSnapshot: jest.fn().mockImplementation((cb) => {
        snapshotCallback = cb;
        return jest.fn(); // unsubscribe
      }),
    };

    (getFirestore as jest.Mock).mockReturnValue(mockFirestore);

    options = {
      onServerActive: jest.fn(),
      onServerInactive: jest.fn(),
    };

    watcher = new RegistryWatcher(mockServer, options);
  });

  it('should start watching the mcp_servers collection', () => {
    watcher.start();
    expect(mockFirestore.collection).toHaveBeenCalledWith('mcp_servers');
    expect(mockFirestore.onSnapshot).toHaveBeenCalled();
  });

  it('should call onServerActive when a server is added', async () => {
    watcher.start();
    
    await snapshotCallback({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'id1',
            data: () => ({ name: 'test-server', status: 'active' })
          }
        }
      ]
    });

    expect(options.onServerActive).toHaveBeenCalledWith(expect.objectContaining({
      name: 'test-server',
      status: 'active'
    }));
  });

  it('should call onServerInactive when a server is removed', async () => {
    watcher.start();
    
    await snapshotCallback({
      docChanges: () => [
        {
          type: 'removed',
          doc: {
            id: 'id1',
            data: () => ({ name: 'test-server' })
          }
        }
      ]
    });

    expect(options.onServerInactive).toHaveBeenCalledWith('test-server');
  });

  it('should call onServerInactive when status becomes inactive', async () => {
    watcher.start();
    
    await snapshotCallback({
      docChanges: () => [
        {
          type: 'modified',
          doc: {
            id: 'id1',
            data: () => ({ name: 'test-server', status: 'inactive' })
          }
        }
      ]
    });

    expect(options.onServerInactive).toHaveBeenCalledWith('test-server');
  });

  it('should stop watching when stop is called', () => {
    const unsubscribe = jest.fn();
    mockFirestore.onSnapshot.mockReturnValue(unsubscribe);
    
    watcher.start();
    watcher.stop();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
