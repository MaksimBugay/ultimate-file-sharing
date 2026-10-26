const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/remote-call.js'), 'utf8');
const parser = source.slice(source.indexOf('  function readVint('), source.indexOf('  function monoFrame('));
const masterIds = source.match(/ {2}const WEBM_MASTER_IDS = new Set\(\[[\s\S]*?]\);/)[0];
const api = {};
vm.runInNewContext(`${masterIds}\n${parser}\nObject.assign(api, { WebmOpusParser, prepareAudioPlaybackFrame, opusPacketDurationUs, readVint });`, {
  api, Uint8Array, DataView, MAX_PLAYBACK_QUEUED_DURATION_MS: 30000, FRAME_REORDER_WAIT_MS: 500
});

// Synthetic, silent WebM with eight 60 ms Opus packets. No captured microphone data.
// Fixture elements fit in a one-byte EBML size, independently of the production writer.
function fixture({ track = 1, codec = 'A_OPUS', finite = false, codecDelayNs = 0, discardPadding = false, laced = false } = {}) {
  const element = (id, body) => {
    body = Buffer.from(body);
    assert.ok(body.length < 127);
    return Buffer.concat([Buffer.from(id), Buffer.from([0x80 | body.length]), body]);
  };
  const list = (id, children) => element(id, Buffer.concat(children));
  const opusHead = Buffer.from([79, 112, 117, 115, 72, 101, 97, 100, 1, 1, 0, 0, 128, 187, 0, 0, 0, 0, 0]);
  const sampleRate = Buffer.alloc(8);
  sampleRate.writeDoubleBE(48000);
  const delay = Buffer.alloc(8);
  delay.writeBigUInt64BE(BigInt(codecDelayNs));
  const header = list([0x1a, 0x45, 0xdf, 0xa3], [
    element([0x42, 0x86], [1]), element([0x42, 0xf7], [1]), element([0x42, 0xf2], [4]),
    element([0x42, 0xf3], [8]), element([0x42, 0x82], Buffer.from('webm')),
    element([0x42, 0x87], [4]), element([0x42, 0x85], [2])
  ]);
  const info = list([0x15, 0x49, 0xa9, 0x66], [element([0x2a, 0xd7, 0xb1], [15, 66, 64])]);
  const tracks = list([0x16, 0x54, 0xae, 0x6b], [list([0xae], [
    element([0xd7], [track]), element([0x73, 0xc5], [1]), element([0x83], [2]),
    element([0x86], Buffer.from(codec)), element([0x63, 0xa2], opusHead), element([0x56, 0xaa], delay),
    list([0xe1], [element([0xb5], sampleRate), element([0x9f], [1])])
  ])]);
  const blocks = Array.from({ length: 8 }, (_, index) => {
    const body = Buffer.from([0x80 | track, index * 60 >> 8, index * 60 & 255, laced ? 0x82 : 0x80,
      0xfb, 3, 0xff, 0xfe, 0xff, 0xfe, 0xff, 0xfe]);
    return index === 7 && discardPadding
      ? list([0xa0], [element([0xa1], body), element([0x75, 0xa2], [1, 49, 45, 0])])
      : element([0xa3], body);
  });
  const cluster = list([0x1f, 0x43, 0xb6, 0x75], [element([0xe7], [0]), ...blocks]);
  const body = Buffer.concat([info, tracks, cluster]);
  const segmentSize = Buffer.alloc(8, 255);
  if (finite) segmentSize.writeBigUInt64BE(BigInt(body.length));
  segmentSize[0] = 1;
  return new Uint8Array(Buffer.concat([header, Buffer.from([0x18, 0x53, 0x80, 0x67]), segmentSize, body]));
}

const parse = bytes => {
  const parser = new api.WebmOpusParser();
  const packets = parser.push(bytes);
  return { parser, packets };
};

test('Opus packet durations follow the TOC for SILK, hybrid, CELT and multi-frame packets', () => {
  for (const [bytes, durationUs] of [
    [[0], 10000], [[0x18], 60000], [[0x60], 10000], [[0x68], 20000],
    [[0xe0], 2500], [[0xe8], 5000], [[0xf0], 10000], [[0xf8, 255, 254], 20000],
    [[0xf9], 40000], [[0xfa], 40000], [[0xfb, 3], 60000], [[0xfb, 6], 120000]
  ]) assert.equal(api.opusPacketDurationUs(new Uint8Array(bytes)), durationUs);
  for (const bytes of [[], [0xfb], [0xfb, 0], [0xfb, 7]]) {
    assert.throws(() => api.opusPacketDurationUs(new Uint8Array(bytes)), /Invalid Opus/);
  }
});

