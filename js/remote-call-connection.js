(() => {
  'use strict';

  const WS_URL = 'wss://secure.fileshare.ovh:31085';
  const PROTOCOL = 'REMOTE_CALL_V6';
  const SIGNAL_PREFIX = 'remote-call-v6:';
  const APPLICATIONS = { manager: 'REMOTE-CALL-MANAGER', video: 'REMOTE-CALL-VIDEO', audio: 'REMOTE-CALL-AUDIO' };
  const jointLink = document.getElementById('jointLink');
  const jointLinkLabel = document.getElementById('jointLinkLabel');
  const copyButton = document.getElementById('copyJointLinkButton');
  const connectionStatus = document.getElementById('connectionStatus');
  const connectionIndicator = document.getElementById('connectionIndicator');
  const nameInput = document.getElementById('callUserName');
  const joinNameDialog = document.getElementById('joinNameDialog');
  const joinNameForm = document.getElementById('joinNameForm');
  const joinNameInput = document.getElementById('joinNameInput');
  const localHeading = document.getElementById('localName');
  const counterpartHeading = document.getElementById('counterpartName');
  const encryptionToggle = document.getElementById('encryptMedia');
  const extraEchoToggle = document.getElementById('extraEchoCancellation');
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
  let acceptedManagerLookup = null;
  const channels = new Map();
  const localBinaryIds = { audio: uuid.v4().toString(), video: uuid.v4().toString() };
  let encryptionEnabled = encryptionToggle.checked;
  let callSecret = null;

  function encodeCallSecret(bytes) {
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeCallSecret(value) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value || '')) throw new Error('Missing or invalid call encryption key');
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '=');
    if (binary.length !== 32) throw new Error('Invalid call encryption key');
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  if (hasSourceHost) {
    const linkSettings = new URLSearchParams(window.location.hash.slice(1));
    setCounterpartName(linkSettings.get('caller-name'));
    extraEchoToggle.checked = linkSettings.get('extra-echo') === '1';
    extraEchoToggle.disabled = true;
    const encrypted = linkSettings.get('e2e');
    if (encrypted !== '0' && encrypted !== '1') {
      phase = 'invalid';
    } else {
      encryptionEnabled = encrypted === '1';
      try {
        if (encryptionEnabled) callSecret = decodeCallSecret(linkSettings.get('call-key'));
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
    }
    hideJointLink();
    encryptionToggle.disabled = true;
  } else {
    callSecret = window.crypto.getRandomValues(new Uint8Array(32));
  }
  encryptionToggle.checked = encryptionEnabled;
  nameInput.value = hasSourceHost ? 'Receiver' : 'Caller';
  localHeading.textContent = userName();

  function isPlaybackMark(mark) {
    return mark === null || (Number.isSafeInteger(mark?.chunk) && mark.chunk >= 0
      && Number.isFinite(mark.timeMs) && mark.timeMs >= 0);
  }

  function setConnectionStatus(message) {
    connectionStatus.textContent = message;
  }

  function hideJointLink() {
    jointLink.hidden = true;
    jointLinkLabel.hidden = true;
    copyButton.hidden = true;
    copyButton.disabled = true;
  }

  function setCounterpartName(name) {
    counterpartHeading.textContent = typeof name === 'string' && name.trim()
      ? name.trim().slice(0, 80) : 'Incoming call';
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
    if (hasSourceHost || !['connecting', 'waiting'].includes(phase)) return;
    const url = new URL(pageUrl);
    url.searchParams.set('source-host', encodeToBase64UrlSafe(JSON.stringify(PushcaClient.ClientObj)));
    const linkSettings = new URLSearchParams({ e2e: encryptionEnabled ? '1' : '0' });
    linkSettings.set('extra-echo', extraEchoToggle.checked ? '1' : '0');
    linkSettings.set('caller-name', userName());
    if (encryptionEnabled) linkSettings.set('call-key', encodeCallSecret(callSecret));
    url.hash = linkSettings.toString();
    jointLink.value = url.toString();
    copyButton.disabled = false;
  }

  function userName() {
    return nameInput.value.trim().slice(0, 80) || (hasSourceHost ? 'Receiver' : 'Caller');
  }

  function requestReceiverName() {
    return new Promise(resolve => {
      setConnectionStatus('Enter your name to join the call.');
      joinNameInput.value = userName();
      joinNameDialog.addEventListener('cancel', event => event.preventDefault());
      const submit = event => {
        event.preventDefault();
        const name = joinNameInput.value.trim().slice(0, 80);
        if (!name) {
          joinNameInput.value = '';
          joinNameInput.reportValidity();
          return;
        }
        joinNameForm.removeEventListener('submit', submit);
        nameInput.value = name;
        localHeading.textContent = name;
        joinNameDialog.close();
        setConnectionStatus('Connecting to call manager…');
        resolve();
      };
      joinNameForm.addEventListener('submit', submit);
      joinNameDialog.showModal();
      joinNameInput.select();
    });
  }

  function validateAliases(message, includeManager) {
    const fields = includeManager ? ['managerAlias', 'videoAlias', 'audioAlias'] : ['videoAlias', 'audioAlias'];
    if (!fields.every(field => typeof message[field] === 'string' && message[field].length > 0)
      || !['audio', 'video'].every(kind => typeof message.mimeTypes?.[kind] === 'string'
        && typeof message.binaryIds?.[kind] === 'string')
      || typeof message.encrypted !== 'boolean') {
      throw new Error('Incomplete call message');
    }
  }

  async function lookupClient(alias, applicationId) {
    const result = await PushcaClient.connectionAliasLookup(alias);
    if (!result || result.client.applicationId !== applicationId) throw new Error(`Invalid ${applicationId} alias`);
    return result.client;
  }

  function sameClient(first, second) {
    return first && second && ['workSpaceId', 'accountId', 'deviceId', 'applicationId']
      .every(field => first[field] === second[field]);
  }

  async function rejectAdditionalReceiver(message) {
    if (typeof message.managerAlias !== 'string' || !message.managerAlias) return;
    try {
      const candidate = await lookupClient(message.managerAlias, APPLICATIONS.manager);
      const accepted = await acceptedManagerLookup?.catch(() => null);
      if (sameClient(candidate, accepted) || sameClient(candidate, peer?.manager)) return;
      await sendSignal(candidate, {
        type: 'STOP', counts: { audio: 0, video: 0 },
        reason: 'This call is already in progress. Ask the caller for a new joint link.'
      });
    } catch (error) {
      console.warn('Could not reject an additional receiver:', error);
    }
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
      iframe.contentWindow.postMessage({
        type: 'remote-call:init', kind, role: hasSourceHost ? 'receiver' : 'caller',
        encrypted: encryptionEnabled, callSecret: encryptionEnabled ? callSecret : null
      }, window.location.origin);
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
      && Number.isSafeInteger(message.order) && message.order >= 0
      && Number.isSafeInteger(message.senderStartTimeMs)
      && Number.isSafeInteger(message.senderEndTimeMs)
      && message.senderStartTimeMs >= 0 && message.senderEndTimeMs > message.senderStartTimeMs
      && Number.isFinite(message.createdAtEpochMs) && message.createdAtEpochMs > 0
      && Number.isFinite(message.arrivedAtEpochMs) && message.arrivedAtEpochMs > 0
      && isPlaybackMark(message.playStart) && isPlaybackMark(message.playEnd)) {
      if (!entry.expectedBinaryId) {
        if (entry.earlyBytes + message.payload.byteLength <= 16 * 1048576) {
          entry.earlyChunks.push(message);
          entry.earlyBytes += message.payload.byteLength;
        }
      } else if (message.binaryId === entry.expectedBinaryId) {
        window.RemoteCallMedia?.receiveChunk(message.kind, message.order, message.payload, message);
      }
    }
  });

  function setPeerMedia(message, clients) {
    peer = clients;
    setCounterpartName(clients.name);
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
          window.RemoteCallMedia.receiveChunk(kind, chunk.order, chunk.payload, chunk);
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
      order: chunk.index, startTime: chunk.startTime, endTime: chunk.endTime,
      createdAtEpochMs: chunk.createdAtEpochMs,
      playStart: chunk.playStart ?? null, playEnd: chunk.playEnd ?? null,
      destHashCode: entry.peerClient.hashCode(), payload
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
    encryptionToggle.disabled = true;
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
    if (hasSourceHost) return;
    if (phase !== 'waiting') {
      if (['preparing', 'calling', 'ended', 'error'].includes(phase)) {
        await rejectAdditionalReceiver(message);
      }
      return;
    }
    validateAliases(message, true);
    if (message.encrypted !== encryptionEnabled) {
      setConnectionStatus('The encryption setting changed. Share the current joint link again.');
      try {
        const manager = await lookupClient(message.managerAlias, APPLICATIONS.manager);
        await sendSignal(manager, {
          type: 'STOP', counts: { audio: 0, video: 0 },
          reason: 'The caller changed the encryption setting. Ask for a new joint link.'
        });
      } catch (error) {
        console.error('Could not reject an outdated joint link:', error);
      }
      return;
    }
    phase = 'preparing';
    encryptionToggle.disabled = true;
    setConnectionStatus('Receiver is ready. Preparing your camera and microphone…');
    acceptedManagerLookup = lookupClient(message.managerAlias, APPLICATIONS.manager);
    const [manager, video, audio] = await Promise.all([
      acceptedManagerLookup,
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
      userName: userName(), mimeTypes, binaryIds: localBinaryIds, encrypted: encryptionEnabled
    });
    if (phase !== 'preparing') return;
    phase = 'calling';
    await window.RemoteCallMedia.start(sendChunk);
    if (phase !== 'calling') return;
    hideJointLink();
    setConnectionStatus(`Call started with ${peer.name}.`);
  }

  async function handleStart(message) {
    if (!sourceHost || phase !== 'ready') return;
    validateAliases(message, false);
    if (message.encrypted !== encryptionEnabled) throw new Error('Call encryption setting differs from the joint link');
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
        encryptionToggle.disabled = true;
        if (peer) {
          window.RemoteCallMedia.finishRemote(message.counts);
          await stopLocalAndNotify();
        } else {
          await window.RemoteCallMedia.abort();
        }
        setConnectionStatus(message.reason || 'Call ended.');
      }
    })().catch(error => {
      if (phase !== 'ended') void failCall(error, 'Call setup failed');
    });
  };

  PushcaClient.onOpenHandler = () => {
    updateConnectionHealth();
    if (!hasSourceHost) {
      if (phase === 'connecting') phase = 'waiting';
      refreshJointLink();
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

  encryptionToggle.addEventListener('change', () => {
    if (hasSourceHost || !['connecting', 'waiting'].includes(phase)) {
      encryptionToggle.checked = encryptionEnabled;
      return;
    }
    encryptionEnabled = encryptionToggle.checked;
    if (PushcaClient.isOpen()) refreshJointLink();
  });

  extraEchoToggle.addEventListener('change', () => {
    if (!hasSourceHost && PushcaClient.isOpen()) refreshJointLink();
  });

  nameInput.addEventListener('input', () => {
    localHeading.textContent = userName();
    if (!hasSourceHost && phase === 'waiting' && PushcaClient.isOpen()) refreshJointLink();
  });

  window.RemoteCallConnection = {
    stopCall: async () => {
      if (phase !== 'calling') return;
      phase = 'ended';
      encryptionToggle.disabled = true;
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
        audioAlias: aliases.audioAlias, userName: userName(), mimeTypes,
        binaryIds: localBinaryIds, encrypted: encryptionEnabled
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

  void (async () => {
    if (hasSourceHost && phase !== 'invalid') await requestReceiverName();
    await connect();
  })().catch(error => {
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
