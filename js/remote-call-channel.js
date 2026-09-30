(() => {
  'use strict';

  const kind = new URLSearchParams(window.location.search).get('kind');
  if (kind !== 'audio' && kind !== 'video') return;

  const parentOrigin = window.location.origin;
  const applicationId = `REMOTE-CALL-${kind.toUpperCase()}`;
  const wsUrl = 'wss://secure.fileshare.ovh:31085';
  const encoder = new TextEncoder();
  const hkdfSalt = encoder.encode('remote-call-v8/media');
  // Magic, start, end and creation time, then the playback marks at start and end
  // (peer chunk number and play time; -1 when nothing from the peer was playing).
  const CHUNK_HEADER_BYTES = 60;
  const CHUNK_MAGIC = 0x364d4352; // "RCM6" in little-endian byte order.
  const MAX_PENDING_SENDS = 512;
  const MAX_PENDING_BYTES = (kind === 'video' ? 64 : 8) * 1048576;
  // Keep transfers ordered so a delayed chunk cannot leave a large gap in the receiver's MSE inbox.
  const MAX_ACTIVE_SENDS = 1;
  let initialized = false;
  let aliasAttempt = 0;
  let pendingSends = 0;
  let pendingBytes = 0;
  let activeSends = 0;
  let connectionEpoch = 0;
  const sendQueue = [];
  const connectionWaiters = [];
  let cryptoReady = null;
  let localRole = null;
  let encryptionEnabled = null;
  const mediaKeys = new Map();
  const lastSentOrders = new Map();

  function mediaKey(sender, binaryId) {
    const id = `${sender}:${binaryId}`;
    let promise = mediaKeys.get(id);
    if (!promise) {
      promise = cryptoReady.then(baseKey => crypto.subtle.deriveBits({
        name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt,
        info: encoder.encode(JSON.stringify(['remote-call-v8', kind, sender, binaryId]))
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

  function isPlaybackMark(mark) {
    return mark === null || (Number.isSafeInteger(mark?.chunk) && mark.chunk >= 0
      && Number.isFinite(mark.timeMs) && mark.timeMs >= 0);
  }

  function writePlaybackMark(header, offset, mark) {
    header.setFloat64(offset, mark ? mark.chunk : -1, true);
    header.setFloat64(offset + 8, mark ? mark.timeMs : -1, true);
  }

  function readPlaybackMark(header, offset) {
    const chunk = header.getFloat64(offset, true);
    const timeMs = header.getFloat64(offset + 8, true);
    const mark = chunk === -1 && timeMs === -1 ? null : { chunk, timeMs };
    if (!isPlaybackMark(mark)) throw new Error('Invalid received playback mark');
    return mark;
  }

  function packChunk(payload, startTime, endTime, createdAtEpochMs, playStart, playEnd) {
    if (!(payload instanceof ArrayBuffer) || !Number.isSafeInteger(startTime)
      || !Number.isSafeInteger(endTime) || startTime < 0 || endTime <= startTime
      || !Number.isFinite(createdAtEpochMs) || createdAtEpochMs <= 0
      || !isPlaybackMark(playStart) || !isPlaybackMark(playEnd)) {
      throw new Error('Invalid recorded chunk timing');
    }
    const wrapped = new ArrayBuffer(CHUNK_HEADER_BYTES + payload.byteLength);
    const header = new DataView(wrapped);
    header.setUint32(0, CHUNK_MAGIC, true);
    header.setFloat64(4, startTime, true);
    header.setFloat64(12, endTime, true);
    header.setFloat64(20, createdAtEpochMs, true);
    writePlaybackMark(header, 28, playStart);
    writePlaybackMark(header, 44, playEnd);
    new Uint8Array(wrapped, CHUNK_HEADER_BYTES).set(new Uint8Array(payload));
    return wrapped;
  }

  function unpackChunk(payload) {
    if (!(payload instanceof ArrayBuffer) || payload.byteLength <= CHUNK_HEADER_BYTES) {
      throw new Error('Invalid received media chunk');
    }
    const header = new DataView(payload);
    if (header.getUint32(0, true) !== CHUNK_MAGIC) throw new Error('Unsupported media chunk format');
    const senderStartTimeMs = header.getFloat64(4, true);
    const senderEndTimeMs = header.getFloat64(12, true);
    const createdAtEpochMs = header.getFloat64(20, true);
    if (!Number.isSafeInteger(senderStartTimeMs) || !Number.isSafeInteger(senderEndTimeMs)
      || senderStartTimeMs < 0 || senderEndTimeMs <= senderStartTimeMs
      || !Number.isFinite(createdAtEpochMs) || createdAtEpochMs <= 0) {
      throw new Error('Invalid received chunk timing');
    }
    return {
      senderStartTimeMs, senderEndTimeMs, createdAtEpochMs,
      playStart: readPlaybackMark(header, 28),
      playEnd: readPlaybackMark(header, 44),
      payload: payload.slice(CHUNK_HEADER_BYTES)
    };
  }

  function reportReceivedChunk(binaryWithHeader, payload, arrivedAtEpochMs) {
    try {
      const chunk = unpackChunk(payload);
      report('remote-call:chunk', {
        binaryId: binaryWithHeader.binaryId,
        order: binaryWithHeader.order,
        senderStartTimeMs: chunk.senderStartTimeMs,
        senderEndTimeMs: chunk.senderEndTimeMs,
        createdAtEpochMs: chunk.createdAtEpochMs,
        arrivedAtEpochMs,
        playStart: chunk.playStart,
        playEnd: chunk.playEnd,
        payload: chunk.payload
      }, [chunk.payload]);
    } catch (error) {
      report('remote-call:error', { message: `${kind} chunk ${binaryWithHeader.order}: ${error.message}` });
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

  function waitForConnection() {
    if (PushcaClient.isOpen()) return Promise.resolve();
    return new Promise(resolve => connectionWaiters.push(resolve));
  }

  async function transmitChunk(message) {
    const wrapped = packChunk(message.payload, message.startTime, message.endTime,
      message.createdAtEpochMs, message.playStart, message.playEnd);
    const payload = encryptionEnabled
      ? await encryptChunk(message.binaryId, message.order, wrapped)
      : wrapped;
    for (;;) {
      await waitForConnection();
      const attemptEpoch = connectionEpoch;
      let result;
      try {
        result = await PushcaClient.transferBinaryChunk(
          message.binaryId, message.order, message.destHashCode, payload
        );
      } catch (error) {
        if (PushcaClient.isOpen() && connectionEpoch === attemptEpoch) throw error;
        continue;
      }
      if (result.type === WaiterResponseType.SUCCESS) return;
      if (PushcaClient.isOpen() && connectionEpoch === attemptEpoch) {
        throw new Error(`${kind} chunk ${message.order} was not delivered.`);
      }
    }
  }

  function pumpSends() {
    while (PushcaClient.isOpen() && activeSends < MAX_ACTIVE_SENDS && sendQueue.length) {
      const message = sendQueue.shift();
      activeSends++;
      void transmitChunk(message)
        .catch(error => report('remote-call:error', { message: `${kind} channel: ${error.message}` }))
        .finally(() => {
          activeSends--;
          pendingSends--;
          pendingBytes -= message.payload.byteLength;
          pumpSends();
        });
    }
  }

  PushcaClient.onOpenHandler = () => {
    connectionEpoch++;
    for (const resolve of connectionWaiters.splice(0)) resolve();
    pumpSends();
    report('remote-call:state', { connected: true });
  };
  PushcaClient.onCloseHandler = () => {
    if (!PushcaClient.isOpen()) report('remote-call:state', { connected: false });
  };
  PushcaClient.onFileTransferChunkHandler = binaryWithHeader => {
    if (encryptionEnabled === null) return;
    const arrivedAtEpochMs = performance.timeOrigin + performance.now();
    if (!encryptionEnabled) {
      reportReceivedChunk(binaryWithHeader, binaryWithHeader.payload, arrivedAtEpochMs);
      return;
    }
    void decryptChunk(binaryWithHeader.binaryId, binaryWithHeader.order, binaryWithHeader.payload).then(payload => {
      reportReceivedChunk(binaryWithHeader, payload, arrivedAtEpochMs);
    }).catch(() => report('remote-call:error', { message: `Could not decrypt ${kind} chunk ${binaryWithHeader.order}.` }));
  };

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.kind !== kind) return;
    const message = event.data;
    if (message.type === 'remote-call:init' && !initialized) {
      if (typeof message.encrypted !== 'boolean'
        || (message.encrypted && (!(message.mediaSecret instanceof Uint8Array) || message.mediaSecret.length !== 32))
        || !['caller', 'receiver'].includes(message.role)) {
        report('remote-call:error', { message: 'Invalid call encryption key.' });
        return;
      }
      initialized = true;
      localRole = message.role;
      encryptionEnabled = message.encrypted;
      cryptoReady = encryptionEnabled
        ? crypto.subtle.importKey('raw', message.mediaSecret, 'HKDF', false, ['deriveBits'])
        : Promise.resolve(null);
      void cryptoReady.then(async () => {
        const client = new ClientFilter('remote-call', 'anonymous-sharing', uuid.v4().toString(), applicationId);
        waitForAlias(client);
        await PushcaClient.openWsConnection(wsUrl, client, connectedClient => {
          const refreshed = new ClientFilter(
            connectedClient.workSpaceId, connectedClient.accountId,
            connectedClient.deviceId, connectedClient.applicationId
          );
          waitForAlias(refreshed);
          return refreshed;
        });
        if (!PushcaClient.isOpen()) report('remote-call:error', { message: `Could not connect ${kind} channel.` });
      }).catch(error => report('remote-call:error', { message: `${kind} channel: ${error.message}` }));
      window.setInterval(() => {
        if (PushcaClient.isOpen()) PushcaClient.sendPing();
      }, 10000);
    }
    if (message.type !== 'remote-call:send' || !initialized) return;
    if (!(message.payload instanceof ArrayBuffer) || !Number.isSafeInteger(message.order)
      || message.order < 0 || !Number.isInteger(message.destHashCode)
      || typeof message.binaryId !== 'string' || !message.binaryId
      || !Number.isSafeInteger(message.startTime) || !Number.isSafeInteger(message.endTime)
      || message.startTime < 0 || message.endTime <= message.startTime
      || !Number.isFinite(message.createdAtEpochMs) || message.createdAtEpochMs <= 0
      || !isPlaybackMark(message.playStart) || !isPlaybackMark(message.playEnd)) return;
    if (message.order <= (lastSentOrders.get(message.binaryId) ?? -1)) {
      report('remote-call:error', { message: `${kind} chunk order was reused.` });
      return;
    }
    if (pendingSends >= MAX_PENDING_SENDS || pendingBytes + message.payload.byteLength > MAX_PENDING_BYTES) {
      report('remote-call:error', { message: `${kind} send queue is full.` });
      return;
    }
    lastSentOrders.set(message.binaryId, message.order);
    pendingSends++;
    pendingBytes += message.payload.byteLength;
    sendQueue.push(message);
    pumpSends();
  });
})();
