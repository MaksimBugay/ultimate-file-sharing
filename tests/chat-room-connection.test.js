const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/chat-room.js'), 'utf8');
const start = source.indexOf('    // Pushca registers the client');
const end = source.indexOf('    function start(params)');
assert.ok(start >= 0 && end > start, 'Connection functions not found in chat-room.js');
const constants = source.match(/const OPEN_CONNECTION_URL[^\n]+\n\s+const RECONNECT_DELAYS_MS[^\n]+\n/)[0];

// Runs the page's connection functions against a fake REST endpoint, socket and timers.
function harness(responses) {
  const requests = [];
  const timers = [];
  const statuses = [];
  const client = { isOpen: () => false, ClientObj: { accountId: 'anna', refreshed: 0 }, opened: [] };
  client.openWebSocket = (onOpen, onError) => client.opened.push({ url: client.wsUrl, onError });
  const context = vm.createContext({
    PushcaClient: client, JSON, Object, Math, Error, console: { error() {} },
    isMobile: () => false,
    refreshClientObj: obj => ({ ...obj, refreshed: obj.refreshed + 1 }),
    setStatus: state => statuses.push(state),
    window: { setTimeout: (callback, ms) => timers.push({ callback, ms }) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const response = responses.shift();
      return { ok: response.ok !== false, status: response.status || 200, json: async () => response.body };
    }
  });
  vm.runInContext(`${constants}let reconnectTimer = null; let reconnectAttempt = 0; let connecting = false;\n`
    + source.slice(start, end) + '\nthis.connect = connect;', context);
  return { client, requests, timers, statuses, connect: context.connect };
}

// Timer callbacks start connect() without awaiting it.
const settle = () => new Promise(resolve => setImmediate(resolve));
const ok = url => ({ body: { browserAdvertisedUrl: url, pusherInstanceId: 'node-1' } });

test('connects with the WebSocket URL from the REST open-connection endpoint', async () => {
  const h = harness([ok('wss://node-1/ws/abc')]);
  await h.connect();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://secure.fileshare.ovh/pushca/open-connection');
  assert.equal(h.requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(h.requests[0].options.body),
    { client: { accountId: 'anna', refreshed: 0 }, mobile: false, pusherInstanceId: null, apiKey: null });
  assert.deepEqual(h.client.opened.map(socket => socket.url), ['wss://node-1/ws/abc']);
  assert.equal(h.client.pusherInstanceId, 'node-1');
});

test('a failed request is retried with growing delays and a refreshed client', async () => {
  const h = harness([{ ok: false, status: 429 }, { ok: false, status: 503 }, ok('wss://node-2/ws')]);
  await h.connect();
  assert.equal(h.client.opened.length, 0);
  assert.deepEqual(h.timers.map(timer => timer.ms), [1000]);
  h.timers[0].callback();
  await settle();
  assert.deepEqual(h.timers.map(timer => timer.ms), [1000, 2000]);
  h.timers[1].callback();
  await settle();
  assert.deepEqual(h.client.opened.map(socket => socket.url), ['wss://node-2/ws']);
  assert.equal(JSON.parse(h.requests[2].options.body).client.refreshed, 1);
  assert.deepEqual(h.statuses, ['reconnecting', 'reconnecting']);
});

test('a socket error schedules a reconnect through the REST endpoint again', async () => {
  const h = harness([ok('wss://node-1/ws'), ok('wss://node-1/ws2')]);
  await h.connect();
  h.client.opened[0].onError();
  h.client.opened[0].onError(); // close after error: still one pending reconnect
  assert.equal(h.timers.length, 1);
  h.timers[0].callback();
  await settle();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.client.opened.map(socket => socket.url), ['wss://node-1/ws', 'wss://node-1/ws2']);
});

test('only one connection attempt runs at a time', async () => {
  const h = harness([ok('wss://node-1/ws')]);
  await Promise.all([h.connect(), h.connect()]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.client.opened.length, 1);
});
