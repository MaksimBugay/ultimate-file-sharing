const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../js/remote-call-channel.js'), 'utf8');

for (const kind of ['audio', 'video']) {
  test(`${kind} channel sends successive chunks without waiting for responses`, async () => {
    const sent = [];
    const reports = [];
    const parent = { postMessage: message => reports.push(message) };
    let onMessage;
    const client = {
      isOpen: () => true,
      async openWsConnection() {},
      transferBinaryChunk() { throw new Error('Acknowledged transfer must not be used'); },
      transferBinaryChunkWithoutAcknowledge(...args) { sent.push(args); return { type: 'SUCCESS' }; }
    };
    const context = vm.createContext({
      window: { location: { search: `?kind=${kind}`, origin: 'https://example.test' }, parent,
        addEventListener: (_type, handler) => { onMessage = handler; }, setInterval() {} },
      PushcaClient: client,
      CallableFuture: { async callAsynchronously() { return { type: 'SUCCESS', body: 'alias' }; } },
      ClientFilter: class { hashCode() { return 42; } },
      uuid: { v4: () => 'client-id' },
      WaiterResponseType: { SUCCESS: 'SUCCESS' },
      URLSearchParams, TextEncoder, Uint8Array, ArrayBuffer, DataView,
      performance: { timeOrigin: 1, now: () => 1 }
    });
    vm.runInContext(source, context);
    const dispatch = data => onMessage({ source: parent, origin: 'https://example.test', data: { kind, ...data } });
    dispatch({ type: 'remote-call:init', role: 'caller', encrypted: false });
    for (const order of [0, 1]) {
      dispatch({ type: 'remote-call:send', binaryId: 'binary-id', order, destHashCode: 42,
        startTime: order * 500, endTime: (order + 1) * 500, createdAtEpochMs: 1,
        playStart: null, playEnd: null, payload: new Uint8Array([7, 8]).buffer });
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent.map(args => args[1]), [0, 1]);
    assert.equal(reports.some(message => message.type === 'remote-call:error'), false);
    assert.deepEqual([...new Uint8Array(sent[0][3]).slice(60)], [7, 8]);
    client.onFileTransferChunkHandler({ binaryId: 'binary-id', order: 0, payload: sent[0][3] });
    assert.equal(reports.at(-1).type, 'remote-call:chunk');
    assert.equal(reports.at(-1).createdAtEpochMs, 1);
    assert.equal(reports.at(-1).decryptedAtEpochMs, 2);
    assert.deepEqual([...new Uint8Array(reports.at(-1).payload)], [7, 8]);
    client.onFileTransferChunkHandler({ binaryId: 'binary-id', order: 1, payload: new ArrayBuffer(1) });
    assert.equal(reports.at(-1).type, 'remote-call:error');
    assert.equal(reports.at(-1).scope, 'receive');
    if (kind === 'video') {
      dispatch({ type: 'remote-call:disable-receive' });
      const reportCount = reports.length;
      client.onFileTransferChunkHandler({ binaryId: 'binary-id', order: 2, payload: sent[0][3] });
      assert.equal(reports.length, reportCount, 'disabled video must not parse/decrypt more data');
    }
  });
}
