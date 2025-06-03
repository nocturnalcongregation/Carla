import React, { useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  NodeTypes,
  Position,
  MarkerType,
  OnNodesDelete,
  OnEdgesDelete,
  Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css'; // Default React Flow styles

import { usePatchbay } from '../hooks/usePatchbay';
import type { Patch, Connection as PatchbayConnection, Port, PortType } from '../types';
import { PortDirection } from '../types'; // Ensure PortDirection is imported

// Define Tailwind CSS background color classes for different port types
const PORT_TYPE_BG_COLORS: Record<PortType, string> = {
  [PortType.Audio]: 'bg-red-500',
  [PortType.Midi]: 'bg-blue-500',
  [PortType.Cv]: 'bg-green-500',
};

// Custom Node with Tailwind CSS and Handles
const PatchNode: React.FC<{ data: Patch, selected?: boolean }> = ({ data, selected }) => {
  const nodeClasses = `
    border-2 ${selected ? 'border-blue-600 shadow-lg' : 'border-gray-400 shadow-md'}
    p-3 rounded-lg bg-white bg-opacity-90
    w-auto min-w-[200px] max-w-[400px] text-xs
  `;

  const headerClasses = "font-bold text-sm mb-3 text-center text-gray-800 border-b border-gray-200 pb-2";
  const portsContainerClasses = "flex justify-between";
  const portColumnClasses = "flex flex-col";
  const portItemClasses = "relative p-1 flex items-center min-h-[26px]"; // Added min-h for alignment
  const portNameClasses = "mx-1.5 whitespace-nowrap overflow-hidden overflow-ellipsis";

  const getHandleClasses = (portType: PortType): string => {
    return `w-3 h-3 rounded-full border border-gray-700 ${PORT_TYPE_BG_COLORS[portType] || 'bg-gray-300'}`;
  };

  return (
    <div className={nodeClasses}>
      <div className={headerClasses}>{data.label || data.name}</div>
      <div className={portsContainerClasses}>
        {/* Input Ports (Left) */}
        <div className={`${portColumnClasses} items-start`}>
          {data.ports?.filter(p => p.direction === PortDirection.Input).map((port) => (
            <div key={port.id} className={portItemClasses}>
              <Handle
                type="target"
                position={Position.Left}
                id={port.id}
                className={getHandleClasses(port.type)}
                isConnectable={true}
              />
              <span className={portNameClasses} title={port.name}>{port.name}</span>
            </div>
          ))}
        </div>

        {/* Output Ports (Right) */}
        <div className={`${portColumnClasses} items-end`}>
          {data.ports?.filter(p => p.direction === PortDirection.Output).map((port) => (
            <div key={port.id} className={portItemClasses}>
              <span className={portNameClasses} title={port.name}>{port.name}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                className={getHandleClasses(port.type)}
                isConnectable={true}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const nodeTypes: NodeTypes = {
  carlaPatch: PatchNode,
};

const PatchbayDisplay: React.FC = () => {
  const {
    isConnected,
    connect: connectOsc,
    disconnect: disconnectOsc,
    patches,
    connections,
    isLoading,
    addPlugin,
    removePlugin,
    connectPorts,
    disconnectPorts,
  } = usePatchbay();

  const [host, setHost] = useState('localhost');
  const [tcpPort, setTcpPort] = useState(19997);
  const [udpPort, setUdpPort] = useState(19998); // Kept for consistency, though not actively used for connection

  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);

  useEffect(() => {
    setRfNodes(
      patches.map((patch: Patch): Node => ({
        id: patch.id,
        type: 'carlaPatch',
        position: patch.position || { x: Math.random() * 400, y: Math.random() * 400 },
        data: patch,
        // sourcePosition and targetPosition are not needed on the Node object
        // when <Handle> components are used inside custom nodes and specify their position.
      }))
    );
  }, [patches]);

  useEffect(() => {
    setRfEdges(
      connections.map((conn: PatchbayConnection): Edge => {
        // Determine edge color based on source port type
        const sourceNode = patches.find(p => p.id === conn.source);
        const sourcePort = sourceNode?.ports.find(p => p.id === conn.sourceHandle);
        let strokeColor = '#b1b1b7'; // Default Tailwind gray-400
        if (sourcePort) {
          if (sourcePort.type === PortType.Audio) strokeColor = '#F87171'; // Tailwind red-400
          else if (sourcePort.type === PortType.Midi) strokeColor = '#60A5FA'; // Tailwind blue-400
          else if (sourcePort.type === PortType.Cv) strokeColor = '#4ADE80'; // Tailwind green-400
        }

        return {
          id: conn.id,
          source: conn.source,
          sourceHandle: conn.sourceHandle,
          target: conn.target,
          targetHandle: conn.targetHandle,
          animated: conn.animated ?? true,
          markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor },
          style: { stroke: strokeColor, strokeWidth: 2 },
        };
      })
    );
  }, [connections, patches]); // Add patches dependency for sourcePort lookup

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setRfNodes((nds) => applyNodeChanges(changes, nds)),
    [setRfNodes]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setRfEdges((eds) => applyEdgeChanges(changes, eds)),
    [setRfEdges]
  );

  const onConnect: OnConnect = useCallback(
    async (params) => {
      if (params.source && params.target && params.sourceHandle && params.targetHandle) {
        try {
          await connectPorts({
            sourcePatchId: params.source,
            sourcePortId: params.sourceHandle,
            targetPatchId: params.target,
            targetPortId: params.targetHandle,
          });
        } catch (error) {
          console.error("Failed to connect ports:", error);
          // Consider adding user feedback (e.g., toast notification)
        }
      }
    },
    [connectPorts]
  );

  const onNodesDelete: OnNodesDelete = useCallback(
    async (deletedNodes) => {
      for (const node of deletedNodes) {
        try {
          await removePlugin(node.id);
        } catch (error) {
          console.error(`Failed to remove plugin ${node.id}:`, error);
        }
      }
    },
    [removePlugin]
  );

  const onEdgesDelete: OnEdgesDelete = useCallback(
    async (deletedEdges) => {
      for (const edge of deletedEdges) {
        const connectionToDelete = connections.find(c => c.id === edge.id);
        if (connectionToDelete) {
          try {
            await disconnectPorts({ connection: connectionToDelete });
          } catch (error) {
            console.error(`Failed to disconnect edge ${edge.id}:`, error);
          }
        } else {
          console.warn(`Could not find connection data for edge ID ${edge.id} to delete.`);
        }
      }
    },
    [disconnectPorts, connections]
  );

  const handleConnect = () => {
    connectOsc(host, tcpPort, udpPort);
  };

  const handleAddDummyPlugin = async () => {
    try {
      await addPlugin({ type: "internal", name: "AudioFile", label: "Audio Player", x: Math.random() * 200 + 50, y: Math.random() * 200 + 50 });
    } catch (error) {
      console.error("Failed to add dummy plugin:", error);
    }
  };

  if (isLoading && !patches.length && !connections.length && !isConnected) {
    return <div className="p-4 text-center">Connecting to Carla or loading patchbay...</div>;
  }

  return (
    <div className="h-screen w-full flex flex-col bg-gray-50">
      <div className="p-3 border-b border-gray-300 bg-gray-100 shadow">
        <h3 className="text-lg font-semibold text-gray-700">Carla Patchbay Control (React PWA)</h3>
        {!isConnected ? (
          <div className="mt-2 flex items-center space-x-2">
            <input className="px-2 py-1 border border-gray-300 rounded-md text-sm" type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host" />
            <input className="px-2 py-1 border border-gray-300 rounded-md text-sm w-24" type="number" value={tcpPort} onChange={(e) => setTcpPort(Number(e.target.value))} placeholder="TCP Port" />
            <button className="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 text-sm" onClick={handleConnect}>Connect</button>
            <p className="text-sm text-gray-500">Status: Disconnected</p>
          </div>
        ) : (
          <div className="mt-2 flex items-center space-x-2">
            <p className="text-sm text-green-600">Status: Connected to {host}:{tcpPort}</p>
            <button className="px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 text-sm" onClick={disconnectOsc}>Disconnect</button>
            <button className="px-3 py-1 bg-green-500 text-white rounded-md hover:bg-green-600 text-sm" onClick={handleAddDummyPlugin}>Add Dummy Plugin</button>
          </div>
        )}
      </div>

      <div className="flex-grow">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="top-left"
          deleteKeyCode={['Backspace', 'Delete']}
          className="bg-gray-200" // Example background for ReactFlow pane
        >
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
          <Controls />
          <Background color="#aaa" gap={16} />
        </ReactFlow>
      </div>
    </div>
  );
};

export default PatchbayDisplay;
