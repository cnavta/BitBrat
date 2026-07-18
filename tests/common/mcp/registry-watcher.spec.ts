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

    // Create mock store that converts Firestore-style callbacks to watch-style
    const mockStore = {
      watch: jest.fn().mockImplementation((callback) => {
        // Store the callback for later use in tests
        // We'll need to convert Firestore snapshot format to configs array
        const firestoreCallback = (snapshot: any) => {
          const configs = snapshot.docChanges().map((change: any) => {
            const data = change.doc.data();
            return { ...data, name: data.name || change.doc.id };
          });
          callback(configs);
        };
        snapshotCallback = firestoreCallback;
        return jest.fn(); // unsubscribe
      }),
    };

    options = {
      store: mockStore,
      onServerActive: jest.fn().mockResolvedValue(undefined),
      onServerInactive: jest.fn().mockResolvedValue(undefined),
    };

    watcher = new RegistryWatcher(mockServer, options);
  });

  it('should start watching via the store', () => {
    watcher.start();
    expect(options.store.watch).toHaveBeenCalled();
  });

  it('should call onServerActive when a server is added', async () => {
    watcher.start();
    
    await snapshotCallback({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'id1',
            data: () => ({ name: 'test-server', status: 'active', command: 'test-cmd' })
          }
        }
      ]
    });

    expect(options.onServerActive).toHaveBeenCalledWith(expect.objectContaining({
      name: 'test-server',
      status: 'active',
      command: 'test-cmd'
    }));
  });

  it('should call onServerInactive when a server is removed', async () => {
    watcher.start();

    // First add the server
    await snapshotCallback({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'id1',
            data: () => ({ name: 'test-server', status: 'active', command: 'test-cmd' })
          }
        }
      ]
    });

    jest.clearAllMocks();

    // Then remove it (empty list means server was removed)
    await snapshotCallback({
      docChanges: () => []
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

  it('should skip invalid configuration (missing command for stdio)', async () => {
    watcher.start();
    
    await snapshotCallback({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'id2',
            data: () => ({ name: 'invalid-stdio', transport: 'stdio' }) // missing command
          }
        }
      ]
    });

    expect(options.onServerActive).not.toHaveBeenCalled();
    expect(mockServer.getLogger().warn).toHaveBeenCalledWith(
      'mcp.registry_watcher.invalid_config',
      expect.objectContaining({ name: 'invalid-stdio' })
    );
  });

  it('should skip invalid configuration (missing url for sse)', async () => {
    watcher.start();
    
    await snapshotCallback({
      docChanges: () => [
        {
          type: 'added',
          doc: {
            id: 'id3',
            data: () => ({ name: 'invalid-sse', transport: 'sse' }) // missing url
          }
        }
      ]
    });

    expect(options.onServerActive).not.toHaveBeenCalled();
    expect(mockServer.getLogger().warn).toHaveBeenCalledWith(
      'mcp.registry_watcher.invalid_config',
      expect.objectContaining({ name: 'invalid-sse' })
    );
  });

  it('should stop watching when stop is called', () => {
    const unsubscribe = jest.fn();

    // Override the mock store to return our tracked unsubscribe function
    options.store.watch = jest.fn().mockReturnValue(unsubscribe);

    watcher.start();
    watcher.stop();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
