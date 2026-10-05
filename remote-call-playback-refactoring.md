# Call playback refactoring report

Implemented the receiver changes requested in `replay_refactoring.txt`.

Files changed:

- `js/remote-call.js`: independent playback pipelines, delay observation, diagnostics, queue bounds, remote finish handling, and the audio element used by echo cancellation and conversation recording.
- `js/remote-call-channel.js`: receive/decrypt completion diagnostics, errors scoped to the receiving stream, and local video reception disabling.
- `js/remote-call-connection.js`: routing receive errors to the affected pipeline and a local iframe control for disabling video reception.
- `remote-call.html`: remote `<audio>`, blue/red warning borders, Disable video, a video placeholder, and script cache versions.
- `remote-call-channel.html`: channel script cache version.
- `tests/remote-call-playback.test.js`: 21 new playback regression scenarios.
- `tests/remote-call-channel.test.js`: additional receive metadata/error and video-disable checks.
- `tests/remote-call-flow.test.js`: receive-error isolation in an established encrypted call.
- This report.

The old `MseReplayPlayer.progress()` required a common audio/video range at startup, used a shared minimum buffered end, and paused one combined video/audio element whenever either track lacked data. Its `syncHold`, common-buffer searches, shared playhead, and shared completion conditions could repeatedly hold back both streams. `LocalChunkLink` also kept an unbounded queue upstream of the byte-limited receiver.

Each `MediaPlaybackPipeline` now owns its element, sequence-indexed inbox, MediaSource, SourceBuffer, append/remove operation, playback state, timer, errors, and timestamp metadata. Audio plays through `<audio>`; video plays through a muted `<video>`. Enqueue and `updateend` immediately drive only that pipeline. Playback starts at its first available range, without a startup buffer target. A 100 ms fallback pump services that stream's buffer maintenance. Missing indexes wait within their own stream; subsequent WebM continuation chunks are retained in order, never speculatively skipped.

Source completion is independent, including when final chunks of the other stream are missing. Aggregation remains only to finish the optional conversation recording and enable saved conversation replay. Capture shutdown still awaits both recorders; this does not schedule incoming playback.

For each append, metadata records the previous and resulting MSE buffered endpoints, chunk index, creation, arrival, decrypt completion, queue, and append timestamps. The playing chunk is selected using its element's `currentTime`, rather than the latest received or appended chunk. At a stalled buffered endpoint, the last consumed range remains observable and its age increases.

Delay observation now uses relative call time. The sender already supplies `senderStartTimeMs` and `senderEndTimeMs`, measured with `performance.now()` from its recording start. The receiver measures elapsed time from its own recording start. The legacy `createdAtEpochMs` wire field remains for protocol compatibility, but it does not participate in delay calculation. For both streams, independently:

```text
playingCaptureTimeMs = senderStartTimeMs + offsetInsideAppendedRangeSeconds * 1000
receiverElapsedCallTimeMs = performance.now() - localRecordingStartTime
playbackDelayMs = max(0, receiverElapsedCallTimeMs - playingCaptureTimeMs)
```

Creation, delivery, decrypt completion, queue, and append diagnostics are expressed in milliseconds relative to the corresponding peer's call start. Arrival/decrypt timestamps are converted using the receiver's local performance time origin and recording start, without subtracting a remote epoch timestamp. The player establishes a provisional local origin while START is in flight, then aligns it with recording start and adjusts any early local timestamps. Call time continues advancing after local recording stops, so the remaining remote buffered playback can still be observed.

This removes device wall-clock offsets and wall-clock adjustments from warning decisions. The two peers still start recording at slightly different times: the resulting estimate can be biased by that startup gap. No clock synchronization or signaling exchange was added. A/V differences share the same local origin, while playback remains independent.

A stream without a mapped playable range, or a disabled/finished stream, reports unknown delay. MSE append boundaries give an approximation at chunk granularity: blobs can split container elements, capture callbacks can be late, and `currentTime` does not measure physical speaker output latency.

The monitor samples every 250 ms and only updates diagnostics/UI. A stream enters its delayed state above 3000 ms and recovers strictly below 2500 ms. Delayed audio produces AUDIO_DELAYED/red, with priority over delayed video. Otherwise delayed video produces VIDEO_DELAYED/blue; otherwise NORMAL. A/V delay difference is diagnostic only. Queue durations, bytes/counts, buffered-ahead, playback positions, waiting indexes, failures, and playing/appended chunk timestamps are available through `RemoteCallMedia.getPlaybackDiagnostics()` and `getReceivedChunkTiming()`. There are no per-frame production logs.

