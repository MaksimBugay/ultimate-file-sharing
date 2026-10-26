const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/remote-call.js'), 'utf8');
const scheduler = source.slice(source.indexOf('  const captureClock = '),
  source.indexOf('  async function checkAudioRecorder'));

function harness({ unavailable = false, constructionFails = false } = {}) {
  let now = 1234;
  let nextId = 0;
  const timers = new Map();
  const objects = new Map();
  const revoked = [];
  const workers = [];
  const mainOrigin = 1000000;
  const workerOrigin = mainOrigin - 99999;
  const schedule = (callback, delay, owner = null) => {
    const due = now + Math.max(0, delay);
    const id = ++nextId;
    // Model the one-second alignment of a background window's timers.
    timers.set(id, { callback, at: owner ? due : Math.ceil(due / 1000) * 1000, owner });
    return id;
  };
  class Worker {
    constructor(url) {
      if (constructionFails) throw new Error('Worker blocked');
      workers.push(this);
      this.context = vm.createContext({
        performance: { timeOrigin: workerOrigin, now: () => mainOrigin + now - workerOrigin },
        setTimeout: (callback, delay) => schedule(callback, delay, this),
        clearTimeout: id => timers.delete(id),
        postMessage: data => this.onmessage?.({ data })
      });
      // Execute the actual worker code, using a different monotonic origin.
      vm.runInContext(objects.get(url), this.context);
    }
    postMessage(data) { this.lastMessage = data; this.context.onmessage({ data }); }
    terminate() {
      this.terminated = true;
      for (const [id, timer] of timers) if (timer.owner === this) timers.delete(id);
    }
  }
  const context = vm.createContext({
    window: { Worker: unavailable ? undefined : Worker },
    performance: { timeOrigin: mainOrigin, now: () => now },
    Blob: class { constructor(parts) { this.source = parts.join(''); } },
    URL: {
      createObjectURL(blob) { const url = `blob:test-${objects.size}`; objects.set(url, blob.source); return url; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    setTimeout: (callback, delay) => schedule(callback, delay),
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(`${scheduler}\nglobalThis.clock = captureClock;`, context);
  return {
    clock: context.clock, workers, revoked,
    now: () => now,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= target);
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
    pending: () => timers.size
  };
}

test('hidden-tab recording starts at the agreed monotonic deadline across worker clock origins', () => {
  const h = harness();
  const start = h.now() + 5000;
  let actualStart = null;
  h.clock.schedule(() => { actualStart = h.now(); }, start);
  h.advance(4999);
  assert.equal(actualStart, null);
  h.advance(1);
  assert.equal(actualStart, start);
  h.clock.close();
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.revoked.length, 1);
});

test('hidden-tab capture keeps half-second frame boundaries on the same worker', () => {
  const h = harness();
  const boundaries = [];
  const frame = () => { boundaries.push(h.now()); h.clock.schedule(frame, h.now() + 500); };
  h.clock.schedule(frame, h.now() + 500);
  h.advance(2000);
  assert.deepEqual(boundaries, [1734, 2234, 2734, 3234]);
  assert.equal(h.workers.length, 1);
  h.clock.close();
  assert.equal(h.pending(), 0);
});

test('canceling an agreed start ignores a queued worker message', () => {
  const h = harness();
  let starts = 0;
  const id = h.clock.schedule(() => { starts++; }, h.now() + 5000);
  const worker = h.workers[0];
  h.clock.cancel(id);
  worker.onmessage({ data: id });
  h.advance(6000);
  assert.equal(starts, 0);
  h.clock.close();
});

test('closing capture cancels pending starts and a new call gets a fresh worker', () => {
  const h = harness();
  let canceledStarts = 0;
  h.clock.schedule(() => { canceledStarts++; }, h.now() + 5000);
  h.clock.close();
  h.advance(6000);
  assert.equal(canceledStarts, 0);
  let newStarts = 0;
  h.clock.schedule(() => { newStarts++; }, h.now() + 500);
  h.advance(500);
  assert.equal(newStarts, 1);
  assert.equal(h.workers.length, 2);
  h.clock.close();
  assert.equal(h.revoked.length, 2);
});

for (const options of [{ unavailable: true }, { constructionFails: true }]) {
  test(`unavailable worker falls back without starting early (${Object.keys(options)[0]})`, () => {
    const h = harness(options);
    const start = h.now() + 500;
    let actualStart = null;
    h.clock.schedule(() => { actualStart = h.now(); }, start);
    h.advance(500);
    assert.equal(actualStart, null);
    h.advance(266);
    assert.ok(actualStart >= start);
    h.clock.close();
    assert.equal(h.pending(), 0);
    if (options.constructionFails) assert.equal(h.revoked.length, 1);
  });
}

test('worker failure preserves pending deadlines and fires each callback once', () => {
  const h = harness();
  const start = h.now() + 500;
  const starts = [];
  h.clock.schedule(() => starts.push(h.now()), start);
  h.workers[0].onerror();
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.revoked.length, 1);
  h.advance(500);
  assert.deepEqual(starts, []);
  h.advance(1000);
  assert.equal(starts.length, 1);
  assert.ok(starts[0] >= start);
  h.clock.close();
});
