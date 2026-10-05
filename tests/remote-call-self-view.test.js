const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/remote-call.js'), 'utf8');

// Run the entire app with touch input and no PointerEvent or pointer-capture APIs.
function harness() {
  class Events {
    constructor() { this.handlers = new Map(); }
    addEventListener(type, handler) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type).add(handler);
    }
    removeEventListener(type, handler) { this.handlers.get(type)?.delete(handler); }
    emit(type, properties = {}) {
      const event = { type, cancelable: true, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...properties };
      for (const handler of [...(this.handlers.get(type) || [])]) handler(event);
      return event;
    }
  }
  const elements = new Map();
  const byId = id => {
    if (!elements.has(id)) elements.set(id, Object.assign(new Events(), {
      style: {}, checked: false, value: '100', hidden: false, disabled: false,
      getAttribute: () => 'false', setAttribute() {}, removeAttribute() {},
      querySelector: () => ({ style: {} }), pause() {}, load() {}
    }));
    return elements.get(id);
  };
  const stage = { clientWidth: 360, clientHeight: 500,
    getBoundingClientRect: () => ({ left: 10, top: 100 }) };
  const shell = byId('selfView');
  Object.assign(shell, { parentElement: stage, offsetWidth: 190, offsetHeight: 250,
    getBoundingClientRect: () => ({
      left: stage.getBoundingClientRect().left + parseFloat(shell.style.left ?? '160'),
      top: stage.getBoundingClientRect().top + parseFloat(shell.style.top ?? '240')
    }) });
  const window = Object.assign(new Events(), { location: { search: '' } });
  vm.runInNewContext(source, {
    window, document: { getElementById: byId, querySelectorAll: () => [], addEventListener() {} },
    URLSearchParams, performance: { now: () => 0, timeOrigin: 0 },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, console
  });
  const target = { closest: () => null };
  const point = (x, y, identifier = 7) => ({ clientX: x, clientY: y, identifier });
  const start = (touches) => shell.emit('touchstart', { target, touches });
  const move = (touches) => window.emit('touchmove', { touches });
  const end = (touch, type = 'touchend') => window.emit(type, { changedTouches: [touch] });
  return { shell, window, point, start, move, end,
    click: () => shell.emit('click'),
    position: () => ({ left: parseFloat(shell.style.left), top: parseFloat(shell.style.top) }) };
}

test('touch-only preview drag moves the tile and suppresses scrolling and the resulting click', () => {
  const h = harness();
  h.start([h.point(210, 380)]);
  const move = h.move([h.point(130, 280)]);
  assert.deepEqual(h.position(), { left: 80, top: 140 });
  assert.equal(move.defaultPrevented, true);
  assert.equal(h.end(h.point(130, 280)).defaultPrevented, true);
  assert.equal(h.click().defaultPrevented, true);
  assert.equal(h.shell.style.cursor, '');

  // A fresh tap must still reach the native details toggle.
  assert.equal(h.start([h.point(120, 280)]).defaultPrevented, false);
  assert.equal(h.end(h.point(120, 280)).defaultPrevented, false);
  assert.equal(h.click().defaultPrevented, false);
});

test('touch cancellation releases the tile and allows a new finger drag', () => {
  const h = harness();
  h.start([h.point(210, 380)]);
  h.move([h.point(180, 350)]);
  h.end(h.point(180, 350), 'touchcancel');
  h.move([h.point(100, 200)]);
  assert.deepEqual(h.position(), { left: 130, top: 210 });
  assert.equal(h.shell.style.cursor, '');
  h.start([h.point(180, 350, 19)]);
  h.move([h.point(150, 300, 19)]);
  assert.deepEqual(h.position(), { left: 100, top: 160 });
});

test('touch drag clamps to the stage and follows only the initiating finger', () => {
  const h = harness();
  h.start([h.point(210, 380)]);
  h.end(h.point(210, 380, 99));
  h.move([h.point(-1000, -1000)]);
  assert.deepEqual(h.position(), { left: 8, top: 8 });
  h.move([h.point(1000, 1000)]);
  assert.deepEqual(h.position(), { left: 162, top: 242 });
  h.end(h.point(1000, 1000));
});

test('adding another finger cancels dragging without blocking the next tap', () => {
  const h = harness();
  h.start([h.point(210, 380)]);
  h.move([h.point(180, 350)]);
  h.start([h.point(180, 350), h.point(220, 350, 19)]);
  h.move([h.point(100, 200)]);
  assert.deepEqual(h.position(), { left: 130, top: 210 });
  assert.equal(h.shell.style.cursor, '');
  h.start([h.point(180, 350)]);
  h.end(h.point(180, 350));
  assert.equal(h.click().defaultPrevented, false);
});
