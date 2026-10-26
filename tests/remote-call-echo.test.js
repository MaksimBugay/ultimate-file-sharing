const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/remote-call.js'), 'utf8');
const builder = source.slice(source.indexOf('  async function buildEchoReference('), source.indexOf('  function queueEchoReference('));
const referenceConstants = Array.from(source.matchAll(/^ {2}const ECHO_REFERENCE_(?:CHUNKS|SCAN_RATE) = \d+;/gm), match => match[0]).join('\n');
const context = vm.createContext({ Float32Array, CHUNK_MS: 500 });
vm.runInContext(`${referenceConstants}\n${builder}\nglobalThis.buildReference = buildEchoReference;`, context);

function history(count, { duration = 500, gap = 0 } = {}) {
  const chunks = Array.from({ length: count }, (_, index) => ({
    order: index * (duration + gap), startTime: index * (duration + gap),
    endTime: index * (duration + gap) + duration, id: index
  }));
  const decodes = [];
  return {
    chunks, decodes,
    async decode(first, last, fromMs, toMs) {
      decodes.push({ first, last, fromMs, toMs });
      return chunks.slice(first, last + 1).map(chunk => ({
        startMs: chunk.startTime, endMs: chunk.endTime, sampleRate: 1000,
        samples: new Float32Array(duration).fill(chunk.id + 1)
      }));
    }
  };
}

const timing = order => ({ order, senderStartTimeMs: order, senderEndTimeMs: order + 500 });

test('echo reference contains the closest saved audio chunk and its three predecessors in capture order', async () => {
  const reference = history(8);
  const result = await context.buildReference(reference, timing(2510), 1000);
  assert.deepEqual(reference.decodes, [{ first: 2, last: 5, fromMs: 1000, toMs: 3000 }]);
  assert.equal(result.startMs, 2510);
  assert.equal(result.endMs, 3010);
  assert.equal(result.referenceStartMs, 1000);
  assert.equal(result.samples.length, 2000);
  for (let index = 0; index < 4; index++) {
    assert.ok(result.samples.slice(index * 500, (index + 1) * 500).every(sample => sample === index + 3));
  }
});

for (const count of [1, 2, 3]) {
  test(`echo reference uses the ${count} available chunks near the start of a call`, async () => {
    const reference = history(count);
    const result = await context.buildReference(reference, timing((count - 1) * 500), 1000);
    assert.equal(result.referenceStartMs, 0);
    assert.equal(result.samples.length, count * 500);
    assert.deepEqual(reference.decodes, [{ first: 0, last: count - 1, fromMs: 0, toMs: count * 500 }]);
  });
}

test('equidistant orders keep the earlier chunk and never include future history', async () => {
  const reference = history(6);
  const result = await context.buildReference(reference, timing(1750), 1000);
  assert.equal(reference.decodes[0].last, 3);
  assert.equal(result.samples.at(-1), 4);
  assert.equal(result.samples.length, 2000);
});

test('audio gaps stay silent inside the composed reference without shifting later chunks', async () => {
  const reference = history(4, { duration: 400, gap: 100 });
  const result = await context.buildReference(reference, timing(1500), 1000);
  assert.equal(result.samples.length, 1900);
  assert.equal(result.samples[399], 1);
  assert.ok(result.samples.slice(400, 500).every(sample => sample === 0));
  assert.equal(result.samples[500], 2);
  assert.equal(result.samples[1899], 4);
});

test('the composed reference is resampled over all four chunks rather than trimmed to the incoming chunk', async () => {
  const reference = history(4);
  const before = reference.chunks.map(chunk => ({ ...chunk }));
  const result = await context.buildReference(reference, timing(1500), 2000);
  assert.equal(result.samples.length, 4000);
  assert.equal(result.samples[0], 1);
  assert.equal(result.samples[999], 1);
  assert.equal(result.samples[1000], 2);
  assert.equal(result.samples[3999], 4);
  assert.deepEqual(reference.chunks, before, 'own recording history must remain unchanged');
});

test('unavailable, too-distant, and empty decoded audio references are skipped', async () => {
  const reference = history(4);
  assert.equal(await context.buildReference(history(0), timing(0), 1000), null);
  assert.equal(await context.buildReference(reference, timing(2001), 1000), null);
  assert.equal(reference.decodes.length, 0);
  reference.decode = async () => [];
  assert.equal(await context.buildReference(reference, timing(1500), 1000), null);
});

const workletSource = fs.readFileSync(require.resolve('../js/remote-call-echo-worklet.js'), 'utf8');

function processorHarness(sampleRate = 48000) {
  let Processor;
  class AudioWorkletProcessor { constructor() { this.port = {}; } }
  const context = vm.createContext({
    AudioWorkletProcessor, Float32Array, sampleRate, currentTime: 0,
    registerProcessor(name, processor) { assert.equal(name, 'remote-call-echo'); Processor = processor; }
  });
  vm.runInContext(workletSource, context);
  const processor = new Processor();
  let frame = 0;
  return {
    processor, sampleRate,
    message(data) { processor.port.onmessage({ data }); },
    render(input) {
      context.currentTime = frame / sampleRate;
      const output = new Float32Array(input.length);
      processor.process([[input]], [[output]]);
      frame += input.length;
      return output;
    }
  };
}

