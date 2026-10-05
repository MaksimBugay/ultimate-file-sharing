(() => {
  'use strict';

  const WS_URL = 'wss://secure.fileshare.ovh:31085';
  const PROTOCOL = 'REMOTE_CALL_V9';
  const SIGNAL_PREFIX = 'remote-call-v9:';
  const APPLICATIONS = { manager: 'REMOTE-CALL-MANAGER', video: 'REMOTE-CALL-VIDEO', audio: 'REMOTE-CALL-AUDIO' };
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
  const callCrypto = (() => {
    const encoder = new TextEncoder();
    const saltPrefix = encoder.encode('REMOTE_CALL_V9');
    const toBase64 = value => btoa(String.fromCharCode(...value));
    const fromBase64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));

    async function generateKeyPair() {
      const pair = await generateRSAKeyPair();
      return { privateKey: pair.privateKey, publicKeyString: await exportPublicKey(pair.publicKey) };
    }

    async function deriveSession(secret, publicKeyString, compareCodes) {
      if (!(secret instanceof Uint8Array) || secret.length !== 32) throw new Error('Invalid call secret');
      const publicBytes = encoder.encode(publicKeyString);
      const transcript = new Uint8Array(saltPrefix.length + publicBytes.length);
      transcript.set(saltPrefix);
      transcript.set(publicBytes, saltPrefix.length);
      const salt = await crypto.subtle.digest('SHA-256', transcript);
      const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits', 'deriveKey']);
      const mediaSecret = new Uint8Array(await crypto.subtle.deriveBits({
        name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('remote-call-v9/media-secret')
      }, material, 256));
      const controlKey = await crypto.subtle.deriveKey({
        name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('remote-call-v9/control')
      }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
      let verificationCode = null;
      if (compareCodes) {
        const digest = new Uint8Array(await crypto.subtle.sign('HMAC', controlKey,
          encoder.encode(`remote-call-v9/verification/${publicKeyString}`)));
        const number = ((digest[0] * 0x1000000 + digest[1] * 0x10000 + digest[2] * 0x100 + digest[3]) % 100000000)
          .toString().padStart(8, '0');
        verificationCode = `${number.slice(0, 4)} ${number.slice(4)}`;
      }
      return { mediaSecret, controlKey, verificationCode };
    }

    async function createSession(publicKeyString, compareCodes) {
      const publicKey = await importPublicKeyFromString(publicKeyString);
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const wrappedSecret = await encryptWithPublicKey(publicKey, toBase64(secret));
      return { wrappedSecret, session: await deriveSession(secret, publicKeyString, compareCodes) };
    }

    async function openSession(pair, wrappedSecret, compareCodes) {
      const secret = fromBase64(await decryptWithPrivateKey(pair.privateKey, wrappedSecret));
      return deriveSession(secret, pair.publicKeyString, compareCodes);
    }

    function unsigned(message) {
      const { auth, ...value } = message;
      return value;
    }

    async function signSignal(key, message) {
      const tag = new Uint8Array(await crypto.subtle.sign('HMAC', key,
        encoder.encode(JSON.stringify(unsigned(message)))));
      return toBase64(tag).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    async function verifySignal(key, message) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(message?.auth || '')) return false;
      const tag = fromBase64(message.auth.replace(/-/g, '+').replace(/_/g, '/') + '=');
      return crypto.subtle.verify('HMAC', key, tag, encoder.encode(JSON.stringify(unsigned(message))));
    }

    return { generateKeyPair, createSession, openSession, signSignal, verifySignal };
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
  let acceptedManagerLookup = null;
  let acceptedManagerAlias = null;
  let offerSignal = null;
  let joinSignal = null;
  const channels = new Map();
  const localBinaryIds = { audio: uuid.v4().toString(), video: uuid.v4().toString() };
  let encryptionEnabled = encryptionToggle.checked;
  let extraSecurityEnabled = extraSecurityToggle.checked;
  let localKeyPair = null;
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
    if (!['0', '1'].includes(encrypted) || !['0', '1'].includes(extraSecurity)
      || (encrypted === '0' && extraSecurity === '1')) phase = 'invalid';
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

  function isPlaybackMark(mark) {
    return mark === null || (Number.isSafeInteger(mark?.chunk) && mark.chunk >= 0
      && Number.isFinite(mark.timeMs) && mark.timeMs >= 0);
  }

  function setConnectionStatus(message) {
    connectionStatus.textContent = message;
  }

  async function establishSession(derivedSession, destination) {
    session = derivedSession;
    verificationDestination = destination;
    if (!extraSecurityEnabled) return;
    verificationCode.textContent = session.verificationCode;
    verificationPromise = new Promise(resolve => { resolveVerification = resolve; });
    for (const message of pendingVerifications.splice(0)) {
      if (await callCrypto.verifySignal(session.controlKey, message)) remoteVerified = true;
    }
  }

  function showVerification() {
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
    if (!session || !verificationDestination || localVerified || verifyCallButton.disabled) return;
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
        encrypted: encryptionEnabled, mediaSecret: encryptionEnabled ? session.mediaSecret : null
      }, window.location.origin);
    }, { once: true });
    iframe.src = new URL(`remote-call-channel.html?kind=${kind}&v=11`, pageUrl).toString();
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
    const signed = { protocol: PROTOCOL, ...message };
    if (encryptionEnabled && ['VERIFY', 'READY', 'START', 'STOP'].includes(message.type)) {
      if (!session && message.type !== 'STOP') throw new Error('Call keys are not ready');
      if (session) signed.auth = await callCrypto.signSignal(session.controlKey, signed);
    }
    const payload = encodeToBase64UrlSafe(JSON.stringify(signed));
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
    const failedPhase = phase;
    phase = 'error';
    releaseInviteWakeLock();
    verificationPanel.hidden = true;
    encryptionToggle.disabled = true;
    extraSecurityToggle.disabled = true;
    setConnectionStatus(`${label}: ${error.message}`);
    console.error(label, error);
    try {
      const counts = await window.RemoteCallMedia.abort();
      const destination = peer?.manager || verificationDestination || sourceHost;
      if (destination && PushcaClient.isOpen()) await sendSignal(destination,
        session && !['negotiating', 'awaiting-offer'].includes(failedPhase)
          ? { type: 'STOP', counts } : { type: 'REJECT', reason: `${label}: ${error.message}` });
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
      if (['negotiating', 'verifying', 'waiting-ready', 'preparing', 'calling', 'ended', 'error'].includes(phase)) {
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
    phase = 'negotiating';
    encryptionToggle.disabled = true;
    extraSecurityToggle.disabled = true;
    extraEchoToggle.disabled = true;
    acceptedManagerAlias = message.managerAlias;
    setConnectionStatus('Receiver joined. Establishing call security…');
    acceptedManagerLookup = Promise.resolve(manager);
    verificationDestination = manager;
    let wrappedSecret = null;
    if (encryptionEnabled) {
      let agreement;
      try {
        agreement = await callCrypto.createSession(message.publicKey, extraSecurityEnabled);
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
      type: 'OFFER', encrypted: encryptionEnabled, extraSecurity: extraSecurityEnabled,
      ...(encryptionEnabled ? { wrappedSecret } : {})
    };
    await sendSignal(manager, offerSignal);
    if (phase !== 'verifying') return;
    showVerification();
    await verificationPromise;
    if (phase === 'verifying') {
      phase = 'waiting-ready';
      setConnectionStatus('Security confirmed. Waiting for the receiver’s camera and microphone…');
    }
  }

  async function handleOffer(message) {
    if (!hasSourceHost || phase !== 'awaiting-offer') return;
    if (message.encrypted !== encryptionEnabled || message.extraSecurity !== extraSecurityEnabled) {
      throw new Error('Call security settings differ from the joint link');
    }
    phase = extraSecurityEnabled ? 'verifying' : 'joining';
    if (encryptionEnabled) {
      const derived = await callCrypto.openSession(localKeyPair, message.wrappedSecret, extraSecurityEnabled);
      await establishSession(derived, sourceHost);
      if (extraSecurityEnabled) {
        if (phase !== 'verifying') return;
        showVerification();
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
      type: 'READY', managerAlias, videoAlias: aliases.videoAlias,
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
      lookupClient(message.videoAlias, APPLICATIONS.video),
      lookupClient(message.audioAlias, APPLICATIONS.audio)
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
    await sendSignal(manager, {
      type: 'START', videoAlias: aliases.videoAlias, audioAlias: aliases.audioAlias,
      userName: userName(), mimeTypes, binaryIds: localBinaryIds, encrypted: encryptionEnabled
    });
    if (phase !== 'preparing') return;
    phase = 'calling';
    await window.RemoteCallMedia.start(sendChunk);
    if (phase !== 'calling') return;
    releaseInviteWakeLock();
    hideJointLink();
    invitePanel.open = false;
    setConnectionStatus(`Call started with ${peer.name}.`);
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
      if (extraSecurityEnabled && message.type === 'VERIFY' && !session
        && ['negotiating', 'verifying'].includes(phase)) {
        if (pendingVerifications.length < 8) pendingVerifications.push(message);
        return;
      }
      if (encryptionEnabled && ['VERIFY', 'READY', 'START', 'STOP'].includes(message.type)) {
        if (!session || !await callCrypto.verifySignal(session.controlKey, message)) return;
      }
      if (message.type === 'JOIN') await handleJoin(message);
      if (message.type === 'OFFER') await handleOffer(message);
      if (message.type === 'READY') await handleReady(message);
      if (message.type === 'VERIFY' && extraSecurityEnabled && session && ['ready', 'verifying'].includes(phase)) {
        remoteVerified = true;
        finishVerificationIfReady();
      }
      if (message.type === 'START') await handleStart(message);
      if (message.type === 'REJECT' && ['negotiating', 'awaiting-offer', 'verifying', 'waiting-ready', 'joining', 'ready'].includes(phase)) {
        phase = 'error';
        verificationPanel.hidden = true;
        setConnectionStatus(message.reason || 'The invitation was rejected.');
        await window.RemoteCallMedia.abort();
      }
      if (message.type === 'STOP' && ['ready', 'verifying', 'waiting-ready', 'preparing', 'starting', 'calling', 'ended'].includes(phase)
        && !remoteStopReceived) {
        remoteStopReceived = true;
        phase = 'ended';
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
  async function stopCall() {
    if (phase !== 'calling') return;
    phase = 'ended';
    releaseInviteWakeLock();
    encryptionToggle.disabled = true;
    extraSecurityToggle.disabled = true;
    try {
      await stopLocalAndNotify();
      setConnectionStatus(remoteStopReceived ? 'Call ended.' : 'Your recording stopped. Waiting for the peer stream to finish…');
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
    stopCall
  };

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
      joinSignal = {
        type: 'JOIN', managerAlias, userName: userName(), encrypted: encryptionEnabled,
        extraSecurity: extraSecurityEnabled,
        ...(encryptionEnabled ? { publicKey: localKeyPair.publicKeyString } : {})
      };
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
