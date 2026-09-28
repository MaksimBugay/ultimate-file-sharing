(() => {
  'use strict';

  const kind = new URLSearchParams(window.location.search).get('kind');
  if (kind !== 'audio' && kind !== 'video') return;

  const parentOrigin = window.location.origin;
  const applicationId = `REMOTE-CALL-${kind.toUpperCase()}`;
  const wsUrl = 'wss://secure.fileshare.ovh:31085';
  let initialized = false;
  let aliasAttempt = 0;
  let pendingSends = 0;
  let sendTail = Promise.resolve();

  function report(type, fields = {}, transfer = []) {
    window.parent.postMessage({ type, kind, ...fields }, parentOrigin, transfer);
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

  PushcaClient.onOpenHandler = () => report('remote-call:state', { connected: true });
  PushcaClient.onCloseHandler = () => {
    if (!PushcaClient.isOpen()) report('remote-call:state', { connected: false });
  };
  PushcaClient.onFileTransferChunkHandler = binaryWithHeader => {
    const payload = binaryWithHeader.payload;
    report('remote-call:chunk', {
      binaryId: binaryWithHeader.binaryId,
      order: binaryWithHeader.order,
      payload
    }, [payload]);
  };

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.kind !== kind) return;
    const message = event.data;
    if (message.type === 'remote-call:init' && !initialized) {
      initialized = true;
      const client = new ClientFilter('remote-call', 'anonymous-sharing', uuid.v4().toString(), applicationId);
      waitForAlias(client);
      void PushcaClient.openWsConnection(wsUrl, client, connectedClient => {
        const refreshed = new ClientFilter(
          connectedClient.workSpaceId,
          connectedClient.accountId,
          connectedClient.deviceId,
          connectedClient.applicationId
        );
        waitForAlias(refreshed);
        return refreshed;
      }).then(() => {
        if (!PushcaClient.isOpen()) report('remote-call:error', { message: `Could not connect ${kind} channel.` });
      }).catch(error => report('remote-call:error', { message: `${kind} channel: ${error.message}` }));
      window.setInterval(() => {
        if (PushcaClient.isOpen()) PushcaClient.sendPing();
      }, 10000);
    }
    if (message.type !== 'remote-call:send' || !initialized) return;
    if (!(message.payload instanceof ArrayBuffer) || !Number.isSafeInteger(message.order)
      || !Number.isInteger(message.destHashCode) || typeof message.binaryId !== 'string') return;
    if (pendingSends >= 16) {
      report('remote-call:error', { message: `${kind} send queue is full.` });
      return;
    }
    pendingSends++;
    sendTail = sendTail.then(async () => {
      const result = await PushcaClient.transferBinaryChunk(
        message.binaryId, message.order, message.destHashCode, message.payload
      );
      if (result.type !== WaiterResponseType.SUCCESS) {
        report('remote-call:error', { message: `${kind} chunk ${message.order} was not delivered.` });
      }
    }).catch(error => report('remote-call:error', { message: `${kind} channel: ${error.message}` }))
      .finally(() => { pendingSends--; });
  });
})();
