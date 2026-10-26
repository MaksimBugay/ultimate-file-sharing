const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const futureSource = fs.readFileSync(require.resolve('../js/callable-future.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(path) {
  const source = fs.readFileSync(require.resolve(path), 'utf8');
  const start = source.indexOf('PushcaClient.sendRemoteCallFrame');
  const end = source.indexOf('PushcaClient.transferBinaryChunk', start);
  assert.ok(start >= 0 && end > start, `Missing method in ${path}`);
  const method = source.slice(start, end).replace(/[,;\s]+$/, '') + ';';
  const sent = [];
  const headers = [];
  const timeouts = [];
  let now = 100;
  const client = { ws: { send: bytes => sent.push(bytes) }, async restoreBrokenWsConnection() {} };
  const context = vm.createContext({
    PushcaClient: client, window: { location: { href: 'https://example.test' } },
    isEmpty: value => value == null,
    BinaryType: { REMOTE_CALL_AUDIO_STREAM: 9, REMOTE_CALL_VIDEO_STREAM: 8 },
    buildPushcaBinaryHeader(...args) { headers.push(args); return new Uint8Array([args[0], 0]); },
    performance: { now: () => now },
    setTimeout(callback, delay) { timeouts.push(delay); return setTimeout(callback, delay).unref(); },
    ArrayBuffer, Uint8Array, console: { log() {} }
  });
  vm.runInContext(futureSource, context);
  vm.runInContext(method, context);
  return { client, sent, headers, timeouts, future: vm.runInContext('CallableFuture', context),
    advance: delta => { now += delta; } };
}

for (const path of ['../js/pnotifications.js', '../js/pushca.min.js']) {
  for (const [name, type] of [['REMOTE_CALL_AUDIO_STREAM', 9], ['REMOTE_CALL_VIDEO_STREAM', 8]]) {
    test(`${path}: ${name} requires the workspace, sender hash and call UUID ACK`, async () => {
      const h = harness(path);
      let completed = false;
      const result = h.client.sendRemoteCallFrame('call-id', 500, -314159, new Uint8Array([7, 8]).buffer, type);
      void result.then(() => { completed = true; });
      await flush();
      const id = `${name}_-314159_call-id`;
      assert.deepEqual(Array.from(h.future.waitingHall.keys()), [id]);
      assert.deepEqual(h.timeouts, [3000], 'preserve the user-selected ACK timeout');
      assert.deepEqual(h.headers, [[type, -314159, true, 'call-id', 500]]);
      assert.equal(h.sent.length, 1);
      assert.deepEqual([...new Uint8Array(h.sent[0])], [type, 0, 7, 8]);
      assert.equal(h.future.releaseWaiterIfExistsWithSuccess('call-id', 'legacy ACK'), false);
      assert.equal(h.future.releaseWaiterIfExistsWithSuccess(`${name}_42_call-id`, 'another sender'), false);
      await flush();
      assert.equal(completed, false);
      h.advance(37);
      assert.equal(h.future.releaseWaiterIfExistsWithSuccess(id, 'ACK'), true);
      const response = await result;
      assert.equal(response.type, 'SUCCESS');
      assert.equal(response.body, 37);
      assert.equal(h.future.waitingHall.size, 0);
    });
  }

  test(`${path}: simultaneous audio/video sends use independent waiting halls and scoped ACKs`, async () => {
    const audio = harness(path);
    const video = harness(path);
    let videoCompleted = false;
    const audioResult = audio.client.sendRemoteCallFrame('call-id', 0, 42, new ArrayBuffer(1), 9);
    const videoResult = video.client.sendRemoteCallFrame('call-id', 0, 43, new ArrayBuffer(1), 8);
    void videoResult.then(() => { videoCompleted = true; });
    await flush();
    const audioId = 'REMOTE_CALL_AUDIO_STREAM_42_call-id';
    const videoId = 'REMOTE_CALL_VIDEO_STREAM_43_call-id';
    assert.notEqual(audio.future.waitingHall, video.future.waitingHall);
    assert.equal(video.future.releaseWaiterIfExistsWithSuccess(audioId, 'ACK'), false);
    assert.equal(audio.future.releaseWaiterIfExistsWithSuccess(audioId, 'ACK'), true);
    assert.equal((await audioResult).type, 'SUCCESS');
    assert.equal(videoCompleted, false);
    assert.equal(video.future.waitingHall.has(videoId), true);
    assert.equal(video.future.releaseWaiterIfExistsWithSuccess(videoId, 'ACK'), true);
    assert.equal((await videoResult).type, 'SUCCESS');
  });
}
