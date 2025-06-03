export enum PortType {
  Audio = "audio",
  Midi = "midi",
  Cv = "cv",
}

export enum PortDirection {
  Input = "input",
  Output = "output",
}

export interface Port {
  id: string; // Typically composed of patchId and port index/name
  name: string;
  type: PortType;
  direction: PortDirection;
  patchId: string; // To identify which patch this port belongs to
}

export interface Patch {
  id: string; // Unique identifier for the patch
  name: string;
  label?: string; // Optional display label
  type: string; // e.g., 'LV2', 'Internal', etc.
  category?: string; // e.g., 'Synth', 'Effect'
  ports: Port[];
  position?: { x: number; y: number }; // For @xyflow/react
  data?: any; // For additional custom data for @xyflow/react
}

export interface Connection {
  id: string; // Unique ID for the connection (e.g., sourcePatchId-sourcePinId_targetPatchId-targetPinId)
  source: string; // ID of the source patch node
  sourceHandle: string; // ID of the source port (handle)
  target: string; // ID of the target patch node
  targetHandle: string; // ID of the target port (handle)
  animated?: boolean; // For styling in @xyflow/react
}

// A more specific OSC message structure might be needed depending on Carla's OSC API
export interface OscMessage {
  address: string;
  args: Array<{ type: string; value: any }>; // OSC arguments with type tags
}

// Specific message types for Carla interactions (examples)
export interface ListPluginsMessage extends OscMessage {
  address: "/carla/list_plugins"; // Example address
}

export interface AddPluginMessage extends OscMessage {
  address: "/carla/add_plugin";
  args: [
    { type: "s"; value: string }, // Plugin URI/name
    { type: "s"; value: string }, // Plugin label (optional)
    { type: "i"; value: number }, // X position
    { type: "i"; value: number }  // Y position
  ];
}

export interface RemovePluginMessage extends OscMessage {
  address: "/carla/remove_plugin";
  args: [{ type: "i"; value: number }]; // Plugin ID
}

export interface ConnectPortsMessage extends OscMessage {
  address: "/carla/connect_ports";
  args: [
    { type: "i"; value: number }, // Source plugin ID
    { type: "i"; value: number }, // Source port index
    { type: "i"; value: number }, // Target plugin ID
    { type: "i"; value: number }  // Target port index
  ];
}

export interface DisconnectPortsMessage extends OscMessage {
  address: "/carla/disconnect_ports";
  args: [
    { type: "i"; value: number }, // Source plugin ID
    { type: "i"; value: number }, // Source port index
    { type: "i"; value: number }, // Target plugin ID
    { type: "i"; value: number }  // Target port index
  ];
}

// Types for Tanstack Query functions and state
export interface PatchbayState {
  patches: Patch[];
  connections: Connection[];
}
