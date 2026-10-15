const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, randomUUID } = require('node:crypto');
const source = fs.readFileSync(require.resolve('../js/remote-call-channel.js'), 'utf8');
const securitySource = fs.readFileSync(require.resolve('../js/security-utils.js'), 'utf8');

function harness(kind, { encrypted = false, role = 'caller', secret = new Uint8Array(32).fill(7) } = {}) {
  const sent = [];
  const reports = [];
  const acknowledgments = [];
  const releasedWaiters = [];
  let finishCallback;
  const handlers = new Map();
  const parent = { postMessage: message => reports.push(message) };
  let connected = true;
  let identity;
  const client = {
    ClientObj: { hashCode: () => 42 },
    isOpen: () => connected,
    async openWsConnection(_url, selected) { identity = selected; },
    sendAcknowledge: id => acknowledgments.push(id),
    stopWebSocketPermanently() {},
    sendRemoteCallFrame(...args) {
      return new Promise(resolve => sent.push({ args, acknowledge: latency => resolve({ type: 'SUCCESS', body: latency }), fail: error => resolve({ type: 'ERROR', body: error }) }));
    }
  };
  const context = vm.createContext({
    window: { atob, btoa, crypto: webcrypto, location: { search: `?kind=${kind}`, origin: 'https://example.test' }, parent,
      addEventListener: (type, handler) => handlers.set(type, handler), setInterval() {}, clearInterval() {} },
    PushcaClient: client,
    CallableFuture: {
      async callAsynchronously() { return { type: 'SUCCESS', body: 'alias' }; },
      releaseWaiterIfExistsWithError(id, error) { releasedWaiters.push(id); sent.at(-1)?.fail(error); }
    },
    ClientFilter: class {
      constructor(workSpaceId, accountId, deviceId, applicationId) { Object.assign(this, { workSpaceId, accountId, deviceId, applicationId }); }
      hashCode() { return 42; }
    },
    uuid: { v4: randomUUID },
    WaiterResponseType: { SUCCESS: 'SUCCESS', ERROR: 'ERROR' },
    BinaryType: { REMOTE_CALL_AUDIO_STREAM: 9, REMOTE_CALL_VIDEO_STREAM: 8 },
    crypto: webcrypto, atob, btoa,
    URLSearchParams, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView,
    setTimeout(callback, delay) { if (delay === 10000) { finishCallback = callback; return {}; } return setTimeout(callback, delay); },
    clearTimeout,
    performance: { timeOrigin: 1800000000000, now: () => 1000 }
  });
  vm.runInContext(securitySource, context);
  vm.runInContext(source, context);
  const dispatch = data => handlers.get('message')({ source: parent, origin: 'https://example.test', data: { kind, ...data } });
  dispatch({ type: 'remote-call:init', role, encrypted, mediaSecret: secret, remoteCallId: 'call-id', clientId: 'participant-id' });
  const send = (index, generation = 0, payload = new Uint8Array([7, 8]).buffer) => dispatch({
    type: 'remote-call:send', binaryId: 'stream-id', order: index * 500 + 5, index, generation,
    independent: true, mimeType: `${kind}/webm`, destHashCode: 42,
    startTime: index * 500 + 5, endTime: (index + 1) * 500 + 5,
    actualRecordingStartTimeMs: 100 + index * 500, createdAtEpochMs: 1800000000000,
    payload
  });
  const receive = frame => client[kind === 'audio' ? 'onRemoteCallAudioStreamHandler' : 'onRemoteCallVideoStreamHandler']({ destClientHash: 42, ...frame });
  return { sent, reports, client, dispatch, send, receive, acknowledgments, releasedWaiters,
    expireFinish: () => finishCallback(),
    setConnected: value => { connected = value; if (value) client.onOpenHandler(); },
    get identity() { return identity; } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('Asynchronous channel operation timed out');
}

for (const kind of ['audio', 'video']) {
  test(`${kind} sends one timestamp-ordered frame at a time and waits for its acknowledgment`, async () => {
    const h = harness(kind);
    h.send(0);
    h.send(1);
    await flush();
    assert.equal(h.sent.length, 1);
    assert.deepEqual([h.identity.workSpaceId, h.identity.accountId, h.identity.deviceId, h.identity.applicationId],
      [`REMOTE_CALL_${kind.toUpperCase()}_STREAM`, 'participant-id', 'participant-id', 'call-id']);
    assert.equal(h.sent[0].args[1], 5, 'wire order must be capture time, not sequence 0');
    assert.equal(h.sent[0].args[4], kind === 'audio' ? 9 : 8);
    h.sent[0].acknowledge(40);
    await flush();
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1].args[1], 505);
    assert.equal(h.sent[0].args[0], 'call-id', 'frame binaryId must route to the shared call');
    assert.equal(h.sent[1].args[0], 'call-id');
    assert.equal(h.sent[0].args[2], 42, 'the header must contain the sender hash');
    h.sent[1].acknowledge(60);
    await flush();
    h.receive({ binaryId: h.sent[0].args[0], order: 5, payload: h.sent[0].args[3] });
    const received = h.reports.at(-1);
    assert.equal(received.type, 'remote-call:chunk');
    assert.equal(received.binaryId, 'stream-id');
    assert.equal(received.order, 5);
    assert.equal(received.index, 0);
    assert.equal(received.senderStartTimeMs, 5);
    assert.equal(received.senderEndTimeMs, 505);
    assert.deepEqual([...new Uint8Array(received.payload)], [7, 8]);
    assert.deepEqual(h.acknowledgments, [`REMOTE_CALL_${kind.toUpperCase()}_STREAM_42_call-id`]);
    assert.equal(h.reports.some(report => report.type === 'remote-call:error'), false);
  });

  for (const burstSize of [5, 101]) {
    test(`${kind} drains a burst of ${burstSize} frames exactly once after sequential ACKs`, async () => {
      const h = harness(kind);
      for (let index = 0; index < burstSize; index++) h.send(index);
      await flush();
      assert.equal(h.sent.length, 1);
      for (let index = 0; index < burstSize; index++) {
        assert.equal(h.sent.length, index + 1, 'only one frame can wait for an ACK');
        h.sent[index].acknowledge(40);
        await flush();
      }
      assert.deepEqual(h.sent.map(send => send.args[1]), Array.from({ length: burstSize }, (_, i) => i * 500 + 5));
      const last = h.reports.filter(report => report.type === 'remote-call:queue').at(-1);
      assert.equal(last.queueSize, 0);
      assert.equal(last.queuedBytes, 0);
      assert.equal(last.activeSend, false);
      assert.equal(h.reports.some(report => report.type === 'remote-call:congestion'), false);
      h.dispatch({ type: 'remote-call:finish' });
      assert.equal(h.reports.find(report => report.type === 'remote-call:finished').count, burstSize);
    });
  }

  test(`${kind} accepts 100 waiting frames, then reduces twice and ${kind === 'audio' ? 'terminates audio' : 'disables video'} on overflow`, async () => {
    const h = harness(kind);
    let index = 0;
    h.send(index++);
    await flush();
    for (let generation = 0; generation < 3; generation++) {
      for (let queued = 0; queued < 100; queued++) h.send(index++, generation);
      let actions = h.reports.filter(report => report.type === 'remote-call:congestion');
      assert.equal(actions.length, generation, '100 waiting frames must not trigger congestion');
      assert.equal(h.reports.filter(report => report.type === 'remote-call:queue').at(-1).queueSize, 100);
      h.send(index++, generation);
      actions = h.reports.filter(report => report.type === 'remote-call:congestion');
      assert.deepEqual(actions.map(report => report.action),
        generation === 2 ? ['reduce', 'reduce', kind === 'audio' ? 'terminate' : 'disable']
          : Array(generation + 1).fill('reduce'));
      assert.equal(h.reports.filter(report => report.type === 'remote-call:queue').at(-1).queueSize, 0);
      if (generation < 2) h.send(index++, generation); // Late frames from the old encoder stay out of SQ.
      h.sent[generation].acknowledge(100);
      await flush();
      if (generation < 2) {
        h.dispatch({ type: 'remote-call:resume', generation: generation + 1 });
        h.send(index++, generation + 1);
        await flush();
      }
    }
    assert.equal(h.sent.length, 3, 'discarded frames must never be transmitted later');
    h.send(index++, 2);
    await flush();
    assert.equal(h.sent.length, 3);
  });

  test(`${kind} monitors the median latency of only the last five acknowledged frames`, async () => {
    const h = harness(kind);
    for (const [index, latency] of [100, 40, 200, 60, 80, 20].entries()) {
      h.send(index);
      await flush();
      h.sent[index].acknowledge(latency);
      await flush();
    }
    assert.equal(h.reports.filter(report => report.type === 'remote-call:queue').at(-1).medianDeliveryLatencyMs, 60);
  });

  for (const encrypted of [false, true]) {
    test(`${kind} averages transmitted size and ACK time over the last five delivered chunks (encrypted=${encrypted})`, async () => {
      const h = harness(kind, { encrypted });
      const samples = [];
      const latest = () => h.reports.filter(report => report.type === 'remote-call:queue').at(-1);
      for (const [index, latencyMs] of [100, 40, 200, 60, 80, 20].entries()) {
        h.send(index, 0, new ArrayBuffer((index + 1) * 1000));
        await until(() => h.sent.length === index + 1);
        assert.equal(latest().deliverySampleCount, Math.min(index, 5), 'in-flight chunks are excluded');
        if (index === 0) {
          assert.equal(latest().averageChunkSizeBytes, null);
          assert.equal(latest().averageDeliveryLatencyMs, null);
        }
        samples.push({ bytes: h.sent[index].args[3].byteLength, latencyMs });
        h.sent[index].acknowledge(latencyMs);
        await flush();
        const window = samples.slice(-5);
        assert.equal(latest().deliverySampleCount, window.length);
        assert.equal(latest().averageChunkSizeBytes, window.reduce((total, sample) => total + sample.bytes, 0) / window.length);
        assert.equal(latest().averageDeliveryLatencyMs, window.reduce((total, sample) => total + sample.latencyMs, 0) / window.length);
      }
      assert.equal(latest().averageDeliveryLatencyMs, 80, 'display uses arithmetic mean, not median');
      assert.equal(latest().medianDeliveryLatencyMs, 60, 'existing transport median is preserved');
      const beforeFailure = latest();
      h.send(6);
      await until(() => h.sent.length === 7);
      h.sent[6].fail('No ACK');
      await flush();
      assert.equal(latest().averageChunkSizeBytes, beforeFailure.averageChunkSizeBytes);
      assert.equal(latest().averageDeliveryLatencyMs, beforeFailure.averageDeliveryLatencyMs);
      assert.equal(latest().deliverySampleCount, 5);
    });
  }

  test(`${kind} encrypted frame authenticates the capture metadata and rejects tampering`, async () => {
    const sender = harness(kind, { encrypted: true });
    const receiver = harness(kind, { encrypted: true, role: 'receiver' });
    sender.send(0);
    await until(() => sender.sent.length === 1);
    const [binaryId, order, , payload] = sender.sent[0].args;
    receiver.receive({ binaryId, order, payload });
    await until(() => receiver.reports.some(report => report.type === 'remote-call:chunk'));
    assert.equal(receiver.reports.find(report => report.type === 'remote-call:chunk').order, 5);
    const altered = payload.slice(0);
    new Uint8Array(altered)[20] ^= 1;
    receiver.receive({ binaryId, order, payload: altered });
    await until(() => receiver.reports.some(report => report.scope === 'receive'));
    assert.match(receiver.reports.at(-1).message, /decrypt/);
    sender.sent[0].acknowledge(25);
  });
}