test('a 480 ms recording fills its 500 ms capture slot without changing received packets or history bytes', () => {
  const binary = fixture();
  const original = binary.slice();
  const before = parse(binary).packets;
  assert.equal(before.length, 8);
  const padded = api.prepareAudioPlaybackFrame(binary, 500);
  const after = parse(padded).packets;
  assert.deepEqual(binary, original);
  assert.equal(after.length, 9);
  assert.deepEqual(Array.from(after, packet => packet.timestampUs), [0, 60000, 120000, 180000, 240000, 300000, 360000, 420000, 480000]);
  for (let i = 0; i < before.length; i++) assert.deepEqual(after[i].data, before[i].data);
  assert.deepEqual(Array.from(after.at(-1).data), [0xf8, 0xff, 0xfe]);
});

test('irregular capture ends have silence coverage for sample-accurate MSE window trimming', () => {
  const packets = parse(api.prepareAudioPlaybackFrame(fixture(), 503)).packets;
  assert.equal(packets.length, 10);
  assert.deepEqual(Array.from(packets.slice(-2), packet => packet.timestampUs), [480000, 500000]);
  assert.equal(parse(api.prepareAudioPlaybackFrame(fixture(), 503)).parser.hasDiscardPadding, false);
});

test('a small boundary gap adds a prefix and preserves the original capture timestamps and audio track', () => {
  const binary = fixture({ track: 3 });
  const packets = parse(api.prepareAudioPlaybackFrame(binary, 500, 1)).packets;
  assert.equal(packets[0].timestampUs, -20000);
  assert.equal(packets[1].timestampUs, 0);
  assert.ok(packets.every(packet => packet.trackNumber === 3));
  assert.deepEqual(Array.from(packets[0].data), [0xf8, 0xff, 0xfe]);
  assert.deepEqual(packets[1].data, parse(binary).packets[0].data);
});

test('extending a finite Segment changes only the playback copy and keeps valid initialization', () => {
  const binary = fixture({ finite: true });
  const original = binary.slice();
  const padded = api.prepareAudioPlaybackFrame(binary, 500);
  let offset = 0;
  while (offset < padded.length) {
    const id = api.readVint(padded, offset, true);
    const size = api.readVint(padded, offset + id.length, false);
    if (id.value === 0x18538067) { assert.equal(size.unknown, true); break; }
    offset += id.length + size.length + size.value;
  }
  assert.deepEqual(binary, original);
  assert.equal(parse(padded).parser.codecId, 'A_OPUS');
});

test('existing container DiscardPadding is removed so the capture window trims samples once', () => {
  const binary = fixture({ discardPadding: true });
  assert.equal(parse(binary).parser.hasDiscardPadding, true);
  const padded = api.prepareAudioPlaybackFrame(binary, 500);
  assert.equal(parse(padded).parser.hasDiscardPadding, false);
  const before = parse(binary).packets;
  const after = parse(padded).packets;
  for (let i = 0; i < before.length; i++) assert.deepEqual(after[i].data, before[i].data);
});

test('codec delay is included when determining the required silence coverage', () => {
  const padded = api.prepareAudioPlaybackFrame(fixture({ codecDelayNs: 6500000 }), 480);
  const { parser, packets } = parse(padded);
  assert.equal(parser.codecDelayUs, 6500);
  assert.equal(packets.at(-1).timestampUs, 480000);
});

test('codec priming does not suppress the prefix for a small gap between capture slots', () => {
  const padded = api.prepareAudioPlaybackFrame(fixture({ codecDelayNs: 6500000 }), 503, 1);
  const { packets } = parse(padded);
  assert.equal(packets[0].timestampUs, -20000);
  assert.equal(packets[1].timestampUs, 0);
});

test('already complete frames and other supported byte paths remain untouched', () => {
  for (const binary of [fixture(), fixture({ codec: 'A_VORBIS' }), fixture({ laced: true }), new Uint8Array(8)]) {
    assert.equal(api.prepareAudioPlaybackFrame(binary, 480), binary);
  }
});

test('invalid metadata cannot create an unbounded amount of synthetic padding', () => {
  assert.throws(() => api.prepareAudioPlaybackFrame(fixture(), 60000), /capture gap exceeds/);
  assert.throws(() => api.prepareAudioPlaybackFrame(fixture(), 500, 1000), /boundary gap exceeds/);
});
