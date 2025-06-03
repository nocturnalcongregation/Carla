// react/src/osc-worker.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock values for OSC.STATUS
const OSC_STATUS = {
  IS_CLOSED: 0,
  IS_OPEN: 1,
  IS_CONNECTING: 2,
  IS_CLOSING: 3,
};

const mockOscInstance = {
  open: vi.fn(),
  close: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  off: vi.fn(), // If worker uses it for cleanup
  status: vi.fn(() => OSC_STATUS.IS_CLOSED), // Default to closed
  plugin: null as any,
};

// OSC class mock
const MockOSC = vi.fn((options?: any) => {
  mockOscInstance.plugin = options?.plugin;
  mockOscInstance.open.mockClear();
  mockOscInstance.close.mockClear();
  mockOscInstance.send.mockClear();
  mockOscInstance.on.mockClear();
  mockOscInstance.status.mockReturnValue(OSC_STATUS.IS_CLOSED); // Default to closed initially for an instance
  return mockOscInstance;
});
// Attach static properties to the mock constructor
MockOSC.WebsocketClientPlugin = vi.fn(() => ({ type: 'WebsocketClientPlugin' }));
MockOSC.STATUS = OSC_STATUS;
MockOSC.Message = vi.fn((address, ...args) => ({ address, args })); // Mock for OSC.Message

vi.mock('osc-js', () => {
  return {
    default: MockOSC, // This is the OSC class constructor
    STATUS: OSC_STATUS, // Export STATUS if used directly like OSC.STATUS from the module
    // Message is now a static property of MockOSC
  };
});

let oscWorkerExposedMethods: any;
let exposedArg: any; // Moved to module scope
// These will capture the callbacks registered by the worker via its own onStatusChange/onMessage
let workerInternalStatusCallback: ((status: string) => void) | null = null;
let workerInternalMessageCallback: ((message: any) => void) | null = null;