function signal(length, seed = 17) {
  const samples = new Float32Array(length);
  let previous = 0;
  for (let i = 0; i < length; i++) {
    seed = seed * 48271 % 2147483647;
    previous = previous * 0.75 + (seed / 2147483647 - 0.5) * 0.4;
    samples[i] = previous;
  }
  return samples;
}

function referenceMessage(samples, sampleRate, startMs = 3000, referenceStartMs = 1500) {
  const scanStride = Math.max(1, Math.floor(sampleRate / 3000));
  const scanSamples = new Float32Array(Math.floor(samples.length / scanStride));
  for (let i = 0; i < scanSamples.length; i++) {
    let sum = 0;
    for (let j = 0; j < scanStride; j++) sum += samples[i * scanStride + j];
    scanSamples[i] = sum / scanStride;
  }
  return { type: 'reference', startMs, endMs: startMs + 500, referenceStartMs, samples, scanSamples, scanStride };
}

for (const delayMs of [0, 500, 1000, 1490, 1107.3333333333333]) {
  test(`the processor finds and suppresses an echo ${delayMs} ms earlier in the four-chunk reference`, () => {
    const h = processorHarness();
    const own = signal(h.sampleRate * 4);
    h.message(referenceMessage(own.slice(h.sampleRate * 1.5, h.sampleRate * 3.5), h.sampleRate));
    h.message({ type: 'clock', mediaMs: 3000, contextTime: 0, playing: true });
    let inputPower = 0;
    let outputPower = 0;
    for (let at = 0; at < h.sampleRate * 0.48; at += 128) {
      const input = Float32Array.from({ length: 128 }, (_, i) => own[Math.round((3000 - delayMs) * h.sampleRate / 1000) + at + i] * 0.5);
      const output = h.render(input);
      if (at > h.sampleRate * 0.3) {
        for (let i = 0; i < input.length; i++) { inputPower += input[i] ** 2; outputPower += output[i] ** 2; }
      }
    }
    assert.ok(Math.abs(h.processor.referenceOffsetMs + delayMs) < 1000 / h.sampleRate,
      `estimated offset ${h.processor.referenceOffsetMs} ms`);
    assert.ok(Math.sqrt(outputPower / inputPower) < 0.4, 'matching echo must receive the existing attenuation');
  });
}

test('unrelated incoming audio remains audible while the entire four-chunk reference is searched', () => {
  const h = processorHarness();
  const own = signal(h.sampleRate * 2);
  const remote = signal(Math.ceil(h.sampleRate * 0.5), 123456);
  h.message(referenceMessage(own, h.sampleRate));
  h.message({ type: 'clock', mediaMs: 3000, contextTime: 0, playing: true });
  for (let at = 0; at < h.sampleRate * 0.48; at += 128) {
    const input = remote.slice(at, at + 128);
    assert.deepEqual(h.render(input), input);
  }
});

for (const sampleRate of [8000, 44100, 48000, 96000]) {
  test(`reference scanning bounds sample comparisons per render block at ${sampleRate} Hz`, () => {
    const h = processorHarness(sampleRate);
    const samples = signal(h.sampleRate * 2);
    h.message(referenceMessage(samples, h.sampleRate));
    h.message({ type: 'clock', mediaMs: 3000, contextTime: 0, playing: true });
    const original = h.processor.correlationAt.bind(h.processor);
    let compared = 0;
    let scanned = false;
    h.processor.correlationAt = (reference, offset, query) => {
      compared += query.samples.length;
      return original(reference, offset, query);
    };
    for (let block = 0; block < 200; block++) {
      compared = 0;
      h.render(samples.slice(block * 128 % samples.length, block * 128 % samples.length + 128));
      scanned ||= compared > 0;
      assert.ok(compared <= 32768, `unbounded render work: ${compared} sample comparisons`);
    }
    assert.ok(scanned);
  });
}

test('reset discards reference audio, an in-progress search, and learned delay', () => {
  const h = processorHarness();
  h.message(referenceMessage(signal(h.sampleRate * 2), h.sampleRate));
  h.message({ type: 'clock', mediaMs: 3000, contextTime: 0, playing: true });
  h.processor.referenceOffsetMs = -1000;
  h.processor.suppressionGain = 0.25;
  h.message({ type: 'reset' });
  const input = new Float32Array(128).fill(0.3);
  assert.deepEqual(h.render(input), input);
  assert.equal(h.processor.segments.length, 0);
  assert.equal(h.processor.search, null);
  assert.equal(h.processor.referenceOffsetMs, 0);
  assert.equal(h.processor.historyLength, 0);
});
