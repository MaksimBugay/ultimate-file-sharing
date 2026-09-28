(() => {
  'use strict';

  const WS_URL = 'wss://secure.fileshare.ovh:31085';
  const PROTOCOL = 'REMOTE_CALL_V1';
  const SIGNAL_PREFIX = 'remote-call-v1:';
  const APPLICATIONS = { manager: 'REMOTE-CALL-MANAGER', video: 'REMOTE-CALL-VIDEO', audio: 'REMOTE-CALL-AUDIO' };
  const jointLink = document.getElementById('jointLink');
  const jointLinkLabel = document.getElementById('jointLinkLabel');
  const copyButton = document.getElementById('copyJointLinkButton');
  const connectionStatus = document.getElementById('connectionStatus');
  const connectionIndicator = document.getElementById('connectionIndicator');
  const nameInput = document.getElementById('callUserName');
  const searchParams = new URLSearchParams(window.location.search);
  const pageUrl = new URL(window.location.href);
  pageUrl.search = '';
  pageUrl.hash = '';
  const hasSourceHost = searchParams.has('source-host');
  const sourceHostParam = searchParams.get('source-host');
  let sourceHost = null;
  let managerAlias = null;
  let readySignal = null;
  let joinPromise = null;
  let phase = 'connecting';
  let peer = null;
  let remoteStopReceived = false;
  let localStopPromise = null;
  const channels = new Map();
  const localBinaryIds = { audio: uuid.v4().toString(), video: uuid.v4().toString() };

  if (hasSourceHost) {
    try {
      const source = JSON.parse(decodeFromBase64UrlSafe(sourceHostParam));
      if (source.applicationId === APPLICATIONS.manager
        && ['workSpaceId', 'accountId', 'deviceId'].every(field => typeof source[field] === 'string' && source[field])) {
        sourceHost = new ClientFilter(source.workSpaceId, source.accountId, source.deviceId, source.applicationId);
      } else {
        phase = 'invalid';
      }
    } catch (error) {
      console.error('Invalid joint link:', error);
      phase = 'invalid';
    }
    jointLink.hidden = true;
    jointLinkLabel.hidden = true;
    copyButton.hidden = true;
  }
  nameInput.value = hasSourceHost ? 'Receiver' : 'Caller';

  function setConnectionStatus(message) {
    connectionStatus.textContent = message;
  }

  function setConnectionHealthy(healthy) {
    const label = healthy ? 'Call connections connected' : 'Call connections incomplete';
    connectionIndicator.style.backgroundColor = healthy ? '#38d985' : '#ff6868';
    connectionIndicator.style.boxShadow = `0 0 0 3px ${healthy ? '#38d98530' : '#ff686830'}`;
    connectionIndicator.setAttribute('aria-label', label);
    connectionIndicator.title = label;
  }

  function updateConnectionHealth() {
    const mediaRequired = hasSourceHost || channels.size > 0;
    const mediaHealthy = !mediaRequired || (channels.size === 2
      && [...channels.values()].every(entry => entry.connected));
    setConnectionHealthy(PushcaClient.isOpen() && mediaHealthy);
  }

  function refreshJointLink() {
    if (hasSourceHost) return;
    const url = new URL(pageUrl);
    url.searchParams.set('source-host', encodeToBase64UrlSafe(JSON.stringify(PushcaClient.ClientObj)));
    jointLink.value = url.toString();
    copyButton.disabled = false;
  }

  function userName() {
    return nameInput.value.trim().slice(0, 80) || (hasSourceHost ? 'Receiver' : 'Caller');
  }

  function validateAliases(message, includeManager) {
    const fields = includeManager ? ['managerAlias', 'videoAlias', 'audioAlias'] : ['videoAlias', 'audioAlias'];
    if (!fields.every(field => typeof message[field] === 'string' && message[field].length > 0)
      || !['audio', 'video'].every(kind => typeof message.mimeTypes?.[kind] === 'string'
        && typeof message.binaryIds?.[kind] === 'string')) {
      throw new Error('Incomplete call message');
    }
  }

  async function lookupClient(alias, applicationId) {
    const result = await PushcaClient.connectionAliasLookup(alias);
    if (!result || result.client.applicationId !== applicationId) throw new Error(`Invalid ${applicationId} alias`);
    return result.client;
  }

  function channel(kind) {
    let entry = channels.get(kind);
    if (entry) return entry;
    // PushcaClient has one global socket per window; each frame owns one media connection.
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    iframe.title = `${kind} call channel`;
    entry = { iframe, alias: null, connected: false, peerClient: null, expectedBinaryId: null, earlyChunks: [], earlyBytes: 0 };
    entry.ready = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    channels.set(kind, entry);
    updateConnectionHealth();
    iframe.addEventListener('load', () => {
      iframe.contentWindow.postMessage({ type: 'remote-call:init', kind }, window.location.origin);
    }, { once: true });
    iframe.src = new URL(`remote-call-channel.html?kind=${kind}`, pageUrl).toString();
    document.body.append(iframe);
    return entry;
  }

  async function openMediaChannels() {
    const [videoAlias, audioAlias] = await Promise.all([
      channel('video').ready, channel('audio').ready
    ]);
    return { videoAlias, audioAlias };
  }

  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return;
    const message = event.data;
    const entry = channels.get(message?.kind);
    if (!entry || event.source !== entry.iframe.contentWindow) return;
    if (message.type === 'remote-call:alias' && typeof message.alias === 'string') {
      entry.alias = message.alias;
      entry.resolve(message.alias);
    } else if (message.type === 'remote-call:state') {
      entry.connected = message.connected === true;
      updateConnectionHealth();
      if (phase === 'calling') {
        setConnectionStatus(message.connected
          ? `Call with ${peer.name}.` : `${message.kind} channel disconnected. Reconnecting…`);
      }
    } else if (message.type === 'remote-call:error') {
      entry.reject(new Error(message.message));
      setConnectionStatus(message.message);
      console.error(message.message);
      if (phase === 'calling') {
        void window.RemoteCallConnection.stopCall()
          .catch(error => console.error('Could not notify peer of stopped call:', error))
          .finally(() => setConnectionStatus(message.message));
      }
    } else if (message.type === 'remote-call:chunk' && message.payload instanceof ArrayBuffer
      && Number.isSafeInteger(message.order) && message.order >= 0) {
      if (!entry.expectedBinaryId) {
        if (entry.earlyBytes + message.payload.byteLength <= 16 * 1048576) {
          entry.earlyChunks.push(message);
          entry.earlyBytes += message.payload.byteLength;
        }
      } else if (message.binaryId === entry.expectedBinaryId) {
        window.RemoteCallMedia?.receiveChunk(message.kind, message.order, message.payload);
      }
    }
  });

  function setPeerMedia(message, clients) {
    peer = clients;
    for (const kind of ['audio', 'video']) {
      const entry = channel(kind);
      entry.peerClient = clients[kind];
      entry.expectedBinaryId = message.binaryIds[kind];
    }
    window.RemoteCallMedia.setPeerMimeTypes(message.mimeTypes);
    for (const kind of ['audio', 'video']) {
      const entry = channel(kind);
      for (const chunk of entry.earlyChunks) {
        if (chunk.binaryId === entry.expectedBinaryId) {
          window.RemoteCallMedia.receiveChunk(kind, chunk.order, chunk.payload);
        }
      }
      entry.earlyChunks = [];
      entry.earlyBytes = 0;
    }
  }

  function sendChunk(chunk) {
    const kind = chunk.mediaType.toLowerCase();
    const entry = channels.get(kind);
    if (!entry?.peerClient || !entry.alias) return;
    const payload = chunk.binary.slice().buffer;
    entry.iframe.contentWindow.postMessage({
      type: 'remote-call:send', kind, binaryId: localBinaryIds[kind],
      order: chunk.index, destHashCode: entry.peerClient.hashCode(), payload
    }, window.location.origin, [payload]);
  }

  async function sendSignal(destination, message) {
    if (!PushcaClient.isOpen()) throw new Error('Call manager connection is unavailable');
    const payload = encodeToBase64UrlSafe(JSON.stringify({ protocol: PROTOCOL, ...message }));
    await PushcaClient.broadcastMessage(null, destination, false, `${SIGNAL_PREFIX}${payload}`);
  }

  function stopLocalAndNotify() {
    if (!localStopPromise) {
      localStopPromise = (async () => {
        const counts = await window.RemoteCallMedia.stop();
        if (peer?.manager) await sendSignal(peer.manager, { type: 'STOP', counts });
      })();
    }
    return localStopPromise;
  }

  async function failCall(error, label) {
    phase = 'error';
    setConnectionStatus(`${label}: ${error.message}`);
    console.error(label, error);
    try {
      const counts = await window.RemoteCallMedia.abort();
      const destination = peer?.manager || sourceHost;
      if (destination && PushcaClient.isOpen()) await sendSignal(destination, { type: 'STOP', counts });
    } catch (cleanupError) {
      console.error('Could not clean up failed call:', cleanupError);
    }
  }

  async function handleReady(message) {
    if (hasSourceHost || phase !== 'waiting') return;
    validateAliases(message, true);
    phase = 'preparing';
    setConnectionStatus('Receiver is ready. Preparing your camera and microphone…');
    const [manager, video, audio] = await Promise.all([
      lookupClient(message.managerAlias, APPLICATIONS.manager),
      lookupClient(message.videoAlias, APPLICATIONS.video),
      lookupClient(message.audioAlias, APPLICATIONS.audio)
    ]);
    if (phase !== 'preparing') return;
    const aliases = await openMediaChannels();
    if (phase !== 'preparing') return;
    const mimeTypes = await window.RemoteCallMedia.prepare();
    if (phase !== 'preparing') {
      await window.RemoteCallMedia.abort();
      return;
    }
    setPeerMedia(message, { manager, video, audio, name: message.userName || 'Receiver' });
    await sendSignal(manager, {
      type: 'START', videoAlias: aliases.videoAlias, audioAlias: aliases.audioAlias,
      userName: userName(), mimeTypes, binaryIds: localBinaryIds
    });
    if (phase !== 'preparing') return;
    phase = 'calling';
    await window.RemoteCallMedia.start(sendChunk);
    if (phase !== 'calling') return;
    setConnectionStatus(`Call started with ${peer.name}.`);
  }

  async function handleStart(message) {
    if (!sourceHost || phase !== 'ready') return;
    validateAliases(message, false);
    phase = 'starting';
    const [video, audio] = await Promise.all([
      lookupClient(message.videoAlias, APPLICATIONS.video),
      lookupClient(message.audioAlias, APPLICATIONS.audio)
    ]);
    if (phase !== 'starting') return;
    setPeerMedia(message, { manager: sourceHost, video, audio, name: message.userName || 'Caller' });
    await window.RemoteCallMedia.start(sendChunk);
    if (phase !== 'starting') return;
    phase = 'calling';
    setConnectionStatus(`Call started with ${peer.name}.`);
  }

  PushcaClient.onMessageHandler = (_ws, data) => {
    if (typeof data !== 'string' || !data.startsWith(SIGNAL_PREFIX)) return;
    let message;
    try { message = JSON.parse(decodeFromBase64UrlSafe(data.slice(SIGNAL_PREFIX.length))); } catch { return; }
    if (message?.protocol !== PROTOCOL) return;
    void (async () => {
      if (message.type === 'READY') await handleReady(message);
      if (message.type === 'START') await handleStart(message);
      if (message.type === 'STOP' && ['ready', 'preparing', 'starting', 'calling', 'ended'].includes(phase)
        && !remoteStopReceived) {
        remoteStopReceived = true;
        phase = 'ended';
        if (peer) {
          window.RemoteCallMedia.finishRemote(message.counts);
          await stopLocalAndNotify();
        } else {
          await window.RemoteCallMedia.abort();
        }
        setConnectionStatus('Call ended.');
      }
    })().catch(error => {
      if (phase !== 'ended') void failCall(error, 'Call setup failed');
    });
  };

  PushcaClient.onOpenHandler = () => {
    updateConnectionHealth();
    if (!hasSourceHost) {
      refreshJointLink();
      if (phase === 'connecting') phase = 'waiting';
      if (phase === 'waiting') setConnectionStatus('Connected. Share the joint link to start a call.');
      else if (phase === 'calling') setConnectionStatus(`Call manager reconnected. Call with ${peer.name}.`);
    } else if (phase === 'connecting') {
      setConnectionStatus('Connected. Preparing to join the call…');
    } else if (phase === 'calling') {
      setConnectionStatus(`Call manager reconnected. Call with ${peer.name}.`);
    }
  };
  PushcaClient.onCloseHandler = () => {
    if (PushcaClient.isOpen()) return;
    updateConnectionHealth();
    copyButton.disabled = true;
    setConnectionStatus('Call manager connection lost. Reconnecting…');
  };

  copyButton.addEventListener('click', async () => {
    if (copyButton.disabled || !jointLink.value) return;
    let copied = navigator.clipboard?.writeText
      ? await navigator.clipboard.writeText(jointLink.value).then(() => true, () => false)
      : false;
    if (!copied) {
      jointLink.select();
      copied = document.execCommand('copy');
    }
    setConnectionStatus(copied ? 'Joint link copied to clipboard.' : 'Copy the joint link from the field.');
  });

  window.RemoteCallConnection = {
    stopCall: async () => {
      if (phase !== 'calling') return;
      phase = 'ended';
      try {
        await stopLocalAndNotify();
        setConnectionStatus(remoteStopReceived ? 'Call ended.' : 'Your recording stopped. Waiting for the peer stream to finish…');
      } catch (error) {
        setConnectionStatus(`Could not notify the peer that the call ended: ${error.message}`);
        console.error('Could not finish call:', error);
      }
    }
  };

  async function waitForManagerAlias(client) {
    const result = await CallableFuture.callAsynchronously(10000, String(client.hashCode()), () => {});
    if (result.type !== WaiterResponseType.SUCCESS || !result.body) throw new Error('Could not get call manager alias');
    managerAlias = result.body;
    if (phase === 'ready' && readySignal && sourceHost) {
      readySignal.managerAlias = managerAlias;
      await sendSignal(sourceHost, readySignal);
    } else if (phase === 'connecting' && sourceHost) {
      void joinReceiver().catch(error => { void failCall(error, 'Call connection failed'); });
    }
    return managerAlias;
  }

  function joinReceiver() {
    if (joinPromise) return joinPromise;
    phase = 'joining';
    joinPromise = (async () => {
      setConnectionStatus('Connecting audio and video channels…');
      const aliases = await openMediaChannels();
      if (phase !== 'joining') return;
      setConnectionStatus('Requesting camera and microphone access…');
      const mimeTypes = await window.RemoteCallMedia.prepare();
      if (phase !== 'joining') {
        await window.RemoteCallMedia.abort();
        return;
      }
      phase = 'ready';
      readySignal = {
        type: 'READY', managerAlias, videoAlias: aliases.videoAlias,
        audioAlias: aliases.audioAlias, userName: userName(), mimeTypes, binaryIds: localBinaryIds
      };
      await sendSignal(sourceHost, readySignal);
      if (phase === 'ready') setConnectionStatus('Ready. Waiting for the caller to start.');
    })();
    return joinPromise;
  }

  async function connect() {
    if (phase === 'invalid') {
      setConnectionStatus('Invalid joint link.');
      return;
    }
    const client = new ClientFilter('remote-call', 'anonymous-sharing', uuid.v4().toString(), APPLICATIONS.manager);
    const aliasPromise = waitForManagerAlias(client);
    void aliasPromise.catch(error => console.warn('Call manager alias is not available yet:', error));
    await PushcaClient.openWsConnection(WS_URL, client, connectedClient => {
      const refreshed = new ClientFilter(
        connectedClient.workSpaceId, connectedClient.accountId,
        connectedClient.deviceId, connectedClient.applicationId
      );
      void waitForManagerAlias(refreshed).catch(error => console.error(error));
      return refreshed;
    });
    if (!PushcaClient.isOpen()) throw new Error('Could not connect to call manager');
    if (!sourceHost) return;
    await aliasPromise;
    await joinReceiver();
  }

  void connect().catch(error => {
    if (['joining', 'ready', 'starting', 'calling', 'ended', 'error'].includes(phase)) return;
    if (!PushcaClient.isOpen()) {
      phase = 'connecting';
      setConnectionStatus('Call manager connection unavailable. Retrying…');
      return;
    }
    void failCall(error, 'Call connection failed');
  });

  window.setInterval(() => {
    const healthy = PushcaClient.isOpen();
    updateConnectionHealth();
    if (healthy) PushcaClient.sendPing();
  }, 10000);
})();
