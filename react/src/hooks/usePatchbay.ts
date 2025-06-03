import * as Comlink from "comlink";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useCallback, useRef, useState } from "react";
import type { OscWorkerType } from "../osc-worker"; // Path to your OSC worker
import type {
  Patch,
  Connection,
  Port,
  PatchbayState,
  PortType,
  PortDirection,
} from "../types"; // Path to your type definitions
import type OSC from "osc-js"; // For OSC.Message type

// Query keys
const PATCHBAY_QUERY_KEY: QueryKey = ["patchbay"];
const PATCHES_QUERY_KEY: QueryKey = [...PATCHBAY_QUERY_KEY, "patches"];
const CONNECTIONS_QUERY_KEY: QueryKey = [...PATCHBAY_QUERY_KEY, "connections"];

// Comlink setup for the OSC worker
// Ensure the worker path is correct relative to your project structure
const worker = new Worker(new URL("../osc-worker.ts", import.meta.url), {
  type: "module",
});
const oscWorker = Comlink.wrap<OscWorkerType>(worker);

// Helper type for OSC messages from the worker
interface ReceivedOscMessage {
  address: string;
  args: any[];
}

// Structure to hold pending mutations for /ctrl/resp handling
interface PendingMutationInfo {
  type: "addPlugin" | "removePlugin" | "connectPorts" | "disconnectPorts";
  data?: any; // Store data needed for revert or confirmation if necessary
  optimisticUpdateApplied: boolean;
}
const pendingMutations = new Map<number, PendingMutationInfo>();

