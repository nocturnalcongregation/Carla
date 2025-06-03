import OSC from 'osc-js';
import { expose } from 'comlink';

// Global worker state variables
let oscOverTCP: OSC | null = null;
let oscOverUDP: OSC | null = null; // Placeholder for UDP-like communication, not actively used beyond conceptual
let statusCallback: ((status: string) => void) | null = null;
let messageCallback: ((message: OSC.Message) => void) | null = null;
let nextMessageId = 1; // For tracking messages that expect a /ctrl/resp

const workerMethods = {
  connect: async (host: string, tcpPort: number, udpPort: number) => {
    console.log(`[Worker] Attempting to connect to ${host}, TCP: ${tcpPort}, UDP (conceptual): ${udpPort}`);
    statusCallback?.('Connecting...');

    if (oscOverTCP) {
      oscOverTCP.close();
      oscOverTCP = null;
    }
    // Placeholder for UDP, actual implementation will depend on server capabilities for WebSocket
    if (oscOverUDP) {
      oscOverUDP.close(); // If UDP part was ever more than conceptual
      oscOverUDP = null;
    }

    oscOverTCP = new OSC({
      plugin: new OSC.WebsocketClientPlugin({ host, port: tcpPort, secure: false })
    });

    oscOverTCP.on('open', () => {
      console.log('[Worker] OSC TCP (WebSocket) connection opened.');
      statusCallback?.('OSC TCP Connected');
      // Example registration message (adjust path and client identifier as needed by Carla)
      // oscOverTCP?.send(new OSC.Message('/register', `osc.tcp://127.0.0.1:0/CarlaCtrlPWA-${Date.now()}`));
    });

    oscOverTCP.on('close', () => {
      console.log('[Worker] OSC TCP (WebSocket) connection closed.');
      statusCallback?.('OSC TCP Disconnected');
    });

    oscOverTCP.on('error', (err: Error) => {
      console.error('[Worker] OSC TCP (WebSocket) Error:', err);
      statusCallback?.(`OSC TCP Error: ${err.message}`);
    });

    oscOverTCP.on('*', (message: OSC.Message) => {
      console.log('[Worker] OSC TCP (WebSocket) Message Received:', message.address, message.args);
      messageCallback?.(message); // Forward all messages
    });

    try {
      oscOverTCP.open(); // Asynchronous for WebSocket
    } catch (error) {
      console.error('[Worker] Failed to initiate OSC TCP (WebSocket) connection:', error);
      statusCallback?.(`OSC TCP Connection Failed: ${(error as Error).message}`);
      return;
    }

    console.log('[Worker] UDP communication is conceptual. All messages will be sent via the primary TCP/WebSocket connection.');
    statusCallback?.('UDP conceptual (using TCP WebSocket)');
  },

  sendMessage: (address: string, ...args: any[]) => {
    if (oscOverTCP && oscOverTCP.status() === OSC.STATUS.IS_OPEN) {
      console.log(`[Worker] Sending OSC (via TCP WebSocket): ${address}`, args);
      try {
        oscOverTCP.send(new OSC.Message(address, ...args));
      } catch (error) {
        console.error(`[Worker] Error sending OSC message ${address} via TCP WebSocket:`, error);
        statusCallback?.(`Error sending message: ${(error as Error).message}`);
      }
    } else {
      console.warn('[Worker] OSC TCP (WebSocket) connection not open. Message not sent:', address, args);
      statusCallback?.('Error: OSC TCP not connected. Cannot send message.');
    }
  },

  requestPluginList: () => {
    if (oscOverTCP && oscOverTCP.status() === OSC.STATUS.IS_OPEN) {
      console.log('[Worker] Requesting plugin list and patchbay info.');
      // These messages trigger streams of /ctrl/info, /ctrl/ports, etc.
      oscOverTCP.send(new OSC.Message('/ctrl/list_plugins'));
      // Also request current connections
      oscOverTCP.send(new OSC.Message('/ctrl/get_patchbay_canvas_info'));
    } else {
      console.warn('[Worker] OSC not connected. Cannot request plugin list.');
      statusCallback?.('Error: OSC not connected.');
    }
  },

  // type: e.g., "uri" for LV2, "vst3", "internal"
  // name: LV2 URI, VST3 path/id, internal plugin name
  // label: User-friendly display name
  // x, y: initial position on canvas
  // instanceId: usually -1 for new plugins
  addPlugin: (type: string, name: string, label: string, x: number, y: number, instanceId: number = -1) => {
    if (oscOverTCP && oscOverTCP.status() === OSC.STATUS.IS_OPEN) {
      const messageId = nextMessageId++;
      // Args: messageId, instanceId, type, name, label, filename (often same as name for LV2s), x, y
      oscOverTCP.send(new OSC.Message('/ctrl/add_plugin', messageId, instanceId, type, name, label, name, x, y));
      console.log(`[Worker] Sent /ctrl/add_plugin (mid: ${messageId}): ${type} - ${name}`);
      return messageId;
    }
    console.warn('[Worker] OSC not connected. Cannot add plugin.');
    statusCallback?.('Error: OSC not connected.');
    return -1;
  },

  removePlugin: (pluginId: number) => {
    if (oscOverTCP && oscOverTCP.status() === OSC.STATUS.IS_OPEN) {
      const messageId = nextMessageId++;
      oscOverTCP.send(new OSC.Message('/ctrl/remove_plugin', messageId, pluginId));
      console.log(`[Worker] Sent /ctrl/remove_plugin (mid: ${messageId}): pluginId ${pluginId}`);
      return messageId;
    }
    console.warn('[Worker] OSC not connected. Cannot remove plugin.');
    statusCallback?.('Error: OSC not connected.');
    return -1;
  },

  // port indices are typically used by Carla for connections
  connectPorts: (sourcePluginId: number, sourcePortIndex: number, targetPluginId: number, targetPortIndex: number) => {
    if (oscOverTCP && oscOverTCP.status() === OSC.STATUS.IS_OPEN) {
      const messageId = nextMessageId++;
      oscOverTCP.send(new OSC.Message('/ctrl/patchbay_connect', messageId, sourcePluginId, sourcePortIndex, targetPluginId, targetPortIndex));
      console.log(`[Worker] Sent /ctrl/patchbay_connect (mid: ${messageId}): ${sourcePluginId}:${sourcePortIndex} -> ${targetPluginId}:${targetPortIndex}`);
      return messageId;
    }
    console.warn('[Worker] OSC not connected. Cannot connect ports.');
    statusCallback?.('Error: OSC not connected.');
    return -1;
  },

  disconnectPorts: (sourcePluginId: number, sourcePortIndex: number, targetPluginId: number, targetPortIndex: number) => {
    if (oscOverTCP && oscOverTCP.status() === OSC.STATUS.IS_OPEN) {
      const messageId = nextMessageId++;
      oscOverTCP.send(new OSC.Message('/ctrl/patchbay_disconnect', messageId, sourcePluginId, sourcePortIndex, targetPluginId, targetPortIndex));
      console.log(`[Worker] Sent /ctrl/patchbay_disconnect (mid: ${messageId}): ${sourcePluginId}:${sourcePortIndex} -> ${targetPluginId}:${targetPortIndex}`);
      return messageId;
    }
    console.warn('[Worker] OSC not connected. Cannot disconnect ports.');
    statusCallback?.('Error: OSC not connected.');
    return -1;
  },

  sendDataMessage: (address: string, ...args: any[]) => {
    if (oscOverTCP && oscOverTCP.status() === OSC.STATUS.IS_OPEN) {
      console.log(`[Worker] Sending Data OSC (via TCP WebSocket): ${address}`, args);
      try {
        oscOverTCP.send(new OSC.Message(address, ...args));
      } catch (error) {
        console.error(`[Worker] Error sending Data OSC message ${address} via TCP WebSocket:`, error);
        statusCallback?.(`Error sending data message: ${(error as Error).message}`);
      }
    } else {
      console.warn('[Worker] OSC TCP (WebSocket) connection not open for data message. Message not sent:', address, args);
      statusCallback?.('Error: OSC TCP not connected. Cannot send data message.');
    }
  },

  onStatusChange: (callback: (status: string) => void) => {
    statusCallback = callback;
  },

  onMessage: (callback: (message: OSC.Message) => void) => {
    messageCallback = callback;
  },

  disconnect: () => {
    if (oscOverTCP) {
      oscOverTCP.close(); // This is asynchronous
      oscOverTCP = null;
    }
    console.log('[Worker] OSC connections commanded to close.');
    statusCallback?.('Disconnected');
  }
};

expose(workerMethods);
export type OscWorkerType = typeof workerMethods;