Disable video closes only the video pipeline, aborts/detaches its SourceBuffer, clears queues/metadata, releases MSE references and its object URL, and replaces the video element with a placeholder. A local parent-to-iframe control stops accepting/decrypting further video data; pending decrypt results are ignored. Audio, its object URL, Web Audio route, and the connected call remain intact. There is no existing sender-side video-subscription control to reuse, so no new peer signaling was introduced.

Receiver queues are bounded independently by 8 MiB audio / 32 MiB video, 256 chunks, and 30 seconds of pending media (one larger chunk is allowed within the byte/count limits). Overflow explicitly stops the affected stream and exposes its failure; it does not silently drop undecodable chunks or move backlog upstream. Historical media is trimmed using only that element's playhead. The existing 12-second append ceiling is retained as an upper bound, not a playback target. No additional jitter buffer was introduced.

Validation: `node --test tests/*.test.js` passes all 50 tests, including caller/callee clocks five seconds apart, different page ages, positive/negative sender clock offsets of one day, and wall-clock jumps during playback. JavaScript syntax checks and `git diff --check` pass. Tests cover normal delivery, one-second video delay, either stream delayed/missing, a video stall, independent SourceBuffer availability, reordered/missing indexes, BLUE/RED priority, strict hysteresis boundaries, currently playing timestamp interpolation, bounded queues, video failures/disable cleanup, autoplay gestures, and independent source completion. Existing encryption, transport, startup, and conversation recording tests remain passing.

The deterministic acceptance test advances five minutes of simulated wall/media time, with normal audio delivery and progressively late/jittery video delivery. It uses mocked asynchronous SourceBuffers and the complete public receiver path; it is not a five-minute physical-network/browser test. All sampled queues were empty; audio had no pause calls, no failure, and no inherited video delay:

| Wall time | Audio delay (ms) | Video delay (ms) | Audio queue (ms) | Video queue (ms) | Audio ahead (ms) | Video ahead (ms) | State |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 10 s | 550 | 759 | 0 | 0 | 50 | 259 | NORMAL |
| 60 s | 550 | 1543 | 0 | 0 | 50 | 43 | NORMAL |
| 180 s | 550 | 3447 | 0 | 0 | 50 | 447 | VIDEO_DELAYED |
| 300 s | 550 | 5351 | 0 | 0 | 50 | 351 | VIDEO_DELAYED |

Before the relative-time correction, Chromium 154.0.8037.98 was also checked using real MediaRecorder Opus/VP8 chunks, synthesized silent audio and canvas video, with delayed local delivery. A short test verified the actual blue border at approximately 4.05 seconds of video delay, then verified that disabling video retained the same audio object URL, uninterrupted audio playhead progression, zero audio pause events, no pipeline errors, and NORMAL recovery. A separate 30-second progressively delayed video audit observed:

| Wall time | Audio delay (ms) | Video delay (ms) | State |
| --- | ---: | ---: | --- |
| 5 s | 1195 | 1833 | NORMAL |
| 10 s | 1197 | 2465 | NORMAL |
| 20 s | 1190 | 3747 | VIDEO_DELAYED |
| 29 s | 1194 | 4947 | VIDEO_DELAYED |

Remaining latency mechanisms are local to a stream: slow delivery or reconnect retries, missing indexes, capture/conversion/encryption taking longer than production, slow SourceBuffer operations, and browser/decoder/audio-context underruns. In the real browser audit, early audio `waiting`/`playing` events occurred before five seconds with an empty receiver queue; audio delay then remained near 1.19 seconds. Progressively delayed video repeatedly underran its own media element and accumulated video delay. No larger buffering or skipping was added to conceal these effects. Existing fatal transport/session errors can still end the call under its established connection-management policy; receive/decode errors now stop only their affected playback stream.

Verified: there is no remaining playback code path in which audio waits for video or video waits for audio. Delay monitoring is observational only and cannot block either playback pipeline.

The relative-time correction was verified with the Node regression suite, JavaScript syntax checking, and IDE inspections. Browser testing of this correction is left to the user as requested.