export const usePatchbay = () => {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false); // Track connection status for enabling UI

  // Centralized OSC message handler
  const handleOscMessage = useCallback(
    (message: ReceivedOscMessage) => {
      console.log(
        "[usePatchbay] OSC Message Received:",
        message.address,
        message.args
      );

      // Update patches based on /ctrl/info, /ctrl/ports, etc.
      if (message.address === "/ctrl/info") {
        const [
          id,
          type,
          category,
          _hints,
          _uniqueId,
          _optsAvail,
          _optsEnabled,
          name,
          _filename,
          _iconName,
          _realName,
          label,
        ] = message.args;
        queryClient.setQueryData<Patch[]>(
          PATCHES_QUERY_KEY,
          (oldPatches = []) => {
            const existingIndex = oldPatches.findIndex(
              (p) => p.id === String(id)
            );
            const newPatchData: Partial<Patch> = {
              name,
              label: label || name,
              type,
              category,
            };
            if (existingIndex !== -1) {
              const updatedPatches = [...oldPatches];
              updatedPatches[existingIndex] = {
                ...updatedPatches[existingIndex],
                ...newPatchData,
              };
              return updatedPatches;
            }
            // Placeholder for ports, position, data - these might come from other messages or need defaults
            return [
              ...oldPatches,
              { id: String(id), ports: [], ...newPatchData } as Patch,
            ];
          }
        );
      } else if (message.address === "/ctrl/ports") {
        const [
          pluginId,
          audioIns,
          audioOuts,
          midiIns,
          midiOuts,
          cvIns,
          cvOuts,
        ] = message.args;
        queryClient.setQueryData<Patch[]>(
          PATCHES_QUERY_KEY,
          (oldPatches = []) => {
            const patchIndex = oldPatches.findIndex(
              (p) => p.id === String(pluginId)
            );
            if (patchIndex === -1) return oldPatches;

            const newPorts: Port[] = [];
            // Helper to create ports
            const createPorts = (
              count: number,
              type: PortType,
              direction: PortDirection,
              offset: number
            ) => {
              for (let i = 0; i < count; i++) {
                newPorts.push({
                  id: `${pluginId}-${
                    direction === PortDirection.Input ? "in" : "out"
                  }-${type}-${i + offset}`,
                  name: `${type.toUpperCase()} ${
                    direction === PortDirection.Input ? "In" : "Out"
                  } ${i + 1 + offset}`,
                  type,
                  direction,
                  patchId: String(pluginId),
                });
              }
            };

            let portIdxOffset = 0;
            createPorts(
              audioIns,
              PortType.Audio,
              PortDirection.Input,
              portIdxOffset
            );
            portIdxOffset += audioIns;
            createPorts(cvIns, PortType.Cv, PortDirection.Input, portIdxOffset);
            portIdxOffset += cvIns;
            createPorts(
              midiIns,
              PortType.Midi,
              PortDirection.Input,
              portIdxOffset
            );
            portIdxOffset += midiIns;

            portIdxOffset = 0; // Reset for outputs
            createPorts(
              audioOuts,
              PortType.Audio,
              PortDirection.Output,
              portIdxOffset
            );
            portIdxOffset += audioOuts;
            createPorts(
              cvOuts,
              PortType.Cv,
              PortDirection.Output,
              portIdxOffset
            );
            portIdxOffset += cvOuts;
            createPorts(
              midiOuts,
              PortType.Midi,
              PortDirection.Output,
              portIdxOffset
            );

            const updatedPatches = [...oldPatches];
            updatedPatches[patchIndex] = {
              ...updatedPatches[patchIndex],
              ports: newPorts,
            };
            return updatedPatches;
          }
        );
      } else if (message.address === "/ctrl/cb") {
        // Callback messages
        const [action, value1, value2, value3, _valueFloat, valueStr] =
          message.args;
        // Action 0: PLUGIN_ADD (handled by /ctrl/info + /ctrl/ports mostly)
        // Action 1: PLUGIN_MOVE (update patch position)
        if (action === 1 /* PLUGIN_MOVE */) {
          const patchId = String(value1);
          const x = value2;
          const y = value3;
          queryClient.setQueryData<Patch[]>(
            PATCHES_QUERY_KEY,
            (oldPatches = []) =>
              oldPatches.map((p) =>
                p.id === patchId ? { ...p, position: { x, y } } : p
              )
          );
        }
        // Action 2: PLUGIN_REMOVE
        else if (action === 2 /* PLUGIN_REMOVE */) {
          const removedPatchId = String(value1);
          queryClient.setQueryData<Patch[]>(
            PATCHES_QUERY_KEY,
            (oldPatches = []) =>
              oldPatches.filter((p) => p.id !== removedPatchId)
          );
          // Also remove associated connections
          queryClient.setQueryData<Connection[]>(
            CONNECTIONS_QUERY_KEY,
            (oldConnections = []) =>
              oldConnections.filter(
                (c) =>
                  c.source !== removedPatchId && c.target !== removedPatchId
              )
          );
        }
        // Action 3: PORTS_CONNECT
        else if (action === 3 /* PORTS_CONNECT */) {
          // Expected format for valueStr from Carla: "sourcePatchId:sourcePortIdx>targetPatchId:targetPortIdx"
          // Or sometimes it's just the numeric IDs: srcPlugId, srcPortId, dstPlugId, dstPortId
          // The /ctrl/get_patchbay_canvas_info sends: /ctrl/patchbay_info, client_id, src_id, src_port, dst_id, dst_port
          // Let's assume valueStr is the primary ID for now if present and unique.
          // If not, we might need to construct one.
          const connId =
            valueStr || `${value1}-${value2}_${value3}-${message.args[3]}`; // args[3] is dst_port_idx
          const sourcePatchId = String(value1);
          const sourcePortIndex = value2; // This is an index
          const targetPatchId = String(value3);
          const targetPortIndex = message.args[3]; // dst_port_idx

          queryClient.setQueryData<Connection[]>(
            CONNECTIONS_QUERY_KEY,
            (oldConnections = []) => {
              if (oldConnections.find((c) => c.id === connId))
                return oldConnections; // Already exists
              // We need to map indices to actual port IDs (handles)
              const patches =
                queryClient.getQueryData<Patch[]>(PATCHES_QUERY_KEY) || [];
              const sourcePatch = patches.find((p) => p.id === sourcePatchId);
              const targetPatch = patches.find((p) => p.id === targetPatchId);

              const sourcePort = sourcePatch?.ports.filter(
                (p) => p.direction === PortDirection.Output
              )[sourcePortIndex];
              const targetPort = targetPatch?.ports.filter(
                (p) => p.direction === PortDirection.Input
              )[targetPortIndex];

              if (sourcePort && targetPort) {
                return [
                  ...oldConnections,
                  {
                    id: connId,
                    source: sourcePatchId,
                    sourceHandle: sourcePort.id,
                    target: targetPatchId,
                    targetHandle: targetPort.id,
                    animated: true,
                  },
                ];
              }
              console.warn(
                `[usePatchbay] Could not find ports for connection: ${connId}`
              );
              return oldConnections;
            }
          );
        }
        // Action 4: PORTS_DISCONNECT
        else if (action === 4 /* PORTS_DISCONNECT */) {
          // Similar to connect, valueStr might be the ID, or we use components
          const connId =
            valueStr || `${value1}-${value2}_${value3}-${message.args[3]}`;
          queryClient.setQueryData<Connection[]>(
            CONNECTIONS_QUERY_KEY,
            (oldConnections = []) =>
              oldConnections.filter((c) => c.id !== connId)
          );
        }
      } else if (message.address === "/ctrl/patchbay_info") {
        // From /ctrl/get_patchbay_canvas_info
        // /ctrl/patchbay_info, client_id, src_id, src_port_idx, dst_id, dst_port_idx
        const [
          _clientId,
          sourcePluginId,
          sourcePortIndex,
          targetPluginId,
          targetPortIndex,
        ] = message.args;
        const connId = `${sourcePluginId}-${sourcePortIndex}_${targetPluginId}-${targetPortIndex}`;

        queryClient.setQueryData<Connection[]>(
          CONNECTIONS_QUERY_KEY,
          (oldConnections = []) => {
            if (oldConnections.find((c) => c.id === connId))
              return oldConnections;

            const patches =
              queryClient.getQueryData<Patch[]>(PATCHES_QUERY_KEY) || [];
            const sourcePatch = patches.find(
              (p) => p.id === String(sourcePluginId)
            );
            const targetPatch = patches.find(
              (p) => p.id === String(targetPluginId)
            );

            // Find the actual port objects based on index (assuming order)
            const sourcePort = sourcePatch?.ports.filter(
              (p) => p.direction === PortDirection.Output
            )[sourcePortIndex];
            const targetPort = targetPatch?.ports.filter(
              (p) => p.direction === PortDirection.Input
            )[targetPortIndex];

            if (sourcePort && targetPort) {
              return [
                ...oldConnections,
                {
                  id: connId,
                  source: String(sourcePluginId),
                  sourceHandle: sourcePort.id,
                  target: String(targetPluginId),
                  targetHandle: targetPort.id,
                  animated: true,
                },
              ];
            }
            console.warn(
              `[usePatchbay] Could not find ports for /ctrl/patchbay_info connection: ${connId}`
            );
            return oldConnections;
          }
        );
      } else if (message.address === "/ctrl/resp") {
        const [messageId, errorStr] = message.args;
        const mutationInfo = pendingMutations.get(messageId);
        if (mutationInfo) {
          if (errorStr && errorStr.length > 0) {
            console.error(
              `[usePatchbay] Mutation (id: ${messageId}, type: ${mutationInfo.type}) failed: ${errorStr}`
            );
            // Basic revert: invalidate queries to refetch from authoritative source
            // More sophisticated revert would use mutationInfo.data
            if (mutationInfo.optimisticUpdateApplied) {
              queryClient.invalidateQueries({ queryKey: PATCHES_QUERY_KEY });
              queryClient.invalidateQueries({
                queryKey: CONNECTIONS_QUERY_KEY,
              });
            }
          } else {
            console.log(
              `[usePatchbay] Mutation (id: ${messageId}, type: ${mutationInfo.type}) successful.`
            );
            // Optimistic update is now confirmed. No specific action needed unless confirmation changes things.
          }
          pendingMutations.delete(messageId);
        } else {
          console.warn(
            `[usePatchbay] Received /ctrl/resp for unknown messageId: ${messageId}`
          );
        }
      }
      // Add more handlers for other relevant OSC messages (/ctrl/param, /ctrl/pgm, etc. if needed for patchbay)
    },
    [queryClient]
  );

  // Effect to subscribe to OSC messages and status changes from the worker
  useEffect(() => {
    const statusUnsub = oscWorker.onStatusChange(
      Comlink.proxy((status: string) => {
        console.log("[usePatchbay] OSC Connection Status:", status);
        setIsConnected(status.toLowerCase().includes("connected"));
        if (status.toLowerCase().includes("connected")) {
          // Initial data fetch once connected
          oscWorker.requestPluginList();
        }
      })
    );
    // Type assertion for OSC.Message because Comlink might not pass it with full type info
    const messageUnsub = oscWorker.onMessage(
      Comlink.proxy(handleOscMessage as (msg: OSC.Message) => void)
    );

    return () => {
      // Clean up Comlink proxies if possible or needed.
      // For simple proxies like functions, direct cleanup might not be exposed by Comlink.
      // Ensure worker itself is terminated if the hook unmounts and is no longer needed application-wide.
    };
  }, [handleOscMessage]);

  // Query for all patches
  const { data: patches = [], isLoading: isLoadingPatches } = useQuery<Patch[]>(
    {
      queryKey: PATCHES_QUERY_KEY,
      queryFn: async () => {
        // Initial fetch is triggered by connection status, direct queryFn might not be needed if cache is populated by OSC messages
        // However, could be used for a manual refresh.
        // oscWorker.requestPluginList(); // This sends OSC, doesn't return data directly
        return queryClient.getQueryData<Patch[]>(PATCHES_QUERY_KEY) || []; // Return current cache or empty
      },
      initialData: [],
      staleTime: Infinity, // Data is primarily updated via WebSocket pushes
    }
  );

  // Query for all connections
  const { data: connections = [], isLoading: isLoadingConnections } = useQuery<
    Connection[]
  >({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: async () => {
      // oscWorker.requestPluginList(); // Also triggers patchbay_info
      return (
        queryClient.getQueryData<Connection[]>(CONNECTIONS_QUERY_KEY) || []
      );
    },
    initialData: [],
    staleTime: Infinity,
  });

  // --- MUTATIONS ---

  const addPluginMutation = useMutation({
    mutationFn: async (variables: {
      type: string;
      name: string;
      label: string;
      x?: number;
      y?: number;
    }) => {
      const { type, name, label, x = 50, y = 50 } = variables;
      const messageId = await oscWorker.addPlugin(type, name, label, x, y);
      if (messageId === -1)
        throw new Error("OSC worker not connected or failed to send message.");
      pendingMutations.set(messageId, {
        type: "addPlugin",
        optimisticUpdateApplied: false,
      }); // No easy optimistic update for new plugin ID
      return { messageId };
    },
    onSuccess: (_data, variables) => {
      console.log("Add plugin mutation sent for:", variables.name);
      // Actual addition to query cache will be handled by /ctrl/info and /ctrl/ports messages
    },
    onError: (error, variables) => {
      console.error("Error adding plugin:", variables.name, error);
      // Revert optimistic update if one was made (though it's hard for addPlugin without knowing ID)
    },
  });

  const removePluginMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      const messageId = await oscWorker.removePlugin(parseInt(pluginId, 10));
      if (messageId === -1)
        throw new Error("OSC worker not connected or failed to send message.");

      // Optimistic update
      const previousPatches =
        queryClient.getQueryData<Patch[]>(PATCHES_QUERY_KEY) || [];
      const previousConnections =
        queryClient.getQueryData<Connection[]>(CONNECTIONS_QUERY_KEY) || [];
      queryClient.setQueryData<Patch[]>(
        PATCHES_QUERY_KEY,
        (old) => old?.filter((p) => p.id !== pluginId) || []
      );
      queryClient.setQueryData<Connection[]>(
        CONNECTIONS_QUERY_KEY,
        (old) =>
          old?.filter((c) => c.source !== pluginId && c.target !== pluginId) ||
          []
      );

      pendingMutations.set(messageId, {
        type: "removePlugin",
        data: { previousPatches, previousConnections },
        optimisticUpdateApplied: true,
      });
      return { messageId, pluginId };
    },
    onSuccess: (_data, pluginId) => {
      console.log("Remove plugin mutation sent for:", pluginId);
      // Optimistic update confirmed by /ctrl/cb action 2
    },
    onError: (error, pluginId, context) => {
      console.error("Error removing plugin:", pluginId, error);
      const mutationInfo = pendingMutations.get(context?.messageId as number);
      if (mutationInfo?.optimisticUpdateApplied && mutationInfo.data) {
        queryClient.setQueryData<Patch[]>(
          PATCHES_QUERY_KEY,
          mutationInfo.data.previousPatches
        );
        queryClient.setQueryData<Connection[]>(
          CONNECTIONS_QUERY_KEY,
          mutationInfo.data.previousConnections
        );
      }
    },
  });

  const connectPortsMutation = useMutation({
    mutationFn: async (variables: {
      sourcePatchId: string;
      sourcePortId: string;
      targetPatchId: string;
      targetPortId: string;
    }) => {
      const { sourcePatchId, sourcePortId, targetPatchId, targetPortId } =
        variables;
      // We need to convert port IDs (handles) back to indices for Carla if worker expects indices
      const patchesData =
        queryClient.getQueryData<Patch[]>(PATCHES_QUERY_KEY) || [];
      const sourcePatch = patchesData.find((p) => p.id === sourcePatchId);
      const targetPatch = patchesData.find((p) => p.id === targetPatchId);

      const sourcePortIndex = sourcePatch?.ports
        .filter((p) => p.direction === PortDirection.Output)
        .findIndex((p) => p.id === sourcePortId);
      const targetPortIndex = targetPatch?.ports
        .filter((p) => p.direction === PortDirection.Input)
        .findIndex((p) => p.id === targetPortId);

      if (
        sourcePortIndex === undefined ||
        sourcePortIndex === -1 ||
        targetPortIndex === undefined ||
        targetPortIndex === -1
      ) {
        throw new Error(
          "Could not find one or both ports by ID to determine index."
        );
      }

      const messageId = await oscWorker.connectPorts(
        parseInt(sourcePatchId, 10),
        sourcePortIndex,
        parseInt(targetPatchId, 10),
        targetPortIndex
      );
      if (messageId === -1)
        throw new Error("OSC worker not connected or failed to send message.");

      // Optimistic update
      const newConnectionId = `${sourcePatchId}-${sourcePortIndex}_${targetPatchId}-${targetPortIndex}`; // This might differ from Carla's eventual ID
      const newConnection: Connection = {
        id: newConnectionId, // Optimistic ID
        source: sourcePatchId,
        sourceHandle: sourcePortId,
        target: targetPatchId,
        targetHandle: targetPortId,
        animated: true,
      };
      const previousConnections =
        queryClient.getQueryData<Connection[]>(CONNECTIONS_QUERY_KEY) || [];
      queryClient.setQueryData<Connection[]>(CONNECTIONS_QUERY_KEY, (old) => [
        ...(old || []),
        newConnection,
      ]);

      pendingMutations.set(messageId, {
        type: "connectPorts",
        data: { previousConnections, newConnectionId }, // Store ID for potential revert
        optimisticUpdateApplied: true,
      });
      return { messageId };
    },
    onSuccess: () => {
      console.log("Connect ports mutation sent.");
    },
    onError: (error, _variables, context) => {
      console.error("Error connecting ports:", error);
      const mutationInfo = pendingMutations.get(context?.messageId as number);
      if (mutationInfo?.optimisticUpdateApplied && mutationInfo.data) {
        // Revert by removing the optimistically added connection
        queryClient.setQueryData<Connection[]>(
          CONNECTIONS_QUERY_KEY,
          mutationInfo.data.previousConnections.filter(
            (c: Connection) => c.id !== mutationInfo.data.newConnectionId
          )
        );
      }
    },
  });

  const disconnectPortsMutation = useMutation({
    mutationFn: async (variables: { connection: Connection }) => {
      const { connection } = variables;
      // Worker's disconnectPorts expects source/target plugin IDs and port INDICES
      const patchesData =
        queryClient.getQueryData<Patch[]>(PATCHES_QUERY_KEY) || [];
      const sourcePatch = patchesData.find((p) => p.id === connection.source);
      const targetPatch = patchesData.find((p) => p.id === connection.target);

      const sourcePortIndex = sourcePatch?.ports
        .filter((p) => p.direction === PortDirection.Output)
        .findIndex((p) => p.id === connection.sourceHandle);
      const targetPortIndex = targetPatch?.ports
        .filter((p) => p.direction === PortDirection.Input)
        .findIndex((p) => p.id === connection.targetHandle);

      if (
        sourcePortIndex === undefined ||
        sourcePortIndex === -1 ||
        targetPortIndex === undefined ||
        targetPortIndex === -1
      ) {
        throw new Error(
          "Could not find one or both ports by ID to determine index for disconnection."
        );
      }

      const messageId = await oscWorker.disconnectPorts(
        parseInt(connection.source, 10),
        sourcePortIndex,
        parseInt(connection.target, 10),
        targetPortIndex
      );
      if (messageId === -1)
        throw new Error("OSC worker not connected or failed to send message.");

      // Optimistic update
      const previousConnections =
        queryClient.getQueryData<Connection[]>(CONNECTIONS_QUERY_KEY) || [];
      queryClient.setQueryData<Connection[]>(
        CONNECTIONS_QUERY_KEY,
        (old) => old?.filter((c) => c.id !== connection.id) || []
      );

      pendingMutations.set(messageId, {
        type: "disconnectPorts",
        data: { previousConnections, removedConnectionId: connection.id },
        optimisticUpdateApplied: true,
      });
      return { messageId };
    },
    onSuccess: () => {
      console.log("Disconnect ports mutation sent.");
    },
    onError: (error, _variables, context) => {
      console.error("Error disconnecting ports:", error);
      const mutationInfo = pendingMutations.get(context?.messageId as number);
      if (mutationInfo?.optimisticUpdateApplied && mutationInfo.data) {
        // Revert by adding back the connection if it was part of previousConnections
        const previousConnection = mutationInfo.data.previousConnections.find(
          (c: Connection) => c.id === mutationInfo.data.removedConnectionId
        );
        if (previousConnection) {
          queryClient.setQueryData<Connection[]>(
            CONNECTIONS_QUERY_KEY,
            (old) => [...(old || []), previousConnection]
          );
        } else {
          // Or just set to previous state if simpler
          queryClient.setQueryData<Connection[]>(
            CONNECTIONS_QUERY_KEY,
            mutationInfo.data.previousConnections
          );
        }
      }
    },
  });

  // Exposed methods and state
  return {
    isConnected,
    connect: oscWorker.connect, // Expose worker's connect
    disconnect: oscWorker.disconnect, // Expose worker's disconnect
    patches,
    connections,
    isLoading: isLoadingPatches || isLoadingConnections,
    addPlugin: addPluginMutation.mutateAsync,
    removePlugin: removePluginMutation.mutateAsync,
    connectPorts: connectPortsMutation.mutateAsync,
    disconnectPorts: disconnectPortsMutation.mutateAsync,
  };
};
