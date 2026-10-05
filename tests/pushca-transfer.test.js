const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(path) {
  const source = fs.readFileSync(require.resolve(path), 'utf8');
  const start = source.indexOf('PushcaClient.transferBinaryChunkWithoutAcknowledge');
  assert.ok(start >= 0, `Missing method in ${path}`);
  const end = source.indexOf('PushcaClient.restoreBrokenWsConnection', start);
  const method = source.slice(start, end).replace(/[,;\s]+$/, '') + ';';
  const sent = [];
  const headers = [];
  const client = { ws: { readyState: 1, send: bytes => sent.push(bytes) } };
  const context = vm.createContext({
    PushcaClient: client, window: { WebSocket: { OPEN: 1 } },
    isEmpty: value => value == null,
    BinaryType: { FILE_TRANSFER: 3 },
    buildPushcaBinaryHeader(...args) { headers.push(args); return new Uint8Array([3, 0]); },
    WaiterResponseType: { SUCCESS: 'SUCCESS', ERROR: 'ERROR' },
    WaiterResponse: class { constructor(type, body) { Object.assign(this, { type, body }); } },
    CallableFuture: { callAsynchronouslyWithRepeatOfFailure() { throw new Error('Must not wait for a response'); } },
    setTimeout() { throw new Error('Must not schedule a timeout'); },
    ArrayBuffer, Uint8Array, console: { error() {} }
  });
  vm.runInContext(method, context);
  return { client, sent, headers };
}

for (const path of ['../js/pnotifications.js', '../js/pushca.min.js']) {
  test(`${path}: sends successive chunks immediately without acknowledgement waiters`, () => {
    const h = harness(path);
    for (const order of [0, 1]) {
      const result = h.client.transferBinaryChunkWithoutAcknowledge('binary-id', order, 42, new Uint8Array([7, 8]).buffer);
      assert.equal(result.type, 'SUCCESS');
      assert.equal(typeof result.then, 'undefined');
    }
    assert.deepEqual(h.headers, [[3, 42, false, 'binary-id', 0], [3, 42, false, 'binary-id', 1]]);
    assert.equal(h.sent.length, 2);
    assert.deepEqual([...new Uint8Array(h.sent[0])], [3, 0, 7, 8]);
  });

  test(`${path}: reports missing, closed, and failing sockets`, () => {
    const h = harness(path);
    const socket = h.client.ws;
    h.client.ws = null;
    assert.equal(h.client.transferBinaryChunkWithoutAcknowledge('id', 0, 42, new ArrayBuffer(1)).type, 'ERROR');
    h.client.ws = socket;
    socket.readyState = 3;
    assert.equal(h.client.transferBinaryChunkWithoutAcknowledge('id', 0, 42, new ArrayBuffer(1)).type, 'ERROR');
    socket.readyState = 1;
    const error = new Error('Socket write failed');
    socket.send = () => { throw error; };
    const result = h.client.transferBinaryChunkWithoutAcknowledge('id', 0, 42, new ArrayBuffer(1));
    assert.equal(result.type, 'ERROR');
    assert.equal(result.body, error);
    assert.equal(h.sent.length, 0);
  });
}
