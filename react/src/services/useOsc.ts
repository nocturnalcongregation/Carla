// react/src/services/useOsc.ts
// (Keep existing imports and setup: worker, oscWorker, QueryKeys, ReceivedOscMessage, OSC_CARLA_TARGET_NAME)
import * as Comlink from 'comlink';
import { useEffect, useState, useCallback } from 'react';
import { type OscWorkerType } from '../osc-worker';
import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { PluginInfo, PortCounts, ProgramCounts, InternalParams, PluginParameter, PatchbayConnection } from '../components/CarlaInfoDisplay';

const worker = new Worker(new URL('../osc-worker.ts', import.meta.url), { type: 'module' });
const oscWorker = Comlink.wrap<OscWorkerType>(worker);

export const QK_ENGINE_INFO: QueryKey = ['engineInfo'];
export const QK_PLUGIN_LIST: QueryKey = ['pluginList'];
export const QK_PLUGIN_PARAMETERS = (pluginId: number | string): QueryKey => ['pluginParameters', String(pluginId)];
export const QK_PATCHBAY_CONNECTIONS: QueryKey = ['patchbayConnections'];

interface ReceivedOscMessage { address: string; args: any[]; }
const OSC_CARLA_TARGET_NAME = 'Carla';


export const useOsc = () => {
  const queryClient = useQueryClient();
  const [connectionStatus, setConnectionStatus] = useState<string>('Idle');
  const [lastMessage, setLastMessage] = useState<ReceivedOscMessage | null>(null);

  const updatePluginParametersInCache = useCallback((pluginId: number, paramId: number, updates: Partial<PluginParameter>) => {
    queryClient.setQueryData<PluginParameter[]>(QK_PLUGIN_PARAMETERS(pluginId), (oldParams = []) => {
      const paramIndex = oldParams.findIndex(p => p.id === paramId);
      if (paramIndex !== -1) {
        const newParams = [...oldParams];
        newParams[paramIndex] = { ...newParams[paramIndex], ...updates };
        return newParams;
      }
      // If param doesn't exist, create it. This handles cases where paramData arrives before paramInfo.
      const newParamEntry: PluginParameter = {
        id: paramId,
        name: `Param ${paramId}`,
        value: 0, // Default value
        unit: '', comment: '', groupName: '',
        type: 0, hints:0, midiChannel: 0, mappedControlIndex: -1, mappedMinimum:0, mappedMaximum:0,
        defaultValue:0, minimum:0, maximum:1, step:0.01, stepSmall:0.01, stepLarge:0.1,
        ...updates
      };
      return [...oldParams, newParamEntry];
    });
  }, [queryClient]);

  const handleOscMessage = useCallback((msg: ReceivedOscMessage) => {
    setLastMessage(msg);

    if (msg.address === '/ctrl/info') {
      const [pluginId, type, category, hints, uniqueId, optsAvail, optsEnabled, name, filename, iconName, realName, label, maker, copyright] = msg.args;
      const newPluginData: PluginInfo = { id: pluginId, type, category, hints, uniqueId, optionsAvailable: optsAvail, optionsEnabled: optsEnabled, name, filename, iconName, realName, label, maker, copyright, ports: {} as PortCounts, programCounts: {} as ProgramCounts, internalParams: {} as InternalParams };
      queryClient.setQueryData<PluginInfo[]>(QK_PLUGIN_LIST, (oldData = []) => {
        const existingIndex = oldData.findIndex(p => p.id === pluginId);
        if (existingIndex !== -1) {
          const updatedData = [...oldData];
          updatedData[existingIndex] = { ...updatedData[existingIndex], ...newPluginData };
          return updatedData;
        }
        return [...oldData, newPluginData];
      });
    } else if (msg.address === '/ctrl/ports') {
      const [pluginId, audioIns, audioOuts, midiIns, midiOuts, cvIns, cvOuts, _paramTotal] = msg.args;
      const portData: PortCounts = { audioIns, audioOuts, midiIns, midiOuts, cvIns, cvOuts };
      queryClient.setQueryData<PluginInfo[]>(QK_PLUGIN_LIST, (oldData = []) =>
        oldData.map(p => p.id === pluginId ? { ...p, ports: portData } : p)
      );
    } else if (msg.address === '/ctrl/pcount') {
        const [pluginId, pcount, mpcount] = msg.args;
        queryClient.setQueryData<PluginInfo[]>(QK_PLUGIN_LIST, old => old?.map(p => p.id === pluginId ? {...p, programCounts: { programs: pcount, midiPrograms: mpcount }} : p) || []);
    } else if (msg.address === '/ctrl/iparams') {
        const [pluginId, active, drywet, volume, balLeft, balRight, pan, ctrlChan] = msg.args;
        queryClient.setQueryData<PluginInfo[]>(QK_PLUGIN_LIST, old => old?.map(p => p.id === pluginId ? {...p, internalParams: { active: Boolean(active), dryWet: drywet, volume, balanceLeft: balLeft, balanceRight: balRight, panning: pan, ctrlChannel: ctrlChan }} : p) || []);
    }
    else if (msg.address === '/ctrl/paramInfo') { const [pluginId, paramId, name, unit, comment, groupName] = msg.args; updatePluginParametersInCache(pluginId, paramId, { name, unit, comment, groupName }); }
    else if (msg.address === '/ctrl/paramData') { const [pluginId, paramId, type, hints, midiChannel, mappedControlIndex, mappedMinimum, mappedMaximum, value] = msg.args; updatePluginParametersInCache(pluginId, paramId, { type, hints, midiChannel, mappedControlIndex, mappedMinimum, mappedMaximum, value }); }
    else if (msg.address === '/ctrl/paramRanges') { const [pluginId, paramId, defaultValue, minimum, maximum, step, stepSmall, stepLarge] = msg.args; updatePluginParametersInCache(pluginId, paramId, { defaultValue, minimum, maximum, step, stepSmall, stepLarge }); }
    else if (msg.address === '/ctrl/param') { const [pluginId, paramId, value] = msg.args; updatePluginParametersInCache(pluginId, paramId, { value }); }
    else if (msg.address === '/ctrl/cb') {
      const [action, value1, value2, value3, _valueFloat, valueStr] = msg.args;
      if (action === 2 /* PLUGIN_REMOVE */) {
        const removedPluginId = value1;
        queryClient.setQueryData<PluginInfo[]>(QK_PLUGIN_LIST, (old = []) => old.filter(p => p.id !== removedPluginId));
        queryClient.removeQueries({ queryKey: QK_PLUGIN_PARAMETERS(removedPluginId) });
        queryClient.setQueryData<PatchbayConnection[]>(QK_PATCHBAY_CONNECTIONS, (oldConns = []) => oldConns.filter(c => c.sourcePluginId !== removedPluginId && c.targetPluginId !== removedPluginId));
      } else if (action === 3 /* PORTS_CONNECT */) {
        const connId = valueStr || `${value1}-${value2}_${value3}-${msg.args[3]}`;
        const newConn: PatchbayConnection = { id: connId, sourcePluginId: value1, sourcePortIndex: value2, targetPluginId: value3, targetPortIndex: msg.args[3] };
        queryClient.setQueryData<PatchbayConnection[]>(QK_PATCHBAY_CONNECTIONS, (old = []) => {
          if (old.find(c => c.id === connId)) return old;
          return [...old, newConn];
        });
      } else if (action === 4 /* PORTS_DISCONNECT */) {
        const connId = valueStr || `${value1}-${value2}_${value3}-${msg.args[3]}`;
        queryClient.setQueryData<PatchbayConnection[]>(QK_PATCHBAY_CONNECTIONS, (old = []) => old.filter(c => c.id !== connId));
      }
    }
    else if (msg.address === '/ctrl/resp') {
      const [messageId, errorStr] = msg.args;
      // console.log(`[useOsc] Received /ctrl/resp for messageId ${messageId}. Error: ${errorStr || 'None'}`);
    }
  }, [queryClient, updatePluginParametersInCache]);

  useEffect(() => {
    oscWorker.onStatusChange(Comlink.proxy(setConnectionStatus));
    oscWorker.onMessage(Comlink.proxy(handleOscMessage as (msg: any)=>void));
    if (connectionStatus.toLowerCase().includes('connected')) {
      queryClient.invalidateQueries({ queryKey: QK_PLUGIN_LIST });
      queryClient.invalidateQueries({ queryKey: QK_PATCHBAY_CONNECTIONS });
    }
  }, [connectionStatus, handleOscMessage, queryClient]);

  const pluginListQuery = useQuery<PluginInfo[], Error>({
    queryKey: QK_PLUGIN_LIST,
    queryFn: async () => {
      if (connectionStatus.toLowerCase().includes('connected')) { await oscWorker.requestPluginList(); }
      return queryClient.getQueryData<PluginInfo[]>(QK_PLUGIN_LIST) || [];
    },
    enabled: connectionStatus.toLowerCase().includes('connected'), staleTime: 60000, refetchOnWindowFocus: true,
  });
  const patchbayConnectionsQuery = useQuery<PatchbayConnection[], Error>({
    queryKey: QK_PATCHBAY_CONNECTIONS,
    queryFn: async () => { return queryClient.getQueryData<PatchbayConnection[]>(QK_PATCHBAY_CONNECTIONS) || []; },
    enabled: connectionStatus.toLowerCase().includes('connected'), staleTime: 60000,
  });

  interface OptimisticContext<TData = any> { previousData?: TData; messageId?: number }

  const addPluginMutation = useMutation<
    { messageId: number }, Error, { type: string; name: string; label: string; x?: number; y?: number }, OptimisticContext<PluginInfo[]>
  >({
    mutationFn: async (variables) => {
      const { type, name, label, x = Math.random()*100, y = Math.random()*100 } = variables;
      const messageId = await oscWorker.addPlugin(type, name, label, x, y);
      if (messageId === -1) throw new Error('Failed to send addPlugin message.');
      return { messageId };
    },
    onMutate: async (_newPluginVars) => {
      await queryClient.cancelQueries({ queryKey: QK_PLUGIN_LIST });
      const previousPluginList = queryClient.getQueryData<PluginInfo[]>(QK_PLUGIN_LIST) || [];
      return { previousData: previousPluginList };
    },
    onError: (_err, _newPlugin, context) => { if (context?.previousData) queryClient.setQueryData<PluginInfo[]>(QK_PLUGIN_LIST, context.previousData); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QK_PLUGIN_LIST }),
  });

  const removePluginMutation = useMutation<
    { messageId: number }, Error, { pluginId: number }, OptimisticContext<PluginInfo[]>
  >({
    mutationFn: async ({ pluginId }) => {
      const messageId = await oscWorker.removePlugin(pluginId);
      if (messageId === -1) throw new Error('Failed to send removePlugin message.');
      return { messageId };
    },
    onMutate: async ({ pluginId }) => {
      await queryClient.cancelQueries({ queryKey: QK_PLUGIN_LIST });
      const previousPluginList = queryClient.getQueryData<PluginInfo[]>(QK_PLUGIN_LIST) || [];
      queryClient.setQueryData<PluginInfo[]>(QK_PLUGIN_LIST, (old = []) => old.filter(p => p.id !== pluginId));
      queryClient.removeQueries({ queryKey: QK_PLUGIN_PARAMETERS(pluginId) });
      return { previousData: previousPluginList };
    },
    onError: (_err, _vars, context) => { if (context?.previousData) queryClient.setQueryData<PluginInfo[]>(QK_PLUGIN_LIST, context.previousData); },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: QK_PLUGIN_LIST }); queryClient.invalidateQueries({ queryKey: QK_PATCHBAY_CONNECTIONS }); },
  });

  const setParameterValueMutation = useMutation<
    { success: boolean }, Error, { pluginId: number; paramId: number; value: number }, OptimisticContext<PluginParameter[]>
  >({
    mutationFn: async ({ pluginId, paramId, value }) => {
      const oscPath = `/${OSC_CARLA_TARGET_NAME}/${pluginId}/set_parameter_value`;
      const localMessageContext = Date.now();
      oscWorker.sendMessage(oscPath, localMessageContext, paramId, value);
      return { success: true };
    },
    onMutate: async (variables) => {
      const { pluginId, paramId, value } = variables;
      const queryKey = QK_PLUGIN_PARAMETERS(pluginId);
      await queryClient.cancelQueries({ queryKey });
      const previousParams = queryClient.getQueryData<PluginParameter[]>(queryKey) || [];
      const optimisticParams = previousParams.map(p => p.id === paramId ? { ...p, value } : p );
      if (previousParams.find(p => p.id === paramId)) queryClient.setQueryData<PluginParameter[]>(queryKey, optimisticParams);
      return { previousData: previousParams };
    },
    onError: (_err, variables, context) => { if (context?.previousData) queryClient.setQueryData<PluginParameter[]>(QK_PLUGIN_PARAMETERS(variables.pluginId), context.previousData); },
    onSettled: (_data, _error, variables) => queryClient.invalidateQueries({ queryKey: QK_PLUGIN_PARAMETERS(variables.pluginId) }),
  });

  const connectPortsMutation = useMutation<
    { messageId: number }, Error, { sourcePluginId: number; sourcePortIndex: number; targetPluginId: number; targetPortIndex: number }
  >({
    mutationFn: async (vars) => {
      const messageId = await oscWorker.connectPorts(vars.sourcePluginId, vars.sourcePortIndex, vars.targetPluginId, vars.targetPortIndex);
      if (messageId === -1) throw new Error('Failed to send connectPorts message.');
      return { messageId };
    },
    onSettled: () => queryClient.invalidateQueries({queryKey: QK_PATCHBAY_CONNECTIONS})
  });

  // MODIFIED disconnectPortsMutation
  const disconnectPortsMutation = useMutation<
    { messageId: number }, Error, { connectionId: string }, OptimisticContext<PatchbayConnection[]>
  >({
    mutationFn: async ({ connectionId }) => {
      // Find the connection details from the cache
      const connections = queryClient.getQueryData<PatchbayConnection[]>(QK_PATCHBAY_CONNECTIONS) || [];
      const connToDisconnect = connections.find(c => c.id === connectionId);

      if (!connToDisconnect) {
        throw new Error(`Connection with ID ${connectionId} not found in cache.`);
      }
      // The worker's disconnectPorts expects individual IDs/indices
      const messageId = await oscWorker.disconnectPorts(
        connToDisconnect.sourcePluginId,
        connToDisconnect.sourcePortIndex,
        connToDisconnect.targetPluginId,
        connToDisconnect.targetPortIndex
      );
      if (messageId === -1) throw new Error('Failed to send disconnectPorts message.');
      return { messageId };
    },
    onMutate: async ({ connectionId }) => {
        await queryClient.cancelQueries({ queryKey: QK_PATCHBAY_CONNECTIONS });
        const previousConnections = queryClient.getQueryData<PatchbayConnection[]>(QK_PATCHBAY_CONNECTIONS) || [];
        queryClient.setQueryData<PatchbayConnection[]>(QK_PATCHBAY_CONNECTIONS, (old = []) => old.filter(c => c.id !== connectionId));
        return { previousData: previousConnections };
    },
    onError: (_err, _vars, context) => {
        if (context?.previousData) {
            queryClient.setQueryData<PatchbayConnection[]>(QK_PATCHBAY_CONNECTIONS, context.previousData);
        }
    },
    onSettled: () => {
      queryClient.invalidateQueries({queryKey: QK_PATCHBAY_CONNECTIONS});
    }
  });

  return {
    connect: oscWorker.connect,
    disconnect: oscWorker.disconnect,
    sendMessage: oscWorker.sendMessage,
    connectionStatus,
    lastMessage,
    pluginList: pluginListQuery.data || [], // Ensure data is not undefined
    isLoadingPluginList: pluginListQuery.isLoading,
    isErrorPluginList: pluginListQuery.isError,
    refetchPluginList: pluginListQuery.refetch, // Added refetch function
    patchbayConnections: patchbayConnectionsQuery.data || [], // Ensure data is not undefined
    isLoadingPatchbayConnections: patchbayConnectionsQuery.isLoading,
    isErrorPatchbayConnections: patchbayConnectionsQuery.isError,
    addPlugin: addPluginMutation.mutateAsync,
    removePlugin: removePluginMutation.mutateAsync,
    setParameterValue: setParameterValueMutation.mutateAsync,
    connectPorts: connectPortsMutation.mutateAsync,
    disconnectPorts: disconnectPortsMutation.mutateAsync, // Now expects { connectionId: string }
     // Function to fetch parameters for a specific plugin
    fetchPluginParameters: (pluginId: number) => {
      if (connectionStatus.toLowerCase().includes('connected')) {
        oscWorker.sendMessage(`/${OSC_CARLA_TARGET_NAME}/${pluginId}/get_all_parameter_info`);
        oscWorker.sendMessage(`/${OSC_CARLA_TARGET_NAME}/${pluginId}/get_all_parameter_data`);
        oscWorker.sendMessage(`/${OSC_CARLA_TARGET_NAME}/${pluginId}/get_all_parameter_ranges`);
      }
    },
    getPluginParametersFromCache: (pluginId: number | string) => {
      return queryClient.getQueryData<PluginParameter[]>(QK_PLUGIN_PARAMETERS(pluginId)) || [];
    }
  };
};

export type UseOscReturnType = ReturnType<typeof useOsc>;
