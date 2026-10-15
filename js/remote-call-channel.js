(() => {
  'use strict';

  const kind = new URLSearchParams(window.location.search).get('kind');
  if (kind !== 'audio' && kind !== 'video') return;

  const parentOrigin = window.location.origin;
  const wsUrl = 'wss://secure.fileshare.ovh:31085';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const hkdfSalt = encoder.encode('remote-call-v9/media');
  const FRAME_MAGIC = 0x31464352; // RCF1
  const MAX_METADATA_BYTES = 4096;
  const MAX_QUEUED_FRAMES = 100;
  const MAX_QUEUED_BYTES = (kind === 'video' ? 32 : 8) * 1048576;
  const workSpaceId = `REMOTE_CALL_${kind.toUpperCase()}_STREAM`;
  const frameType = kind === 'audio' ? BinaryType.REMOTE_CALL_AUDIO_STREAM : BinaryType.REMOTE_CALL_VIDEO_STREAM;
  let initialized = false;
  let receiveDisabled = false;
  let aliasAttempt = 0;
  let activeSend = false;
  let queuedBytes = 0;
  let reductions = 0;
  let minimumGeneration = 0;
  let adapting = false;
  let stopped = false;
  let finishing = false;
  let finishTimer = null;
  let pingTimer = null;
  let acknowledgedFrames = 0;
  let lastAcknowledgedOrder = null;
  let cryptoReady = null;
  let localRole = null;
  let remoteCallId = null;
  let peerClient = null;
  let activeFrame = null;
  let encryptionEnabled = null;
  const sendQueue = [];
  const deliverySamples = [];
  const mediaKeys = new Map();
  const lastSentOrders = new Map();

  function mediaKey(sender, binaryId) {
    const id = `${sender}:${binaryId}`;
    let promise = mediaKeys.get(id);
    if (!promise) {
      promise = cryptoReady.then(baseKey => crypto.subtle.deriveBits({
        name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt,
        info: encoder.encode(JSON.stringify(['remote-call-v9', kind, sender, binaryId]))
      }, baseKey, 288)).then(bits => {
        const material = new Uint8Array(bits);
        return {
          base64Key: arrayBufferToBase64(material.slice(0, 32).buffer),
          ivPrefix: material.slice(32, 36)
        };
      });
      mediaKeys.set(id, promise);
    }
    return promise;
  }

  async function chunkContract(sender, binaryId, order) {
    if (typeof binaryId !== 'string' || !binaryId
      || !Number.isSafeInteger(order) || order < 0) throw new Error('Invalid media chunk metadata');
    const { base64Key, ivPrefix } = await mediaKey(sender, binaryId);
    // A key is unique to this sender and binary ID; the increasing order gives each chunk a distinct AES-GCM IV.
    const iv = new Uint8Array(12);
    iv.set(ivPrefix);
    const view = new DataView(iv.buffer);
    view.setUint32(4, Math.floor(order / 0x100000000));
    view.setUint32(8, order >>> 0);
    return new EncryptionContract(base64Key, arrayBufferToBase64(iv.buffer));
  }

  async function encryptChunk(binaryId, order, payload) {
    const contract = await chunkContract(localRole, binaryId, order);
    return encryptWithAESUsingContract(payload, contract);
  }

  async function decryptChunk(binaryId, order, payload) {
    if (!(payload instanceof ArrayBuffer) || payload.byteLength < 16) {
      throw new Error('Invalid encrypted media chunk');
    }
    const sender = localRole === 'caller' ? 'receiver' : 'caller';
    const contract = await chunkContract(sender, binaryId, order);
    const decrypted = await decryptAESToArrayBuffer(payload, contract.base64Key, contract.base64IV);
    if (!(decrypted instanceof ArrayBuffer)) throw new Error('Media chunk authentication failed');
    return decrypted;
  }

  function report(type, fields = {}, transfer = []) {
    window.parent.postMessage({ type, kind, ...fields }, parentOrigin, transfer);
  }

  function validFrame(frame) {
    return typeof frame.binaryId === 'string' && !!frame.binaryId
      && Number.isSafeInteger(frame.order) && frame.order >= 0 && frame.order <= 0x7fffffff
      && Number.isSafeInteger(frame.index) && frame.index >= 0
      && Number.isSafeInteger(frame.generation) && frame.generation >= 0
      && Number.isSafeInteger(frame.senderStartTimeMs) && frame.senderStartTimeMs === frame.order
      && Number.isSafeInteger(frame.senderEndTimeMs) && frame.senderEndTimeMs > frame.order
      && Number.isFinite(frame.actualRecordingStartTimeMs) && frame.actualRecordingStartTimeMs >= 0
      && typeof frame.mimeType === 'string' && frame.mimeType.startsWith(`${kind}/webm`)
      && frame.independent === true;
  }

  function packFrame(message) {
    const metadata = {
      binaryId: message.binaryId, order: message.order, index: message.index,
      generation: message.generation, mimeType: message.mimeType, independent: true,
      senderStartTimeMs: message.startTime, senderEndTimeMs: message.endTime,
      actualRecordingStartTimeMs: message.actualRecordingStartTimeMs,
      createdAtEpochMs: message.createdAtEpochMs
    };
    if (!validFrame(metadata)) throw new Error('Invalid recorded frame timing');
    const encoded = encoder.encode(JSON.stringify(metadata));
    const wrapped = new ArrayBuffer(8 + encoded.length + message.payload.byteLength);
    const header = new DataView(wrapped);
    header.setUint32(0, FRAME_MAGIC, true);
    header.setUint32(4, encoded.length, true);
    new Uint8Array(wrapped, 8, encoded.length).set(encoded);
    new Uint8Array(wrapped, 8 + encoded.length).set(new Uint8Array(message.payload));
    return wrapped;
  }

  function unpackFrame(payload, wireOrder) {
    if (!(payload instanceof ArrayBuffer) || payload.byteLength < 9) throw new Error('Invalid media frame');
    const header = new DataView(payload);
    const length = header.getUint32(4, true);
    if (header.getUint32(0, true) !== FRAME_MAGIC || length > MAX_METADATA_BYTES || 8 + length >= payload.byteLength) {
      throw new Error('Unsupported media frame format');
    }
    const frame = JSON.parse(decoder.decode(new Uint8Array(payload, 8, length)));
    if (!validFrame(frame) || frame.order !== wireOrder) throw new Error('Invalid received frame timing');
    return { ...frame, payload: payload.slice(8 + length) };
  }

  function reportReceivedFrame(frame, payload, arrivedAtEpochMs) {
    try {
      const received = unpackFrame(payload, frame.order);
      if (!receiveDisabled) report('remote-call:chunk', {
        ...received, arrivedAtEpochMs,
        decryptedAtEpochMs: performance.timeOrigin + performance.now()
      }, [received.payload]);
    } catch (error) {
      report('remote-call:error', { scope: 'receive', message: `${kind} frame ${frame.order}: ${error.message}` });
    }
  }

  function waitForAlias(client) {
    const attempt = ++aliasAttempt;
    void CallableFuture.callAsynchronously(10000, String(client.hashCode()), () => {}).then(result => {
      if (attempt !== aliasAttempt) return;
      if (result.type === WaiterResponseType.SUCCESS && result.body) {
        report('remote-call:alias', { alias: result.body });
      } else {
        report('remote-call:error', { message: `Could not get ${kind} connection alias.` });
      }
    });
  }

  function medianLatency() {
    if (!deliverySamples.length) return null;
    const sorted = deliverySamples.map(sample => sample.latencyMs).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function reportQueue() {
    const sampleCount = deliverySamples.length;
    report('remote-call:queue', {
      queueSize: sendQueue.length, queuedBytes, activeSend,
      medianDeliveryLatencyMs: medianLatency(), reductions, generation: minimumGeneration,
      deliverySampleCount: sampleCount,
      averageChunkSizeBytes: sampleCount
        ? deliverySamples.reduce((total, sample) => total + sample.bytes, 0) / sampleCount : null,
      averageDeliveryLatencyMs: sampleCount
        ? deliverySamples.reduce((total, sample) => total + sample.latencyMs, 0) / sampleCount : null
    });
  }

  function dropUnsentFrames() {
    sendQueue.length = 0;
    queuedBytes = 0;
  }

  function finishIfDrained() {
    if (!finishing || activeSend || sendQueue.length) return;
    clearTimeout(finishTimer);
    finishTimer = null;
    report('remote-call:finished', { count: acknowledgedFrames, lastOrder: lastAcknowledgedOrder });
    finishing = false;
  }

  function handleCongestion() {
    if (stopped || adapting || (sendQueue.length <= MAX_QUEUED_FRAMES && queuedBytes <= MAX_QUEUED_BYTES)) return;
    dropUnsentFrames();
    if (reductions === 2) {
      stopped = true;
      report('remote-call:congestion', { action: kind === 'audio' ? 'terminate' : 'disable', reductions });
      finishIfDrained();
      return;
    }
    reductions++;
    minimumGeneration++;
    adapting = true;
    report('remote-call:congestion', { action: 'reduce', reductions, generation: minimumGeneration });
  }

  async function transmitFrame(message) {
    // Each media iframe has its own PushcaClient and CallableFuture waiting hall.
    // The call UUID routes the frame; the sender hash identifies its source.
    const wrapped = packFrame(message);
    const payload = encryptionEnabled ? await encryptChunk(remoteCallId, message.order, wrapped) : wrapped;
    const senderHash = PushcaClient.ClientObj.hashCode();
    activeFrame = { order: message.order, ackId: `${workSpaceId}_${senderHash}_${remoteCallId}` };
    const result = await PushcaClient.sendRemoteCallFrame(remoteCallId, message.order,
      senderHash, payload, frameType);
    activeFrame = null;
    if (result.type !== WaiterResponseType.SUCCESS) throw new Error(`${kind} frame acknowledgment failed`);
    if (Number.isFinite(result.body) && result.body >= 0) {
      deliverySamples.push({ bytes: payload.byteLength, latencyMs: result.body });
      if (deliverySamples.length > 5) deliverySamples.shift();
    }
    acknowledgedFrames++;
    lastAcknowledgedOrder = message.order;
  }

  function pumpSends() {
    if (stopped || adapting || activeSend || !PushcaClient.isOpen() || !sendQueue.length) {
      finishIfDrained();
      return;
    }
    const message = sendQueue.shift();
    queuedBytes -= message.payload.byteLength;
    activeSend = true;
    void transmitFrame(message).catch(error => {
      if (stopped) return;
      stopped = true;
      dropUnsentFrames();
      report('remote-call:error', { message: `${kind} channel: ${error.message}` });
    }).finally(() => {
      activeSend = false;
      activeFrame = null;
      reportQueue();
      pumpSends();
    });
  }

  PushcaClient.onOpenHandler = () => {
    pumpSends();
    report('remote-call:state', { connected: true });
  };
  PushcaClient.onCloseHandler = () => {
    if (!PushcaClient.isOpen()) report('remote-call:state', { connected: false });
  };
  PushcaClient[kind === 'audio' ? 'onRemoteCallAudioStreamHandler' : 'onRemoteCallVideoStreamHandler'] = frame => {
    // Acknowledge delivery exactly as remote-call-frame-test.html does, before
    // deciding whether this frame belongs in the current call's media history.
    const ackId = `${workSpaceId}_${frame.destClientHash}_${frame.binaryId}`;
    PushcaClient.sendAcknowledge(ackId);
    if (encryptionEnabled === null || frame.binaryId !== remoteCallId) return;
    if (!Number.isInteger(frame.destClientHash) || (peerClient && frame.destClientHash !== peerClient.hashCode())) return;
    if (receiveDisabled) return;
    const arrivedAtEpochMs = performance.timeOrigin + performance.now();
    if (!encryptionEnabled) {
      reportReceivedFrame(frame, frame.payload, arrivedAtEpochMs);
      return;
    }
    void decryptChunk(frame.binaryId, frame.order, frame.payload).then(payload => {
      reportReceivedFrame(frame, payload, arrivedAtEpochMs);
    }).catch(() => {
      if (!receiveDisabled) report('remote-call:error', { scope: 'receive', message: `Could not decrypt ${kind} frame ${frame.order}.` });
    });
  };

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.kind !== kind) return;
    const message = event.data;
    if (message.type === 'remote-call:set-peer' && initialized) {
      const peer = message.client;
      if (peer?.workSpaceId !== workSpaceId || peer.applicationId !== remoteCallId
        || !peer.accountId || peer.accountId !== peer.deviceId) return;
      peerClient = new ClientFilter(peer.workSpaceId, peer.accountId, peer.deviceId, peer.applicationId);
      return;
    }
    if (message.type === 'remote-call:disable-receive' && kind === 'video') {
      receiveDisabled = true;
      return;
    }
    if (message.type === 'remote-call:resume' && message.generation === minimumGeneration && !stopped) {
      adapting = false;
      handleCongestion();
      reportQueue();
      pumpSends();
      return;
    }
    if (message.type === 'remote-call:finish') {
      finishing = true;
      // End-of-call cleanup stays bounded if the peer disappears before an ACK.
      finishTimer ||= setTimeout(() => {
        stopped = true;
        dropUnsentFrames();
        if (activeFrame) CallableFuture.releaseWaiterIfExistsWithError(activeFrame.ackId, 'Call ended before frame acknowledgment');
        finishIfDrained();
      }, 10000);
      pumpSends();
      return;
    }
    if (message.type === 'remote-call:init' && !initialized) {
      if (typeof message.encrypted !== 'boolean'
        || (message.encrypted && (!(message.mediaSecret instanceof Uint8Array) || message.mediaSecret.length !== 32))
        || !['caller', 'receiver'].includes(message.role)
        || typeof message.remoteCallId !== 'string' || !message.remoteCallId
        || typeof message.clientId !== 'string' || !message.clientId) {
        report('remote-call:error', { message: 'Invalid call channel settings.' });
        return;
      }
      initialized = true;
      localRole = message.role;
      remoteCallId = message.remoteCallId;
      encryptionEnabled = message.encrypted;
      cryptoReady = encryptionEnabled
        ? crypto.subtle.importKey('raw', message.mediaSecret, 'HKDF', false, ['deriveBits'])
        : Promise.resolve(null);
      void cryptoReady.then(async () => {
        const client = new ClientFilter(workSpaceId, message.clientId, message.clientId, message.remoteCallId);
        waitForAlias(client);
        await PushcaClient.openWsConnection(wsUrl, client, connectedClient => {
          waitForAlias(connectedClient);
          return connectedClient;
        });
        if (!PushcaClient.isOpen()) report('remote-call:error', { message: `Could not connect ${kind} channel.` });
      }).catch(error => report('remote-call:error', { message: `${kind} channel: ${error.message}` }));
      pingTimer = window.setInterval(() => {
        if (PushcaClient.isOpen()) PushcaClient.sendPing();
      }, 10000);
      return;
    }
    if (message.type !== 'remote-call:send' || !initialized || stopped) return;
    if (!(message.payload instanceof ArrayBuffer) || !message.payload.byteLength) return;
    if (!validFrame({ ...message, senderStartTimeMs: message.startTime, senderEndTimeMs: message.endTime })) return;
    if (message.generation < minimumGeneration) return;
    if (message.order <= (lastSentOrders.get(message.binaryId) ?? -1)) {
      report('remote-call:error', { message: `${kind} capture timestamp was reused.` });
      return;
    }
    lastSentOrders.set(message.binaryId, message.order);
    sendQueue.push(message);
    queuedBytes += message.payload.byteLength;
    if (adapting) {
      while (sendQueue.length > MAX_QUEUED_FRAMES || queuedBytes > MAX_QUEUED_BYTES) {
        queuedBytes -= sendQueue.shift().payload.byteLength;
      }
    } else handleCongestion();
    reportQueue();
    pumpSends();
  });

  window.addEventListener('pagehide', () => {
    stopped = true;
    clearTimeout(finishTimer);
    window.clearInterval(pingTimer);
    dropUnsentFrames();
    PushcaClient.stopWebSocketPermanently();
  });
})();
