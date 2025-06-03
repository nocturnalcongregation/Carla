import React, { useState, useEffect, useCallback } from "react";
import type { ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query"; // Import useQueryClient
import { QK_PLUGIN_PARAMETERS } from "../services/useOsc"; // Import query key for parameters

// === Type Definitions ===
// Assuming these types are now potentially coming from a central types.ts or are aligned with useOsc's version
// For this refactor, ensure they match what App.tsx provides from useOsc.ts
export interface PluginParameter {
  id: number;
  name: string;
  unit?: string;
  comment?: string;
  groupName?: string;
  type?: number;
  hints?: number;
  midiChannel?: number;
  mappedControlIndex?: number;
  mappedMinimum?: number;
  mappedMaximum?: number;
  defaultValue?: number;
  minimum?: number;
  maximum?: number;
  step?: number;
  stepSmall?: number;
  stepLarge?: number;
  value?: number;
}
export interface PortCounts {
  audioIns: number;
  audioOuts: number;
  midiIns: number;
  midiOuts: number;
  cvIns?: number;
  cvOuts?: number;
  paramTotal?: number;
}
export interface ProgramCounts {
  programs: number;
  midiPrograms: number;
}
export interface InternalParams {
  active: boolean;
  dryWet: number;
  volume: number;
  balanceLeft: number;
  balanceRight: number;
  panning: number;
  ctrlChannel: number;
}
export interface PluginInfo {
  id: number;
  type?: string;
  category?: string;
  hints?: number;
  uniqueId?: number; // type changed to string to match useOsc
  optionsAvailable?: number;
  optionsEnabled?: number;
  name: string;
  filename?: string;
  iconName?: string;
  realName?: string;
  label?: string;
  maker?: string;
  copyright?: string;
  ports: PortCounts; // Made non-optional as per useOsc
  programCounts: ProgramCounts; // Made non-optional
  internalParams: InternalParams; // Made non-optional
}
export interface EngineInfo {
  [key: string]: any;
} // This is not passed as a prop anymore
export interface PatchbayConnection {
  // This should align with useOsc's PatchbayConnection
  id: string;
  sourcePluginId: number;
  sourcePortIndex: number;
  targetPluginId: number;
  targetPortIndex: number;
  sourcePortName?: string;
  targetPortName?: string; // Optional names
}
export type AppPatchbayConnection = PatchbayConnection; // Alias for clarity if needed

// === Components ===
interface CarlaInfoDisplayProps {
  plugins: PluginInfo[];
  connections: AppPatchbayConnection[];
  isLoading: boolean; // For plugin list loading state
  removePlugin: (vars: { pluginId: number }) => Promise<any>;
  disconnectPortsRequest: (vars: { connectionId: string }) => Promise<any>;
  setParameterValueRequest: (vars: {
    pluginId: number;
    paramId: number;
    value: number;
  }) => Promise<any>;
  fetchParametersForPlugin: (pluginId: number) => void;
  getStoredParametersForPlugin: (pluginId: number) => PluginParameter[];
}

const ParameterInput: React.FC<{
  pluginId: number;
  param: PluginParameter;
  setParameterValueRequest: CarlaInfoDisplayProps["setParameterValueRequest"];
}> = ({ pluginId, param, setParameterValueRequest }) => {
  const [localValue, setLocalValue] = useState(param.value?.toString() ?? "");

  useEffect(() => {
    setLocalValue(param.value?.toString() ?? "");
  }, [param.value]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  const handleBlur = async () => {
    const numValue = parseFloat(localValue);
    if (!isNaN(numValue) && numValue !== param.value) {
      try {
        await setParameterValueRequest({
          pluginId,
          paramId: param.id,
          value: numValue,
        });
      } catch (error) {
        console.error("Error setting parameter via request:", error);
        // Optionally revert localValue or show error
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleBlur();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type="number"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyPress={handleKeyPress}
      step={param.stepSmall || param.step || 0.01}
      min={param.minimum}
      max={param.maximum}
      title={`Min: ${param.minimum ?? "N/A"}, Max: ${
        param.maximum ?? "N/A"
      }, Default: ${param.defaultValue ?? "N/A"}`}
      className="input input-bordered input-xs w-24 ml-2"
    />
  );
};

const PluginParamsDisplay: React.FC<{
  pluginId: number;
  parameters: PluginParameter[]; // Parameters are passed as prop
  setParameterValueRequest: CarlaInfoDisplayProps["setParameterValueRequest"];
}> = ({ pluginId, parameters, setParameterValueRequest }) => {
  if (parameters.length === 0)
    return (
      <p className="text-xs text-gray-500">
        No parameters available or loaded. Click plugin name to load.
      </p>
    );

  return (
    <div className="mt-1 pl-4 border-l-2 border-gray-200">
      <h4 className="text-xs font-semibold text-gray-700">Parameters:</h4>
      <ul className="space-y-1 text-xs">
        {parameters.map((param) => (
          <li
            key={param.id}
            title={`ID: ${param.id}, Unit: ${param.unit || "N/A"}`}
            className="flex items-center justify-between"
          >
            <span>
              {param.groupName && (
                <span className="text-gray-500">[${param.groupName}] </span>
              )}
              {param.name}: {param.value?.toFixed(4) ?? "N/A"}
            </span>
            <ParameterInput
              pluginId={pluginId}
              param={param}
              setParameterValueRequest={setParameterValueRequest}
            />
          </li>
        ))}
      </ul>
    </div>
  );
};

const PatchbayConnectionsDisplay: React.FC<{
  connections: AppPatchbayConnection[];
  disconnectPortsRequest: CarlaInfoDisplayProps["disconnectPortsRequest"];
}> = ({ connections, disconnectPortsRequest }) => {
  if (!connections || connections.length === 0)
    return <p className="text-xs text-gray-500">No patchbay connections.</p>;

  const handleDisconnect = async (connectionId: string) => {
    if (
      window.confirm(
        `Are you sure you want to disconnect connection ${connectionId}?`
      )
    ) {
      try {
        await disconnectPortsRequest({ connectionId });
      } catch (error) {
        console.error("Error disconnecting connection:", error);
        alert(`Failed to disconnect: ${(error as Error).message}`);
      }
    }
  };

  return (
    <div className="mt-3">
      <h3 className="font-medium mb-1">Connections ({connections.length}):</h3>
      <ul className="space-y-1 text-xs">
        {connections.map((conn) => (
          <li
            key={conn.id}
            className="flex justify-between items-center p-1 bg-gray-100 rounded"
          >
            <span>
              (ID: {conn.id}) Plg {conn.sourcePluginId}:{conn.sourcePortIndex}{" "}
              &rarr; Plg {conn.targetPluginId}:{conn.targetPortIndex}
            </span>
            <button
              onClick={() => handleDisconnect(conn.id)}
              className="btn btn-warning btn-xs"
            >
              X
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const CarlaInfoDisplay: React.FC<CarlaInfoDisplayProps> = ({
  plugins,
  connections,
  isLoading,
  removePlugin,
  disconnectPortsRequest,
  setParameterValueRequest,
  fetchParametersForPlugin,
  getStoredParametersForPlugin,
}) => {
  const [expandedPluginId, setExpandedPluginId] = useState<number | null>(null);
  const [currentDisplayParams, setCurrentDisplayParams] = useState<
    PluginParameter[]
  >([]);
  const queryClient = useQueryClient();

  const togglePluginDetails = useCallback(
    (pluginId: number) => {
      const newSelectedId = expandedPluginId === pluginId ? null : pluginId;
      setExpandedPluginId(newSelectedId);
      if (newSelectedId !== null) {
        fetchParametersForPlugin(newSelectedId); // Request parameters from OSC
        setCurrentDisplayParams(getStoredParametersForPlugin(newSelectedId)); // Get initial from cache
      } else {
        setCurrentDisplayParams([]);
      }
    },
    [expandedPluginId, fetchParametersForPlugin, getStoredParametersForPlugin]
  );

  useEffect(() => {
    if (expandedPluginId === null) {
      setCurrentDisplayParams([]);
      return;
    }
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.query &&
        event.type === "updated" &&
        event.query.queryKey[0] === QK_PLUGIN_PARAMETERS(expandedPluginId)[0] && // Check if it's a pluginParameters query
        String(event.query.queryKey[1]) === String(expandedPluginId)
      ) {
        // Check if it's for the currently expanded plugin
        setCurrentDisplayParams(getStoredParametersForPlugin(expandedPluginId));
      }
    });
    setCurrentDisplayParams(getStoredParametersForPlugin(expandedPluginId)); // Initial set
    return unsubscribe;
  }, [expandedPluginId, getStoredParametersForPlugin, queryClient]);

  const handleRemovePlugin = async (pluginId: number) => {
    if (window.confirm(`Are you sure you want to remove plugin ${pluginId}?`)) {
      try {
        await removePlugin({ pluginId });
        if (expandedPluginId === pluginId) {
          setExpandedPluginId(null);
        }
      } catch (error) {
        console.error("Error removing plugin:", error);
        alert(`Failed to remove plugin: ${(error as Error).message}`);
      }
    }
  };

  if (isLoading && !plugins.length)
    return <div className="text-center p-4">Loading plugin info...</div>;

  return (
    <div className="mt-4 p-4 border rounded-md bg-gray-50">
      <h2 className="text-xl font-semibold mb-2">Carla Host Information</h2>

      {plugins && plugins.length > 0 ? (
        <div className="mb-3">
          <h3 className="font-medium mb-1">Plugins ({plugins.length}):</h3>
          <ul className="space-y-2">
            {plugins.map((plugin) => (
              <li
                key={plugin.id}
                className="text-sm border p-3 rounded bg-white shadow-sm"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <strong
                      onClick={() => togglePluginDetails(plugin.id)}
                      className="cursor-pointer hover:text-blue-600"
                    >
                      {plugin.name}
                    </strong>{" "}
                    (ID: {plugin.id})
                    {plugin.label && (
                      <span className="text-xs">, Label: {plugin.label}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemovePlugin(plugin.id)}
                    className="btn btn-error btn-xs"
                  >
                    Remove
                  </button>
                </div>
                {expandedPluginId === plugin.id && (
                  <PluginParamsDisplay
                    pluginId={plugin.id}
                    parameters={currentDisplayParams}
                    setParameterValueRequest={setParameterValueRequest}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        !isLoading && (
          <p className="text-xs text-gray-500">
            No plugins loaded. Connect to Carla and refresh.
          </p>
        )
      )}
      <PatchbayConnectionsDisplay
        connections={connections}
        disconnectPortsRequest={disconnectPortsRequest}
      />
    </div>
  );
};

export default CarlaInfoDisplay;
