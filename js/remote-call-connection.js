(() => {
  'use strict';

  const WS_URL = 'wss://secure.fileshare.ovh:31085';
  const PROTOCOL = 'REMOTE_CALL_V10';
  const SIGNAL_PREFIX = 'remote-call-v10:';
  const APPLICATIONS = { manager: 'REMOTE-CALL-MANAGER' };
  const TRANSPORT_VERSION = 2;
  const LATENCY_TEST_COUNT = 20;
  const START_LEAD_MS = 3000;
  const MAX_START_ATTEMPTS = 3;
  const MAX_START_LATENESS_MS = 250;
  const jointLink = document.getElementById('jointLink');
  const jointLinkLabel = document.getElementById('jointLinkLabel');
  const copyButton = document.getElementById('copyJointLinkButton');
  const invitePanel = document.getElementById('invitePanel');
  const connectionStatus = document.getElementById('connectionStatus');
  const connectionIndicator = document.getElementById('connectionIndicator');
  const nameInput = document.getElementById('callUserName');
  const joinNameDialog = document.getElementById('joinNameDialog');
  const joinNameForm = document.getElementById('joinNameForm');
  const joinNameInput = document.getElementById('joinNameInput');
  const localHeading = document.getElementById('localName');
  const counterpartHeading = document.getElementById('counterpartName');
  const encryptionToggle = document.getElementById('encryptMedia');
  const extraSecurityToggle = document.getElementById('extraSecurity');
  const extraEchoToggle = document.getElementById('extraEchoCancellation');
  const verificationPanel = document.getElementById('verificationPanel');
  const verificationCode = document.getElementById('verificationCode');
  const verifyCallButton = document.getElementById('verifyCallButton');
  const chunkDeliveryStats = {
    audio: document.getElementById('audioChunkDelivery'),
    video: document.getElementById('videoChunkDelivery')
  };
  const callCrypto = (() => {
    const encoder = new TextEncoder();
    const saltPrefix = encoder.encode('REMOTE_CALL_V10');
    const toBase64 = value => btoa(String.fromCharCode(...value));
    const fromBase64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
    const toBase64Url = value => toBase64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const fromBase64Url = value => fromBase64(value.replace(/-/g, '+').replace(/_/g, '/') + '=');
    const isKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

    // Link keys, nonces, commitments and tags are 32 bytes in unpadded base64url.
    function randomKey() {
      return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    }

    async function generateKeyPair() {
      // Non-extractable: the private key cannot leave this page. The public key stays exportable.
      const pair = await crypto.subtle.generateKey({
        name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'
      }, false, ['encrypt', 'decrypt']);
      return { privateKey: pair.privateKey, publicKeyString: await exportPublicKey(pair.publicKey) };
    }

    function linkHmacKey(linkKey, usage) {
      return crypto.subtle.importKey('raw', fromBase64Url(linkKey), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
    }

    function joinTranscript(join) {
      return encoder.encode(JSON.stringify(['remote-call-v10/join', join.managerAlias, join.publicKey,
        join.commitment ?? null]));
    }

    // Only someone holding the joint link can vouch for the receiver public key.
    async function proveJoin(linkKey, join) {
      return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await linkHmacKey(linkKey, 'sign'),
        joinTranscript(join))));
    }

    async function verifyJoin(linkKey, join) {
      if (!isKey(join?.keyProof) || typeof join.publicKey !== 'string') return false;
      return crypto.subtle.verify('HMAC', await linkHmacKey(linkKey, 'verify'), fromBase64Url(join.keyProof),
        joinTranscript(join));
    }

    async function commit(nonce) {
      return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64Url(nonce))));
    }

    async function opensCommitment(nonce, commitment) {
      return isKey(nonce) && isKey(commitment) && await commit(nonce) === commitment;
    }

    async function deriveSession(secret, linkKey, publicKeyString) {
      if (!(secret instanceof Uint8Array) || secret.length !== 32) throw new Error('Invalid call secret');
      // Mixing in the link key means a relay that substitutes public keys ends up with different keys.
      const input = new Uint8Array(64);
      input.set(secret);
      input.set(fromBase64Url(linkKey), 32);
      const publicBytes = encoder.encode(publicKeyString);
      const transcript = new Uint8Array(saltPrefix.length + publicBytes.length);
      transcript.set(saltPrefix);
      transcript.set(publicBytes, saltPrefix.length);
      const salt = await crypto.subtle.digest('SHA-256', transcript);
      const material = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveBits', 'deriveKey']);
      const mediaSecret = new Uint8Array(await crypto.subtle.deriveBits({
        name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('remote-call-v10/media-secret')
      }, material, 256));
      const controlKey = await crypto.subtle.deriveKey({
        name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('remote-call-v10/control')
      }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
      return { mediaSecret, controlKey, publicKeyString };
    }

    // Both nonces are fixed before either side can compute the code: the receiver commits to its nonce
    // before seeing the caller nonce, so a relay gets one guess instead of an offline search.
    async function verificationCode(session, callerNonce, receiverNonce) {
      const digest = new Uint8Array(await crypto.subtle.sign('HMAC', session.controlKey, encoder.encode(JSON.stringify(
        ['remote-call-v10/verification', session.publicKeyString, callerNonce, receiverNonce]))));
      const number = ((digest[0] * 0x1000000 + digest[1] * 0x10000 + digest[2] * 0x100 + digest[3]) % 100000000)
        .toString().padStart(8, '0');
      return `${number.slice(0, 4)} ${number.slice(4)}`;
    }

    async function createSession(publicKeyString, linkKey) {
      const publicKey = await importPublicKeyFromString(publicKeyString);
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const wrappedSecret = await encryptWithPublicKey(publicKey, toBase64(secret));
      return { wrappedSecret, session: await deriveSession(secret, linkKey, publicKeyString) };
    }

    async function openSession(pair, wrappedSecret, linkKey) {
      const secret = fromBase64(await decryptWithPrivateKey(pair.privateKey, wrappedSecret));
      return deriveSession(secret, linkKey, pair.publicKeyString);
    }

    function unsigned(message) {
      const { auth, ...value } = message;
      return value;
    }

    async function signSignal(key, message) {
      return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key,
        encoder.encode(JSON.stringify(unsigned(message))))));
    }

    async function verifySignal(key, message) {
      if (!isKey(message?.auth)) return false;
      return crypto.subtle.verify('HMAC', key, fromBase64Url(message.auth),
        encoder.encode(JSON.stringify(unsigned(message))));
    }

    return {
      isKey, randomKey, generateKeyPair, proveJoin, verifyJoin, commit, opensCommitment,
      verificationCode, createSession, openSession, signSignal, verifySignal
    };
  })();
  const searchParams = new URLSearchParams(window.location.search);
  const pageUrl = new URL(window.location.href);
  pageUrl.search = '';
  pageUrl.hash = '';
  const hasSourceHost = searchParams.has('source-host');
  invitePanel.open = !hasSourceHost;
  const sourceHostParam = searchParams.get('source-host');
  let sourceHost = null;
  let managerAlias = null;
  let readySignal = null;
  let joinPromise = null;
  let phase = 'connecting';
  let peer = null;
  let remoteStopReceived = false;
  let localStopPromise = null;
  let localStopReason = null;
  let acceptedManagerLookup = null;
  let acceptedManagerAlias = null;
  let offerSignal = null;
  let joinSignal = null;
  const channels = new Map();
  const participantClientIds = { audio: uuid.v4().toString(), video: uuid.v4().toString() };
  let remoteCallId = hasSourceHost ? null : uuid.v4().toString();
  let synchronization = null;
  let latencyTask = null;
  let pendingLatencyTest = null;
  let cancelRecordingStart = null;
  let confirmationTimer = null;
  const localBinaryIds = { audio: uuid.v4().toString(), video: uuid.v4().toString() };
  let encryptionEnabled = encryptionToggle.checked;
  let extraSecurityEnabled = extraSecurityToggle.checked;
  let localKeyPair = null;
  // Travels only in the joint link fragment, which never reaches the relay server.
  let linkKey = hasSourceHost ? null : callCrypto.randomKey();
  let callerNonce = null;
  let receiverNonce = null;
  let receiverCommitment = null;
  let session = null;
  let verificationDestination = null;
  let verificationPromise = null;
  let resolveVerification = null;
  let localVerified = false;
  let remoteVerified = false;
  const pendingVerifications = [];
  let waitingForCallStart = false;
  let inviteWakeLock = null;
  let inviteWakeLockTask = null;

  if (hasSourceHost) {
    const linkSettings = new URLSearchParams(window.location.hash.slice(1));
    setCounterpartName(linkSettings.get('caller-name'));
    extraEchoToggle.checked = linkSettings.get('extra-echo') === '1';
    extraEchoToggle.disabled = true;
    const encrypted = linkSettings.get('e2e');
    const extraSecurity = linkSettings.get('extra-security');
    linkKey = linkSettings.get('link-key');
    if (!['0', '1'].includes(encrypted) || !['0', '1'].includes(extraSecurity)
      || (encrypted === '0' && extraSecurity === '1')
      || (encrypted === '1' && !callCrypto.isKey(linkKey))) phase = 'invalid';
    else {
      encryptionEnabled = encrypted === '1';
      extraSecurityEnabled = extraSecurity === '1';
    }
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
    hideJointLink();
    encryptionToggle.disabled = true;
    extraSecurityToggle.disabled = true;
  }
  encryptionToggle.checked = encryptionEnabled;
  extraSecurityToggle.checked = extraSecurityEnabled;
  extraSecurityToggle.disabled = extraSecurityToggle.disabled || !encryptionEnabled;
  nameInput.value = hasSourceHost ? 'Receiver' : 'Caller';
  localHeading.textContent = userName();

  function setConnectionStatus(message) {
    connectionStatus.textContent = message;
  }

  function updateChunkDeliveryStats(kind, diagnostics) {
    const element = chunkDeliveryStats[kind];
    if (!element) return;
    const { deliverySampleCount, averageChunkSizeBytes, averageDeliveryLatencyMs } = diagnostics;
    let value = '—';
    if (Number.isInteger(deliverySampleCount) && deliverySampleCount > 0 && deliverySampleCount <= 5
      && Number.isFinite(averageChunkSizeBytes) && averageChunkSizeBytes > 0
      && Number.isFinite(averageDeliveryLatencyMs) && averageDeliveryLatencyMs >= 0) {
      const size = Number((averageChunkSizeBytes / 1048576).toPrecision(3));
      value = `${size} MB / ${Math.round(averageDeliveryLatencyMs)} ms`;
    }
    element.textContent = `${kind === 'audio' ? 'Audio' : 'Video'}: ${value}`;
  }

  async function establishSession(derivedSession, destination) {
    session = derivedSession;
    verificationDestination = destination;
    if (!extraSecurityEnabled) return;
    verificationPromise = new Promise(resolve => { resolveVerification = resolve; });
    for (const message of pendingVerifications.splice(0)) {
      if (await callCrypto.verifySignal(session.controlKey, message)) remoteVerified = true;
    }
  }

  async function showVerification(receiverNonceValue) {
    verificationCode.textContent = await callCrypto.verificationCode(session, callerNonce, receiverNonceValue);
    verificationPanel.hidden = false;
    setConnectionStatus('Compare the security code with the other person before confirming.');
  }

  function finishVerificationIfReady() {
    if (!localVerified || !remoteVerified) return;
    verificationPanel.hidden = true;
    setConnectionStatus('Security code confirmed. Connecting the call…');
    resolveVerification?.();
  }

  verifyCallButton.addEventListener('click', async () => {
    if (!session || !verificationDestination || verificationPanel.hidden || localVerified
      || verifyCallButton.disabled) return;
    verifyCallButton.disabled = true;
    try {
      await sendSignal(verificationDestination, { type: 'VERIFY' });
      localVerified = true;
      if (!remoteVerified) setConnectionStatus('Code confirmed. Waiting for the other person…');
      finishVerificationIfReady();
    } catch (error) {
      verifyCallButton.disabled = false;
      setConnectionStatus(`Could not confirm the security code: ${error.message}`);
    }
  });

  function isMobile() {
    const userAgent = /Mobi|Android/i.test(navigator.userAgent);
    const smallScreen = window.innerWidth <= 800 && window.innerHeight <= 1280;
    const touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    return userAgent && smallScreen && touchDevice;
  }

  function shouldHoldInviteWakeLock() {
    return waitingForCallStart && !['ended', 'error'].includes(phase)
      && document.visibilityState === 'visible';
  }

  function requestInviteWakeLock() {
    if (!isMobile() || !navigator.wakeLock?.request || !shouldHoldInviteWakeLock()
      || inviteWakeLock || inviteWakeLockTask) return inviteWakeLockTask;
    inviteWakeLockTask = (async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        inviteWakeLock = lock;
        lock.addEventListener('release', () => {
          if (inviteWakeLock === lock) inviteWakeLock = null;
        });
        if (!shouldHoldInviteWakeLock()) {
          inviteWakeLock = null;
          await lock.release();
        }
      } catch (error) {
        console.warn('Could not keep the screen awake while waiting for the call:', error);
      }
    })().finally(() => { inviteWakeLockTask = null; });
    return inviteWakeLockTask;
  }

  function releaseInviteWakeLock() {
    waitingForCallStart = false;
    if (!inviteWakeLock) return;
    const lock = inviteWakeLock;
    inviteWakeLock = null;
    void lock.release().catch(error => console.warn('Could not release the screen wake lock:', error));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void (inviteWakeLockTask || Promise.resolve()).then(requestInviteWakeLock);
  });
  window.addEventListener('pagehide', releaseInviteWakeLock);

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
    const linkSettings = new URLSearchParams({
      e2e: encryptionEnabled ? '1' : '0',
      'extra-security': extraSecurityEnabled ? '1' : '0'
    });
    if (encryptionEnabled) linkSettings.set('link-key', linkKey);
    linkSettings.set('extra-echo', extraEchoToggle.checked ? '1' : '0');
    linkSettings.set('caller-name', userName());
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
      || typeof message.encrypted !== 'boolean' || message.transportVersion !== TRANSPORT_VERSION
      || message.remoteCallId !== remoteCallId) {
      throw new Error('Incomplete call message');
    }
  }

  async function lookupClient(alias, applicationId) {
    const result = await PushcaClient.connectionAliasLookup(alias);
    if (!result || result.client.applicationId !== applicationId) throw new Error(`Invalid ${applicationId} alias`);
    return result.client;
  }

  async function lookupMediaClient(alias, kind) {
    const result = await PushcaClient.connectionAliasLookup(alias);
    const client = result?.client;
    if (!client || client.workSpaceId !== `REMOTE_CALL_${kind.toUpperCase()}_STREAM`
      || client.applicationId !== remoteCallId || !client.accountId || client.accountId !== client.deviceId) {
      throw new Error(`Invalid ${kind} call channel alias`);
    }
    return client;
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
        type: 'REJECT',
        reason: 'This call is already in progress. Ask the caller for a new joint link.'
      });
    } catch (error) {
      console.warn('Could not reject an additional receiver:', error);
    }
  }

  function channel(kind) {
    let entry = channels.get(kind);
    if (entry) return entry;
    if (encryptionEnabled && !session?.mediaSecret) throw new Error('Call media keys are not ready');
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
        remoteCallId, clientId: participantClientIds[kind],
        encrypted: encryptionEnabled, mediaSecret: encryptionEnabled ? session.mediaSecret : null
      }, window.location.origin);
    }, { once: true });
    iframe.src = new URL(`remote-call-channel.html?kind=${kind}&v=16`, pageUrl).toString();
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
      if (message.scope !== 'receive') entry.reject(new Error(message.message));
      setConnectionStatus(message.message);
      console.error(message.message);
      if (message.scope === 'receive') {
        window.RemoteCallMedia?.failRemoteStream(message.kind, message.message);
      } else if (phase === 'calling') {
        void stopCall()
          .catch(error => console.error('Could not notify peer of stopped call:', error))
          .finally(() => setConnectionStatus(message.message));
      }
    } else if (message.type === 'remote-call:queue') {
      entry.diagnostics = message;
      updateChunkDeliveryStats(message.kind, message);
    } else if (message.type === 'remote-call:finished' && Number.isSafeInteger(message.count) && message.count >= 0) {
      entry.resolveDrain?.(message.count);
      entry.resolveDrain = null;
    } else if (message.type === 'remote-call:congestion') {
      void handleCongestion(message).catch(error => { void failCall(error, 'Could not adapt call transport'); });
    } else if (message.type === 'remote-call:chunk' && message.payload instanceof ArrayBuffer
      && Number.isSafeInteger(message.order) && message.order >= 0
      && Number.isSafeInteger(message.index) && message.index >= 0
      && Number.isSafeInteger(message.generation) && message.generation >= 0
      && message.senderStartTimeMs === message.order
      && Number.isSafeInteger(message.senderEndTimeMs) && message.senderEndTimeMs > message.order
      && message.independent === true && typeof message.mimeType === 'string'
      && Number.isFinite(message.arrivedAtEpochMs)) {
      if (!entry.expectedBinaryId) {
        if (entry.earlyChunks.length < 12 && entry.earlyBytes + message.payload.byteLength <= 16 * 1048576) {
          entry.earlyChunks.push(message);
          entry.earlyBytes += message.payload.byteLength;
        }
      } else if (message.binaryId === entry.expectedBinaryId) {
        window.RemoteCallMedia?.receiveChunk(message.kind, message.order, message.payload, message);
      }
    }
  });

  async function handleCongestion(message) {
    if (phase !== 'calling') return;
    const kind = message.kind;
    if (message.action === 'terminate' && kind === 'audio') {
      setConnectionStatus('The network is too slow to maintain real-time audio transmission.');
      await stopCall('The network is too slow to maintain real-time audio transmission.');
    } else if (message.action === 'disable' && kind === 'video') {
      await window.RemoteCallMedia.disableOutgoingVideo();
      if (peer?.manager) await sendSignal(peer.manager, { type: 'CALL_VIDEO_DISABLED' });
      setConnectionStatus('Video disabled because the network is too slow. The audio call continues.');
    } else if (message.action === 'reduce' && [1, 2].includes(message.reductions)) {
      const restart = await window.RemoteCallMedia.reduceTransportQuality(kind, message.reductions);
      if (phase !== 'calling' || !restart) return;
      await sendSignal(peer.manager, { type: 'CALL_RECORDER_RESTART', kind, ...restart });
      const entry = channels.get(kind);
      entry.iframe.contentWindow.postMessage({ type: 'remote-call:resume', kind, generation: restart.generation }, window.location.origin);
      setConnectionStatus(kind === 'audio'
        ? `Audio bitrate reduced to ${restart.bitrate} bps because of network congestion.`
        : `Video quality reduced to ${restart.quality} because of network congestion.`);
    }
  }

  function setPeerMedia(message, clients) {
    peer = clients;
    setCounterpartName(clients.name);
    for (const kind of ['audio', 'video']) {
      const entry = channel(kind);
      entry.peerClient = clients[kind];
      entry.expectedBinaryId = message.binaryIds[kind];
      entry.iframe.contentWindow.postMessage({ type: 'remote-call:set-peer', kind, client: clients[kind] }, window.location.origin);
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
      order: chunk.order, index: chunk.index, generation: chunk.generation,
      independent: true, mimeType: chunk.mimeType,
      actualRecordingStartTimeMs: chunk.actualRecordingStartTimeMs,
      startTime: chunk.startTime, endTime: chunk.endTime,
      createdAtEpochMs: chunk.createdAtEpochMs,
      playStart: chunk.playStart ?? null, playEnd: chunk.playEnd ?? null,
      payload
    }, window.location.origin, [payload]);
  }

  async function sendSignal(destination, message) {
    if (!PushcaClient.isOpen()) throw new Error('Call manager connection is unavailable');
    const signed = { protocol: PROTOCOL, remoteCallId, transportVersion: TRANSPORT_VERSION, ...message };
    if (encryptionEnabled && !['JOIN', 'REJECT'].includes(message.type)) {
      if (!session && message.type !== 'STOP') throw new Error('Call keys are not ready');
      if (session) signed.auth = await callCrypto.signSignal(session.controlKey, signed);
    }
    const payload = encodeToBase64UrlSafe(JSON.stringify(signed));
    await PushcaClient.broadcastMessage(null, destination, false, `${SIGNAL_PREFIX}${payload}`);
  }

  async function drainChannels() {
    const counts = await Promise.all(['audio', 'video'].map(kind => {
      const entry = channels.get(kind);
      if (!entry) return 0;
      return new Promise(resolve => {
        entry.resolveDrain = resolve;
        entry.iframe.contentWindow.postMessage({ type: 'remote-call:finish', kind }, window.location.origin);
      });
    }));
    return { audio: counts[0], video: counts[1] };
  }

  function stopLocalAndNotify(reason) {
    if (!localStopPromise) {
      localStopPromise = (async () => {
        await window.RemoteCallMedia.stop();
        const counts = await drainChannels();
        if (peer?.manager) await sendSignal(peer.manager, { type: 'STOP', counts, ...(reason ? { reason } : {}) });
      })();
    }
    return localStopPromise;
  }

  function cancelSynchronization() {
    cancelRecordingStart?.();
    clearTimeout(confirmationTimer);
    cancelRecordingStart = null;
    confirmationTimer = null;
    if (pendingLatencyTest) {
      clearTimeout(pendingLatencyTest.timer);
      pendingLatencyTest.reject(new Error('Call synchronization canceled'));
      pendingLatencyTest = null;
    }
  }

  function synchronizationFailed(message) {
    if (['ended', 'error'].includes(phase)) return;
    void failCall(new Error(message), 'Call synchronization failed');
  }

  function scheduleRecording(localStartTime) {
    clearTimeout(confirmationTimer);
    confirmationTimer = null;
    phase = 'scheduled';
    window.RemoteCallMedia.setCallStartTime(localStartTime);
    setConnectionStatus(`Call with ${peer.name} starts in ${START_LEAD_MS / 1000} seconds…`);
    const start = () => {
      const remaining = localStartTime - performance.now();
      if (remaining > 0) {
        cancelRecordingStart = window.RemoteCallMedia.scheduleStart(localStartTime, start);
        return;
      }
      cancelRecordingStart = null;
      if (phase !== 'scheduled') return;
      if (-remaining > MAX_START_LATENESS_MS) {
        synchronizationFailed('This browser missed the agreed recording start time. Keep the call tab active and try again.');
        return;
      }
      phase = 'calling';
      void window.RemoteCallMedia.start(sendChunk, localStartTime).then(async () => {
        if (phase !== 'calling') return;
        releaseInviteWakeLock();
        hideJointLink();
        invitePanel.open = false;
        setConnectionStatus(`Call started with ${peer.name}.`);
        await sendSignal(peer.manager, { type: 'CALL_MEDIA_STARTED',
          actualStarts: window.RemoteCallMedia.getRecordingStartTimes() });
      }).catch(error => { void failCall(error, 'Could not start recording'); });
    };
    cancelRecordingStart = window.RemoteCallMedia.scheduleStart(localStartTime, start);
  }

  async function measureLatency() {
    const samples = [];
    const id = uuid.v4().toString();
    synchronization = { id, samples, proposals: 0 };
    setConnectionStatus('Measuring call delivery latency…');
    for (let index = 0; index < LATENCY_TEST_COUNT; index++) {
      if (phase !== 'synchronizing') return;
      let resolve;
      let reject;
      const acknowledged = new Promise((yes, no) => { resolve = yes; reject = no; });
      const sentAt = performance.now();
      pendingLatencyTest = {
        id, index, sentAt, resolve, reject,
        timer: setTimeout(() => {
          if (pendingLatencyTest?.id === id && pendingLatencyTest.index === index) {
            pendingLatencyTest = null;
            reject(new Error(`Call latency probe ${index + 1}/${LATENCY_TEST_COUNT} was not acknowledged within 10 seconds`));
          }
        }, 10000)
      };
      // Attach a rejection handler before sending: cancellation may race the relay.
      const sample = acknowledged.then(value => value);
      void sample.catch(() => {});
      await sendSignal(peer.manager, { type: 'CALL_LATENCY_TEST', id, index });
      samples.push(await sample);
    }
    if (phase !== 'synchronizing') return;
    const sorted = [...samples].sort((a, b) => a - b);
    synchronization.medianRTT = (sorted[9] + sorted[10]) / 2;
    synchronization.estimatedOneWayLatency = synchronization.medianRTT / 2;
    synchronization.callerSendTime = performance.now();
    await sendSignal(peer.manager, { type: 'CALL_CLOCK_SYNC', id,
      callerSendTime: synchronization.callerSendTime,
      estimatedOneWayLatency: synchronization.estimatedOneWayLatency });
    if (phase === 'synchronizing') confirmationTimer = setTimeout(() => {
      synchronizationFailed('No recording start proposal arrived');
    }, 15000);
  }

  async function proposeStart() {
    clearTimeout(confirmationTimer);
    const preparingPhase = phase;
    await window.RemoteCallMedia.ensureReady();
    if (phase !== preparingPhase) return;
    if (++synchronization.proposals > MAX_START_ATTEMPTS) {
      throw new Error('The network cannot agree on a recording start with enough scheduling time');
    }
    const proposalId = uuid.v4().toString();
    const calleeStartTime = performance.now() + START_LEAD_MS;
    const callerStartTime = calleeStartTime - synchronization.clockOffset;
    Object.assign(synchronization, { proposalId, calleeStartTime, callerStartTime });
    phase = 'awaiting-start-ack';
    confirmationTimer = setTimeout(() => {
      synchronizationFailed('The recording start proposal was not acknowledged in time');
    }, START_LEAD_MS);
    await sendSignal(sourceHost, { type: 'CALL_START_PROPOSAL', id: synchronization.id,
      proposalId, callerStartTime, calleeStartTime, clockOffset: synchronization.clockOffset });
  }

  async function handleSynchronization(message, receivedAt) {
    if (message.remoteCallId !== remoteCallId || message.transportVersion !== TRANSPORT_VERSION) return;
    if (message.type === 'CALL_TRANSPORT_READY' && !hasSourceHost && phase === 'synchronizing' && !latencyTask) {
      latencyTask = measureLatency();
      await latencyTask;
    } else if (message.type === 'CALL_LATENCY_TEST' && hasSourceHost && phase === 'synchronizing'
      && typeof message.id === 'string' && Number.isInteger(message.index) && message.index >= 0 && message.index < LATENCY_TEST_COUNT) {
      await sendSignal(sourceHost, { type: 'CALL_LATENCY_ACK', id: message.id, index: message.index });
    } else if (message.type === 'CALL_LATENCY_ACK' && !hasSourceHost && pendingLatencyTest
      && message.id === pendingLatencyTest.id && message.index === pendingLatencyTest.index) {
      const pending = pendingLatencyTest;
      pendingLatencyTest = null;
      clearTimeout(pending.timer);
      pending.resolve(Math.max(0, receivedAt - pending.sentAt));
    } else if (message.type === 'CALL_CLOCK_SYNC' && hasSourceHost && phase === 'synchronizing'
      && typeof message.id === 'string' && Number.isFinite(message.callerSendTime) && message.callerSendTime >= 0
      && Number.isFinite(message.estimatedOneWayLatency) && message.estimatedOneWayLatency >= 0) {
      synchronization = { id: message.id, proposals: 0,
        estimatedOneWayLatency: message.estimatedOneWayLatency,
        clockOffset: receivedAt - message.callerSendTime - message.estimatedOneWayLatency };
      await proposeStart();
    } else if (message.type === 'CALL_START_PROPOSAL' && !hasSourceHost && phase === 'synchronizing'
      && message.id === synchronization?.id && typeof message.proposalId === 'string'
      && Number.isFinite(message.callerStartTime) && Number.isFinite(message.calleeStartTime)
      && Number.isFinite(message.clockOffset)
      && Math.abs(message.calleeStartTime - message.clockOffset - message.callerStartTime) < 0.01) {
      clearTimeout(confirmationTimer);
      await window.RemoteCallMedia.ensureReady();
      if (phase !== 'synchronizing') return;
      if (++synchronization.proposals > MAX_START_ATTEMPTS) throw new Error('Too many recording start proposals');
      const margin = Math.max(500, synchronization.medianRTT + 250);
      if (message.callerStartTime - performance.now() < margin) {
        await sendSignal(peer.manager, { type: 'CALL_START_REJECT', id: message.id, proposalId: message.proposalId,
          reason: 'Insufficient recording scheduling margin; propose a new start time.' });
        return;
      }
      Object.assign(synchronization, { proposalId: message.proposalId,
        localStartTime: message.callerStartTime, peerStartTime: message.calleeStartTime,
        clockOffset: message.clockOffset });
      phase = 'awaiting-start-confirmation';
      confirmationTimer = setTimeout(() => {
        synchronizationFailed('Recording start confirmation did not arrive before the agreed start');
      }, Math.max(0, synchronization.localStartTime - performance.now()));
      await sendSignal(peer.manager, { type: 'CALL_START_ACK', id: message.id, proposalId: message.proposalId });
    } else if (message.type === 'CALL_START_REJECT' && hasSourceHost && phase === 'awaiting-start-ack'
      && message.id === synchronization?.id && message.proposalId === synchronization.proposalId) {
      await proposeStart();
    } else if (message.type === 'CALL_START_ACK' && hasSourceHost && phase === 'awaiting-start-ack'
      && message.id === synchronization?.id && message.proposalId === synchronization.proposalId) {
      await window.RemoteCallMedia.ensureReady();
      if (phase !== 'awaiting-start-ack') return;
      if (synchronization.calleeStartTime - performance.now() < synchronization.estimatedOneWayLatency + 100) {
        // The ACK itself was delayed; a fresh proposal must be acknowledged again.
        phase = 'synchronizing';
        await sendSignal(sourceHost, { type: 'CALL_START_RETRY', id: synchronization.id, proposalId: synchronization.proposalId });
        await proposeStart();
        return;
      }
      const confirmed = sendSignal(sourceHost, { type: 'CALL_START_CONFIRMED', id: synchronization.id,
        proposalId: synchronization.proposalId, callerStartTime: synchronization.callerStartTime });
      synchronization.localStartTime = synchronization.calleeStartTime;
      synchronization.peerStartTime = synchronization.callerStartTime;
      scheduleRecording(synchronization.localStartTime);
      await confirmed;
    } else if (message.type === 'CALL_START_RETRY' && !hasSourceHost && phase === 'awaiting-start-confirmation'
      && message.id === synchronization?.id && message.proposalId === synchronization.proposalId) {
      cancelSynchronization();
      phase = 'synchronizing';
    } else if (message.type === 'CALL_START_CONFIRMED' && !hasSourceHost && phase === 'awaiting-start-confirmation'
      && message.id === synchronization?.id && message.proposalId === synchronization.proposalId
      && message.callerStartTime === synchronization.localStartTime) {
      await window.RemoteCallMedia.ensureReady();
      if (phase !== 'awaiting-start-confirmation') return;
      if (performance.now() >= synchronization.localStartTime) throw new Error('The recording start confirmation arrived too late');
      scheduleRecording(synchronization.localStartTime);
    } else if (message.type === 'CALL_MEDIA_STARTED' && ['scheduled', 'calling', 'ended'].includes(phase)) {
      window.RemoteCallMedia.setPeerRecordingStartTimes(message.actualStarts);
    } else if (message.type === 'CALL_RECORDER_RESTART' && ['calling', 'ended'].includes(phase)
      && ['audio', 'video'].includes(message.kind) && Number.isSafeInteger(message.generation) && message.generation > 0
      && Number.isSafeInteger(message.firstIndex) && message.firstIndex >= 0 && typeof message.mimeType === 'string') {
      window.RemoteCallMedia.restartRemotePlayer(message.kind, message);
    } else if (message.type === 'CALL_VIDEO_DISABLED' && ['calling', 'ended'].includes(phase)) {
      window.RemoteCallMedia.disableRemoteVideo();
    }
  }

  async function failCall(error, label) {
    const failedPhase = phase;
    phase = 'error';
    cancelSynchronization();
    releaseInviteWakeLock();
    verificationPanel.hidden = true;
    encryptionToggle.disabled = true;
    extraSecurityToggle.disabled = true;
    setConnectionStatus(`${label}: ${error.message}`);
    console.error(label, error);
    try {
      await window.RemoteCallMedia.abort();
      const destination = peer?.manager || verificationDestination || sourceHost;
      if (destination && PushcaClient.isOpen()) await sendSignal(destination,
        (session || peer) && !['negotiating', 'awaiting-offer'].includes(failedPhase)
          ? { type: 'STOP', counts: { audio: 0, video: 0 }, reason: `${label}: ${error.message}` } : { type: 'REJECT', reason: `${label}: ${error.message}` });
    } catch (cleanupError) {
      console.error('Could not clean up failed call:', cleanupError);
    }
  }

  async function handleJoin(message) {
    if (hasSourceHost) return;
    if (phase !== 'waiting') {
      if (message.managerAlias === acceptedManagerAlias && offerSignal && acceptedManagerLookup
        && ['verifying', 'waiting-ready'].includes(phase)) {
        await sendSignal(await acceptedManagerLookup, offerSignal);
        return;
      }
      if (['negotiating', 'verifying', 'waiting-ready', 'preparing', 'synchronizing', 'awaiting-start-ack', 'awaiting-start-confirmation', 'scheduled', 'calling', 'ended', 'error'].includes(phase)) {
        await rejectAdditionalReceiver(message);
      }
      return;
    }
    if (typeof message.managerAlias !== 'string' || !message.managerAlias) return;
    let manager;
    try {
      manager = await lookupClient(message.managerAlias, APPLICATIONS.manager);
    } catch (error) {
      console.warn('Ignoring invalid call manager alias:', error);
      return;
    }
    if (phase !== 'waiting') return;
    if (message.encrypted !== encryptionEnabled || message.extraSecurity !== extraSecurityEnabled
      || (encryptionEnabled && typeof message.publicKey !== 'string')) {
      await sendSignal(manager, {
        type: 'REJECT', reason: 'The call settings changed. Ask the caller for a new joint link.'
      });
      return;
    }
    if (encryptionEnabled && (!await callCrypto.verifyJoin(linkKey, message)
      || (extraSecurityEnabled && !callCrypto.isKey(message.commitment)))) {
      console.warn('Ignoring a join request that does not prove knowledge of the joint link');
      await sendSignal(manager, {
        type: 'REJECT', reason: 'The joint link could not be verified. Ask the caller for a new joint link.'
      });
      return;
    }
    if (phase !== 'waiting') return;
    phase = 'negotiating';
    encryptionToggle.disabled = true;
    extraSecurityToggle.disabled = true;
    extraEchoToggle.disabled = true;
    acceptedManagerAlias = message.managerAlias;
    setConnectionStatus('Receiver joined. Establishing call security…');
    acceptedManagerLookup = Promise.resolve(manager);
    verificationDestination = manager;
    receiverCommitment = extraSecurityEnabled ? message.commitment : null;
    callerNonce = extraSecurityEnabled ? callCrypto.randomKey() : null;
    let wrappedSecret = null;
    if (encryptionEnabled) {
      let agreement;
      try {
        agreement = await callCrypto.createSession(message.publicKey, linkKey);
      } catch (error) {
        console.warn('Ignoring invalid receiver public key:', error);
        await sendSignal(manager, { type: 'REJECT', reason: 'Invalid call public key. Open a fresh joint link.' });
        if (phase === 'negotiating') {
          phase = 'waiting';
          acceptedManagerAlias = null;
          acceptedManagerLookup = null;
          verificationDestination = null;
          encryptionToggle.disabled = false;
          extraSecurityToggle.disabled = !encryptionEnabled;
          extraEchoToggle.disabled = false;
          refreshJointLink();
          setConnectionStatus('Connected. Share the joint link to start a call.');
        }
        return;
      }
      wrappedSecret = agreement.wrappedSecret;
      await establishSession(agreement.session, manager);
    }
    if (phase !== 'negotiating') return;
    phase = extraSecurityEnabled ? 'verifying' : 'waiting-ready';
    offerSignal = {
      type: 'OFFER', remoteCallId, transportVersion: TRANSPORT_VERSION, encrypted: encryptionEnabled, extraSecurity: extraSecurityEnabled,
      ...(encryptionEnabled ? { wrappedSecret } : {}),
      ...(extraSecurityEnabled ? { nonce: callerNonce } : {})
    };
    await sendSignal(manager, offerSignal);
    if (phase !== 'verifying') return;
    // The code appears once the receiver reveals the nonce it committed to (handleReveal).
    setConnectionStatus('Waiting for the receiver’s security code…');
    await verificationPromise;
    if (phase === 'verifying') {
      phase = 'waiting-ready';
      setConnectionStatus('Security confirmed. Waiting for the receiver’s camera and microphone…');
    }
  }

  async function handleReveal(message) {
    if (hasSourceHost || !extraSecurityEnabled || phase !== 'verifying' || !session
      || !verificationPanel.hidden) return;
    if (!await callCrypto.opensCommitment(message.nonce, receiverCommitment)) {
      throw new Error('The receiver’s security data does not match its commitment');
    }
    if (phase !== 'verifying') return;
    await showVerification(message.nonce);
  }

  async function handleOffer(message) {
    if (!hasSourceHost || phase !== 'awaiting-offer') return;
    if (message.encrypted !== encryptionEnabled || message.extraSecurity !== extraSecurityEnabled) {
      throw new Error('Call security settings differ from the joint link');
    }
    if (message.transportVersion !== TRANSPORT_VERSION || typeof message.remoteCallId !== 'string' || !message.remoteCallId) {
      throw new Error('This call uses an older transport. Reload both call pages and open a fresh joint link.');
    }
    remoteCallId = message.remoteCallId;
    phase = extraSecurityEnabled ? 'verifying' : 'joining';
    if (encryptionEnabled) {
      const derived = await callCrypto.openSession(localKeyPair, message.wrappedSecret, linkKey);
      // Only the joint link creator derives the same control key, so this rejects offers forged by the relay.
      if (!await callCrypto.verifySignal(derived.controlKey, message)) {
        throw new Error('The caller could not be verified. Ask the caller for a new joint link.');
      }
      if (extraSecurityEnabled && !callCrypto.isKey(message.nonce)) {
        throw new Error('The caller sent invalid security code data');
      }
      await establishSession(derived, sourceHost);
      if (extraSecurityEnabled) {
        if (phase !== 'verifying') return;
        callerNonce = message.nonce;
        await sendSignal(sourceHost, { type: 'REVEAL', nonce: receiverNonce });
        if (phase !== 'verifying') return;
        await showVerification(receiverNonce);
        await verificationPromise;
        if (phase !== 'verifying') return;
        phase = 'joining';
      }
    }
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
      type: 'READY', remoteCallId, transportVersion: TRANSPORT_VERSION, managerAlias, videoAlias: aliases.videoAlias,
      audioAlias: aliases.audioAlias, userName: userName(), mimeTypes,
      binaryIds: localBinaryIds, encrypted: encryptionEnabled
    };
    await sendSignal(sourceHost, readySignal);
    if (phase === 'ready') setConnectionStatus('Ready. Waiting for the caller to start.');
  }

  async function handleReady(message) {
    if (hasSourceHost || !['waiting-ready', 'verifying'].includes(phase)) return;
    validateAliases(message, true);
    if (message.managerAlias !== acceptedManagerAlias || message.encrypted !== encryptionEnabled) {
      throw new Error('Call receiver or encryption setting changed during setup');
    }
    if (phase === 'verifying') await verificationPromise;
    if (!['waiting-ready', 'verifying'].includes(phase)) return;
    phase = 'preparing';
    setConnectionStatus('Receiver is ready. Preparing your camera and microphone…');
    const [manager, video, audio] = await Promise.all([
      acceptedManagerLookup,
      lookupMediaClient(message.videoAlias, 'video'),
      lookupMediaClient(message.audioAlias, 'audio')
    ]);
    if (phase !== 'preparing') return;
    setConnectionStatus(extraSecurityEnabled
      ? 'Security confirmed. Preparing your camera and microphone…'
      : 'Preparing your camera and microphone…');
    const aliases = await openMediaChannels();
    if (phase !== 'preparing') return;
    const mimeTypes = await window.RemoteCallMedia.prepare();
    if (phase !== 'preparing') {
      await window.RemoteCallMedia.abort();
      return;
    }
    setPeerMedia(message, { manager, video, audio, name: message.userName || 'Receiver' });
    phase = 'synchronizing';
    await sendSignal(manager, {
      type: 'START', videoAlias: aliases.videoAlias, audioAlias: aliases.audioAlias,
      userName: userName(), mimeTypes, binaryIds: localBinaryIds, encrypted: encryptionEnabled
    });
    if (phase === 'synchronizing') setConnectionStatus('Waiting for both media transports before clock synchronization…');
  }

  async function handleStart(message) {
    if (!sourceHost || phase !== 'ready') return;
    validateAliases(message, false);
    if (message.encrypted !== encryptionEnabled) throw new Error('Call encryption setting differs from the joint link');
    if (extraSecurityEnabled) {
      await verificationPromise;
      if (phase !== 'ready') return;
    }
    phase = 'starting';
    const [video, audio] = await Promise.all([
      lookupMediaClient(message.videoAlias, 'video'),
      lookupMediaClient(message.audioAlias, 'audio')
    ]);
    if (phase !== 'starting') return;
    setPeerMedia(message, { manager: sourceHost, video, audio, name: message.userName || 'Caller' });
    phase = 'synchronizing';
    await sendSignal(sourceHost, { type: 'CALL_TRANSPORT_READY' });
  }

  PushcaClient.onMessageHandler = (_ws, data) => {
    if (typeof data !== 'string' || !data.startsWith(SIGNAL_PREFIX)) return;
    const receivedAt = performance.now();
    let message;
    try { message = JSON.parse(decodeFromBase64UrlSafe(data.slice(SIGNAL_PREFIX.length))); } catch { return; }
    if (message?.protocol !== PROTOCOL || typeof message.type !== 'string') return;
    void (async () => {
      if (extraSecurityEnabled && message.type === 'VERIFY' && !session
        && ['negotiating', 'verifying'].includes(phase)) {
        if (pendingVerifications.length < 8) pendingVerifications.push(message);
        return;
      }
      if (encryptionEnabled && !['JOIN', 'OFFER', 'REJECT'].includes(message.type)) {
        if (!session || !await callCrypto.verifySignal(session.controlKey, message)) return;
      }
      if (message.type === 'JOIN') await handleJoin(message);
      if (message.type === 'OFFER') await handleOffer(message);
      if (message.type === 'REVEAL') await handleReveal(message);
      if (message.type === 'READY') await handleReady(message);
      if (message.type === 'VERIFY' && extraSecurityEnabled && session && ['ready', 'verifying'].includes(phase)) {
        remoteVerified = true;
        finishVerificationIfReady();
      }
      if (message.type === 'START') await handleStart(message);
      if (message.type.startsWith('CALL_')) await handleSynchronization(message, receivedAt);
      if (message.type === 'REJECT' && ['negotiating', 'awaiting-offer', 'verifying', 'waiting-ready', 'joining', 'ready'].includes(phase)) {
        phase = 'error';
        verificationPanel.hidden = true;
        setConnectionStatus(message.reason || 'The invitation was rejected.');
        await window.RemoteCallMedia.abort();
      }
      if (message.type === 'STOP' && ['ready', 'verifying', 'waiting-ready', 'preparing', 'starting', 'synchronizing', 'awaiting-start-ack', 'awaiting-start-confirmation', 'scheduled', 'calling', 'ended'].includes(phase)
        && !remoteStopReceived) {
        remoteStopReceived = true;
        phase = 'ended';
        cancelSynchronization();
        releaseInviteWakeLock();
        verificationPanel.hidden = true;
        encryptionToggle.disabled = true;
        extraSecurityToggle.disabled = true;
        if (peer) {
          window.RemoteCallMedia.finishRemote(message.counts);
          try {
            await stopLocalAndNotify();
          } finally {
            window.RemoteCallMedia.markCallEnded();
          }
        } else {
          await window.RemoteCallMedia.abort();
        }
        setConnectionStatus(message.reason || localStopReason || 'Call ended.');
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
    const link = jointLink.value;
    if (isMobile()) {
      waitingForCallStart = true;
      void requestInviteWakeLock();
    }
    const copyPromise = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(link).then(() => true, () => false)
      : Promise.resolve(false);
    if (isMobile() && navigator.share) {
      navigator.share({
        title: 'Remote call',
        text: 'Join my remote call',
        url: link
      }).catch(error => {
        if (error.name !== 'AbortError') console.error('Error sharing:', error);
      });
    }
    let copied = await copyPromise;
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
    if (!encryptionEnabled) {
      extraSecurityEnabled = false;
      extraSecurityToggle.checked = false;
    }
    extraSecurityToggle.disabled = !encryptionEnabled;
    if (PushcaClient.isOpen()) refreshJointLink();
  });

  extraSecurityToggle.addEventListener('change', () => {
    if (hasSourceHost || !['connecting', 'waiting'].includes(phase) || !encryptionEnabled) {
      extraSecurityToggle.checked = extraSecurityEnabled;
      return;
    }
    extraSecurityEnabled = extraSecurityToggle.checked;
    if (PushcaClient.isOpen()) refreshJointLink();
  });

  extraEchoToggle.addEventListener('change', () => {
    if (!hasSourceHost && PushcaClient.isOpen()) refreshJointLink();
  });

  nameInput.addEventListener('input', () => {
    localHeading.textContent = userName();
    if (!hasSourceHost && phase === 'waiting' && PushcaClient.isOpen()) refreshJointLink();
  });

  /** @returns {Promise<void>} */
  async function stopCall(reason) {
    if (!['calling', 'scheduled', 'synchronizing', 'awaiting-start-ack', 'awaiting-start-confirmation'].includes(phase)) return;
    phase = 'ended';
    localStopReason = typeof reason === 'string' ? reason : null;
    cancelSynchronization();
    releaseInviteWakeLock();
    encryptionToggle.disabled = true;
    extraSecurityToggle.disabled = true;
    try {
      await stopLocalAndNotify(typeof reason === 'string' ? reason : undefined);
      setConnectionStatus(reason || (remoteStopReceived ? 'Call ended.' : 'Your recording stopped. Waiting for the peer stream to finish…'));
    } catch (error) {
      setConnectionStatus(`Could not notify the peer that the call ended: ${error.message}`);
      console.error('Could not finish call:', error);
    } finally {
      if (remoteStopReceived) window.RemoteCallMedia.markCallEnded();
    }
  }

  window.RemoteCallConnection = {
    disableRemoteVideoReception: () => {
      const entry = channels.get('video');
      entry?.iframe.contentWindow.postMessage({ type: 'remote-call:disable-receive', kind: 'video' }, window.location.origin);
    },
    stopCall,
    getTransportDiagnostics: () => Object.fromEntries([...channels].map(([kind, entry]) => [kind, entry.diagnostics || null])),
    getSynchronization: () => synchronization ? { ...synchronization, samples: [...(synchronization.samples || [])] } : null
  };

  window.addEventListener('pagehide', cancelSynchronization);

  async function waitForManagerAlias(client) {
    const result = await CallableFuture.callAsynchronously(10000, String(client.hashCode()), () => {});
    if (result.type !== WaiterResponseType.SUCCESS || !result.body) throw new Error('Could not get call manager alias');
    managerAlias = result.body;
    if (phase === 'ready' && readySignal && sourceHost) {
      readySignal.managerAlias = managerAlias;
      await sendSignal(sourceHost, readySignal);
    } else if (phase === 'awaiting-offer' && joinSignal && sourceHost) {
      joinSignal.managerAlias = managerAlias;
      await sendSignal(sourceHost, joinSignal);
    } else if (phase === 'connecting' && sourceHost) {
      void joinReceiver().catch(error => { void failCall(error, 'Call connection failed'); });
    }
    return managerAlias;
  }

  function joinReceiver() {
    if (joinPromise) return joinPromise;
    phase = 'awaiting-offer';
    joinPromise = (async () => {
      if (extraSecurityEnabled) receiverNonce = callCrypto.randomKey();
      joinSignal = {
        type: 'JOIN', managerAlias, userName: userName(), encrypted: encryptionEnabled,
        extraSecurity: extraSecurityEnabled,
        ...(encryptionEnabled ? { publicKey: localKeyPair.publicKeyString } : {}),
        ...(extraSecurityEnabled ? { commitment: await callCrypto.commit(receiverNonce) } : {})
      };
      if (encryptionEnabled) joinSignal.keyProof = await callCrypto.proveJoin(linkKey, joinSignal);
      setConnectionStatus(encryptionEnabled
        ? 'Requesting the call keys from the caller…' : 'Joining the call…');
      await sendSignal(sourceHost, joinSignal);
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
    if (hasSourceHost && encryptionEnabled && phase !== 'invalid') localKeyPair = await callCrypto.generateKeyPair();
    await connect();
  })().catch(error => {
    if (['awaiting-offer', 'joining', 'ready', 'starting', 'calling', 'ended', 'error'].includes(phase)) return;
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