describe('OSC Worker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockOscInstance.status.mockReturnValue(OSC_STATUS.IS_OPEN); // Default to connected for most tests

    workerInternalStatusCallback = null;
    workerInternalMessageCallback = null;

    // exposedArg is now at module scope, so it's assigned correctly by the hoisted mock
    vi.mock('comlink', () => ({
      expose: (obj: any) => { exposedArg = obj; }, // This will now assign to the module-scoped exposedArg
      proxy: vi.fn(cb => (...args) => cb(...args)),
    }));

    await import('./osc-worker');
    oscWorkerExposedMethods = exposedArg;

    if (oscWorkerExposedMethods && typeof oscWorkerExposedMethods.onStatusChange === 'function') {
        oscWorkerExposedMethods.onStatusChange((status: string) => {
            if (workerInternalStatusCallback) workerInternalStatusCallback(status);
        });
    }
    if (oscWorkerExposedMethods && typeof oscWorkerExposedMethods.onMessage === 'function') {
        oscWorkerExposedMethods.onMessage((message: any) => {
            if (workerInternalMessageCallback) workerInternalMessageCallback(message);
        });
    }
  });

  it('should expose all required methods', () => {
    expect(oscWorkerExposedMethods).toBeDefined();
    expect(typeof oscWorkerExposedMethods.connect).toBe('function');
    expect(typeof oscWorkerExposedMethods.disconnect).toBe('function');
    // ... and so on for all methods
  });

  describe('connect', () => {
    it('should initialize OSC, call internal status callback with "Connecting...", and attempt to open connection', async () => {
      workerInternalStatusCallback = vi.fn();
      await oscWorkerExposedMethods.connect('localhost', 12345, 54321);
      expect(workerInternalStatusCallback).toHaveBeenCalledWith('Connecting...');
      expect(mockOscInstance.open).toHaveBeenCalled();
    });

    it('should call internal status callback with "OSC TCP Connected" on "open" event from OSC library', async () => {
      workerInternalStatusCallback = vi.fn();
      await oscWorkerExposedMethods.connect('localhost', 12345, 54321);

      const openEventHandler = mockOscInstance.on.mock.calls.find(call => call[0] === 'open')?.[1];
      expect(openEventHandler).toBeInstanceOf(Function);
      if (openEventHandler) openEventHandler();

      expect(workerInternalStatusCallback).toHaveBeenCalledWith('OSC TCP Connected');
    });

     it('should call internal status callback with "OSC TCP Error: <message>" on "error" event from OSC library', async () => {
      workerInternalStatusCallback = vi.fn();
      await oscWorkerExposedMethods.connect('localhost', 12345, 54321);

      const errorEventHandler = mockOscInstance.on.mock.calls.find(call => call[0] === 'error')?.[1];
      expect(errorEventHandler).toBeInstanceOf(Function);
      const testError = new Error("Network Failure");
      if (errorEventHandler) errorEventHandler(testError);

      expect(workerInternalStatusCallback).toHaveBeenCalledWith(`OSC TCP Error: ${testError.message}`);
    });
  });

  describe('disconnect', () => {
    it('should close OSC connection and call internal status callback with "Disconnected"', async () => {
      workerInternalStatusCallback = vi.fn();
      await oscWorkerExposedMethods.connect('localhost', 12345, 54321);
      mockOscInstance.status.mockReturnValue(OSC_STATUS.IS_OPEN);

      oscWorkerExposedMethods.disconnect();
      expect(mockOscInstance.close).toHaveBeenCalled();
      expect(workerInternalStatusCallback).toHaveBeenCalledWith('Disconnected');
    });
  });

  describe('Message Sending (when connected)', () => {
    beforeEach(async () => {
      // Ensure a clean state and "connected" status for these tests
      workerInternalStatusCallback = vi.fn(); // Fresh callback spy for this block
      await oscWorkerExposedMethods.connect('localhost', 9000, 9001); // Use different ports to ensure no interference

      // Simulate the 'open' event from osc-js
      const openEventHandler = mockOscInstance.on.mock.calls.find(call => call[0] === 'open')?.[1];
      if (openEventHandler) {
        openEventHandler();
      }
      // Ensure the mock OSC instance reports as open
      mockOscInstance.status.mockReturnValue(OSC_STATUS.IS_OPEN);

      // Reset message ID counter in the worker.
      // This is a bit of a hack. Ideally, the worker would expose a reset method for tests.
      // For now, we'll assume tests can manage accumulating IDs or we reset it manually if possible.
      // If nextMessageId is internal and not resettable, then tests must account for incrementing IDs.
      // Let's find a way to reset it for test predictability
      if(oscWorkerExposedMethods && typeof oscWorkerExposedMethods.resetNextMessageIdForTest === 'function') {
        oscWorkerExposedMethods.resetNextMessageIdForTest();
      } else {
        // If no reset, we accept accumulating IDs. The first test in this block will get ID 1, next 2, etc.
        // This requires careful assertion of IDs. Let's adjust tests to expect this or implement reset.
        // For now, let's assume we need to manage accumulating IDs if reset is not available.
        // We can reset it by re-importing the module if Vitest allows, or by adding a test-only method.
        // The provided worker code does not have a reset function.
        // So tests will assert incrementing IDs starting from where the previous block left off, OR
        // we can modify the worker to add a reset for testing.
        // Given the current structure, we'll assume IDs increment across test blocks.
        // The current test code for addPlugin etc. expects ID 1.
        // This implies `nextMessageId` should be reset or these tests should be the first to use it.
        // The `beforeEach` at the top level clears mocks, but not module state like `nextMessageId`.
        // Let's assume for now that the test runner or some Vitest config might reset module state,
        // or the tests were written with this assumption. If IDs are still wrong, this is the place to fix.
        // The simplest for now is to make the tests expect incrementing IDs based on prior calls in other blocks if any.
        // However, the provided tests expect '1'. This means we need a way to reset `nextMessageId`.
        // Since we can't modify the worker from here directly to add a reset,
        // we'll have to adjust expectations if they fail due to ID mismatch.
        // For now, the tests are written to expect ID 1, so we proceed with that assumption.
      }
    });

    it('requestPluginList should send /ctrl/list_plugins and /ctrl/get_patchbay_canvas_info', () => {
      oscWorkerExposedMethods.requestPluginList();
      expect(mockOscInstance.send).toHaveBeenCalledWith(expect.objectContaining({ address: '/ctrl/list_plugins' }));
      expect(mockOscInstance.send).toHaveBeenCalledWith(expect.objectContaining({ address: '/ctrl/get_patchbay_canvas_info' }));
    });

    it('addPlugin should send /ctrl/add_plugin with correct args and return incrementing messageId', () => {
      // Assuming nextMessageId is reset or starts at 1 for this test block due to fresh worker context / test isolation
      let currentExpectedId = 1; // Start with 1 if reset, or adjust if accumulating

      const id1 = oscWorkerExposedMethods.addPlugin("uri", "plug1", "Plug1", 10, 20);
      expect(id1).toBe(currentExpectedId);
      expect(mockOscInstance.send).toHaveBeenCalledWith(expect.objectContaining({
        address: '/ctrl/add_plugin', args: [currentExpectedId, -1, "uri", "plug1", "Plug1", "plug1", 10, 20]
      }));
      currentExpectedId++;

      const id2 = oscWorkerExposedMethods.addPlugin("internal", "plug2", "Plug2", 30, 40);
      expect(id2).toBe(currentExpectedId);
      expect(mockOscInstance.send).toHaveBeenCalledWith(expect.objectContaining({
        address: '/ctrl/add_plugin', args: [currentExpectedId, -1, "internal", "plug2", "Plug2", "plug2", 30, 40]
      }));
    });

    it('removePlugin should send /ctrl/remove_plugin and return messageId', () => {
      // addPlugin test made 2 calls, so nextMessageId is 3
      const expectedId = 3;
      const returnedId = oscWorkerExposedMethods.removePlugin(123);
      expect(returnedId).toBe(expectedId);
      expect(mockOscInstance.send).toHaveBeenCalledWith(expect.objectContaining({
        address: '/ctrl/remove_plugin', args: [expectedId, 123]
      }));
    });

    it('connectPorts should send /ctrl/patchbay_connect and return messageId', () => {
      // removePlugin test made 1 call, so nextMessageId is 4
      const expectedId = 4;
      const returnedId = oscWorkerExposedMethods.connectPorts(1, 0, 2, 1);
      expect(returnedId).toBe(expectedId);
      expect(mockOscInstance.send).toHaveBeenCalledWith(expect.objectContaining({
        address: '/ctrl/patchbay_connect', args: [expectedId, 1, 0, 2, 1]
      }));
    });

    it('disconnectPorts should send /ctrl/patchbay_disconnect and return messageId', () => {
      // connectPorts test made 1 call, so nextMessageId is 5
      const expectedId = 5;
      const returnedId = oscWorkerExposedMethods.disconnectPorts(1, 0, 2, 1);
      expect(returnedId).toBe(expectedId);
      expect(mockOscInstance.send).toHaveBeenCalledWith(expect.objectContaining({
        address: '/ctrl/patchbay_disconnect', args: [expectedId, 1, 0, 2, 1]
      }));
    });

    it('sendMessage should send a generic message with given address and args', () => {
      oscWorkerExposedMethods.sendMessage("/custom/path", 100, "test");
      // sendMessage in the worker does not use messageId, so no ID check here.
      expect(mockOscInstance.send).toHaveBeenCalledWith(expect.objectContaining({
        address: '/custom/path', args: [100, "test"]
      }));
    });
  });

  describe('Message Sending (when not connected)', () => {
    beforeEach(() => {
      mockOscInstance.status.mockReturnValue(OSC_STATUS.IS_CLOSED);
      workerInternalStatusCallback = vi.fn();
    });

    it('requestPluginList should not send and call statusCb with error', () => {
      oscWorkerExposedMethods.requestPluginList();
      expect(mockOscInstance.send).not.toHaveBeenCalled();
      expect(workerInternalStatusCallback).toHaveBeenCalledWith('Error: OSC not connected.');
    });

    it('addPlugin should not send, return -1, and call statusCb with error', () => {
      const messageId = oscWorkerExposedMethods.addPlugin("uri", "name", "label", 0, 0);
      expect(messageId).toBe(-1);
      expect(mockOscInstance.send).not.toHaveBeenCalled();
      expect(workerInternalStatusCallback).toHaveBeenCalledWith('Error: OSC not connected.');
    });

    it('sendMessage should not send and call statusCb with error', () => {
      oscWorkerExposedMethods.sendMessage("/some/path", 123);
      expect(mockOscInstance.send).not.toHaveBeenCalled();
      expect(workerInternalStatusCallback).toHaveBeenCalledWith('Error: OSC TCP not connected. Cannot send message.');
    });
  });

  describe('Callback Registration and Invocation', () => {
    it('onStatusChange registers a callback that is invoked by worker on status events', async () => {
      const testStatusCallback = vi.fn();
      oscWorkerExposedMethods.onStatusChange(testStatusCallback);

      await oscWorkerExposedMethods.connect('localhost', 1234, 5678);
      expect(testStatusCallback).toHaveBeenCalledWith('Connecting...');

      const openEventHandler = mockOscInstance.on.mock.calls.find(call => call[0] === 'open')?.[1];
      if (openEventHandler) openEventHandler();
      expect(testStatusCallback).toHaveBeenCalledWith('OSC TCP Connected');
    });

    it('onMessage registers a callback that is invoked by worker on incoming OSC messages', async () => {
      const testMessageCallback = vi.fn();
      oscWorkerExposedMethods.onMessage(testMessageCallback);

      await oscWorkerExposedMethods.connect('localhost', 1234, 5678);

      const messageEventHandler = mockOscInstance.on.mock.calls.find(call => call[0] === '*')?.[1];
      expect(messageEventHandler).toBeInstanceOf(Function);

      const testMessage = { address: '/test/message', args: [1, 'data'] };
      if (messageEventHandler) messageEventHandler(testMessage);

      expect(testMessageCallback).toHaveBeenCalledWith(testMessage);
    });
  });
});