test('disabled video still acknowledges frames but does not parse or decrypt them', async () => {
  const h = harness('video');
  h.dispatch({ type: 'remote-call:disable-receive' });
  h.receive({ binaryId: 'call-id', order: 0, payload: new ArrayBuffer(1) });
  assert.deepEqual(h.acknowledgments, ['REMOTE_CALL_VIDEO_STREAM_42_call-id']);
  assert.equal(h.reports.some(report => report.type === 'remote-call:chunk' || report.type === 'remote-call:error'), false);
});

test('end-of-call counts describe acknowledged frames and exclude dropped SQ frames', async () => {
  const h = harness('audio');
  h.send(0);
  h.send(1);
  await flush();
  h.dispatch({ type: 'remote-call:finish' });
  assert.equal(h.reports.some(report => report.type === 'remote-call:finished'), false);
  h.sent[0].acknowledge(30);
  await flush();
  h.sent[1].acknowledge(40);
  await flush();
  const finished = h.reports.find(report => report.type === 'remote-call:finished');
  assert.equal(finished.count, 2);
  assert.equal(finished.lastOrder, 505);
});


test('audio and video own separate waiting halls even when their frame binaryId is the same call UUID', async () => {
  const audio = harness('audio');
  const video = harness('video');
  audio.send(0);
  video.send(0);
  await flush();
  audio.send(1);
  video.send(1);
  audio.sent[0].acknowledge(30);
  await flush();
  assert.equal(audio.sent.length, 2);
  assert.equal(video.sent.length, 1, 'an audio ACK must not release video');
  video.sent[0].acknowledge(40);
  await flush();
  assert.equal(video.sent.length, 2);
  audio.sent[1].acknowledge(30);
  video.sent[1].acknowledge(40);
});

