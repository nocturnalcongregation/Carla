import { useState, useEffect } from 'react';
import { useOsc } from './services/useOsc';
import CarlaInfoDisplay, { type PatchbayConnection as AppPatchbayConnection } from './components/CarlaInfoDisplay';

function App() {
  const {
    connect, disconnect, connectionStatus, lastMessage,
    pluginList, isLoadingPluginList, refetchPluginList,
    patchbayConnections,
    addPlugin, removePlugin,
    connectPorts, disconnectPorts,
    setParameterValue,
    fetchPluginParameters, getPluginParametersFromCache
  } = useOsc();

  const [host, setHost] = useState('127.0.0.1');
  const [tcpPort, setTcpPort] = useState('22752'); // Default from previous App.tsx
  const [pluginNameText, setPluginNameText] = useState('ZamSynth'); // Example plugin name

  // State for manual connection form
  const [manualSourcePluginId, setManualSourcePluginId] = useState('');
  const [manualSourcePortIndex, setManualSourcePortIndex] = useState('');
  const [manualTargetPluginId, setManualTargetPluginId] = useState('');
  const [manualTargetPortIndex, setManualTargetPortIndex] = useState('');

  const handleConnect = () => connect(host, parseInt(tcpPort, 10), 0); // UDP port is conceptual

  const handleAddPlugin = async () => {
    if (!pluginNameText.trim()) {
      alert("Please enter a plugin name/URI.");
      return;
    }
    try {
      // Assuming 'uri' for LV2 plugins or 'internal' for Carla's internal ones.
      // User might need to specify this, or we can try to be smart.
      // For now, let's default to "uri" as it's common for external plugins.
      // Carla's /ctrl/add_plugin expects: instanceId, type, name, label, filename, x, y
      // The useOsc addPlugin mutation simplifies this to type, name, label, x, y.
      await addPlugin({
        type: "uri", // or "internal" e.g. for "AudioFile"
        name: pluginNameText.trim(),
        label: pluginNameText.trim()
        // x, y are randomized in useOsc if not provided
      });
      // setPluginNameText(''); // Optionally clear input
    } catch (error) {
      console.error("Error adding plugin:", error);
      alert(`Failed to add plugin: ${(error as Error).message}`);
    }
  };

  const handleManualConnectPorts = async () => {
    if (!manualSourcePluginId || !manualSourcePortIndex || !manualTargetPluginId || !manualTargetPortIndex) {
      alert("Please fill all fields for connecting ports.");
      return;
    }
    try {
      await connectPorts({
        sourcePluginId: parseInt(manualSourcePluginId, 10),
        sourcePortIndex: parseInt(manualSourcePortIndex, 10),
        targetPluginId: parseInt(manualTargetPluginId, 10),
        targetPortIndex: parseInt(manualTargetPortIndex, 10),
      });
      // Clear fields after attempting connection
      setManualSourcePluginId('');
      setManualSourcePortIndex('');
      setManualTargetPluginId('');
      setManualTargetPortIndex('');
    } catch (error) {
      console.error("Error connecting ports:", error);
      alert(`Failed to connect ports: ${(error as Error).message}`);
    }
  };

  return (
    <>
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Carla Control PWA</h1>

        <div className="space-y-4 mb-4 p-4 border rounded-lg shadow bg-white">
          <h2 className="text-lg font-semibold">Connection</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label htmlFor="host-input">Host:</label>
              <input
                id="host-input"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="mt-1 block w-full input input-bordered input-sm"
              />
            </div>
            <div>
              <label htmlFor="port-input">TCP Port:</label>
              <input
                id="port-input"
                type="text"
                value={tcpPort}
                onChange={(e) => setTcpPort(e.target.value)}
                className="mt-1 block w-full input input-bordered input-sm"
              />
            </div>
            <div className="flex space-x-2 pt-4">
              <button onClick={handleConnect} className="btn btn-primary btn-sm w-full">
                Connect
              </button>
              <button onClick={disconnect} className="btn btn-secondary btn-sm w-full">
                Disconnect
              </button>
            </div>
          </div>
          <p>Status: {connectionStatus}</p>
        </div>

        <div className="space-y-2 mb-4 p-4 border rounded-lg shadow bg-white">
          <h2 className="text-lg font-semibold">Add Plugin</h2>
          <div className="flex items-end gap-2">
            <div className="flex-grow">
              <label htmlFor="plugin-name-input">Plugin Name/URI:</label>
              <input
                id="plugin-name-input"
                type="text"
                value={pluginNameText}
                onChange={(e) => setPluginNameText(e.target.value)}
                placeholder="e.g., ZamSynth or an LV2 URI"
                className="mt-1 block w-full input input-bordered input-sm"
              />
            </div>
            <button onClick={handleAddPlugin} className="btn btn-accent btn-sm">
              Add Plugin
            </button>
            <button onClick={() => refetchPluginList()} className="btn btn-neutral btn-sm">
              Refresh List
            </button>
          </div>
        </div>

        <div className="space-y-2 mb-4 p-4 border rounded-lg shadow bg-white">
          <h2 className="text-lg font-semibold">Manual Port Connection</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <div>
              <label htmlFor="src-plug-id" className="text-xs">SrcPlgID:</label>
              <input id="src-plug-id" type="text" value={manualSourcePluginId} onChange={(e) => setManualSourcePluginId(e.target.value)} className="input input-bordered input-xs w-full" />
            </div>
            <div>
              <label htmlFor="src-port-idx" className="text-xs">SrcPrtIdx:</label>
              <input id="src-port-idx" type="text" value={manualSourcePortIndex} onChange={(e) => setManualSourcePortIndex(e.target.value)} className="input input-bordered input-xs w-full" />
            </div>
            <div>
              <label htmlFor="tgt-plug-id" className="text-xs">TgtPlgID:</label>
              <input id="tgt-plug-id" type="text" value={manualTargetPluginId} onChange={(e) => setManualTargetPluginId(e.target.value)} className="input input-bordered input-xs w-full" />
            </div>
            <div>
              <label htmlFor="tgt-port-idx" className="text-xs">TgtPrtIdx:</label>
              <input id="tgt-port-idx" type="text" value={manualTargetPortIndex} onChange={(e) => setManualTargetPortIndex(e.target.value)} className="input input-bordered input-xs w-full" />
            </div>
            <button onClick={handleManualConnectPorts} className="btn btn-info btn-sm">
              Connect Ports
            </button>
          </div>
        </div>

        {lastMessage && (
          <div className="mt-2 p-2 bg-gray-100 rounded text-xs border">
            <p>Last OSC: {lastMessage.address} {JSON.stringify(lastMessage.args)}</p>
          </div>
        )}

        <CarlaInfoDisplay
          plugins={pluginList}
          connections={patchbayConnections as AppPatchbayConnection[]} // Cast if needed, ensure types align
          isLoading={isLoadingPluginList}
          removePlugin={removePlugin} // removePlugin.mutateAsync({ pluginId: id })
          disconnectPortsRequest={disconnectPorts} // disconnectPorts.mutateAsync({ connectionId: id })
          setParameterValueRequest={setParameterValue} // setParameterValue.mutateAsync({ pluginId, paramId, value })
          fetchParametersForPlugin={fetchPluginParameters}
          getStoredParametersForPlugin={getPluginParametersFromCache}
        />
      </div>
    </>
  );
}

export default App;