for (const kind of ['audio', 'video']) {
  test(`${kind} acknowledgments use the received sender hash, including negative hashes`, async () => {
    const h = harness(kind);
    h.send(0);
    await flush();
    h.receive({ binaryId: 'call-id', order: 5, destClientHash: -314159, payload: h.sent[0].args[3] });
    assert.deepEqual(h.acknowledgments, [`REMOTE_CALL_${kind.toUpperCase()}_STREAM_-314159_call-id`]);
    h.sent[0].acknowledge(20);
  });

  test(`${kind} acknowledges delivery before rejecting a different call or peer`, async () => {
    const h = harness(kind);
    await flush();
    h.dispatch({ type: 'remote-call:set-peer', client: {
      workSpaceId: `REMOTE_CALL_${kind.toUpperCase()}_STREAM`,
      accountId: 'peer-id', deviceId: 'peer-id', applicationId: 'call-id'
    } });
    h.receive({ binaryId: 'call-id', order: 5, destClientHash: -314159, payload: new ArrayBuffer(1) });
    h.receive({ binaryId: 'different-call-id', order: 5, destClientHash: 42, payload: new ArrayBuffer(1) });
    assert.deepEqual(h.acknowledgments, [
      `REMOTE_CALL_${kind.toUpperCase()}_STREAM_-314159_call-id`,
      `REMOTE_CALL_${kind.toUpperCase()}_STREAM_42_different-call-id`
    ]);
    assert.equal(h.reports.some(report => report.type === 'remote-call:chunk'), false,
      'transport delivery ACKs must not bypass call and peer validation');
    assert.equal(h.reports.some(report => report.type === 'remote-call:error'), false);
  });

  test(`${kind} drain timeout releases the scoped sender acknowledgment waiter`, async () => {
    const h = harness(kind);
    h.send(0);
    await flush();
    h.dispatch({ type: 'remote-call:finish' });
    h.expireFinish();
    await flush();
    assert.deepEqual(h.releasedWaiters, [`REMOTE_CALL_${kind.toUpperCase()}_STREAM_42_call-id`]);
    assert.equal(h.reports.find(report => report.type === 'remote-call:finished').count, 0);
    assert.equal(h.reports.some(report => report.type === 'remote-call:error'), false);
  });
}
