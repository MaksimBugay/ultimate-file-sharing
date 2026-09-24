# ultimate-file-sharing
share any file from you machine in two clicks 

## Chunked camera recorder

Open `video-recorder.html` through HTTPS or localhost. Allow camera and microphone access, then start recording. The page records separate video-only and audio-only segments of about five seconds each. When recording stops, click **Replay video + audio** to play matching segments in order. One visible player shows the camera and replay video; a hidden audio element plays each matching audio segment. Use the replay controls below the player to pause, mute, or adjust the audio volume. Replay keeps the segments separate rather than joining them into one binary.

After recording stops and the final chunks finish, click **Save video file** and choose a destination. Click **Save audio file** afterward and choose a destination for the second file. The saved files are ordinary media files, with extensions chosen from the browser's recording format: `.webm`, `.mp4`, or `.ogg` for audio. They open directly in media players such as IINA. Browsers without the File System Access save picker use their normal download behavior.

The page also keeps individually playable five-second video and audio segments in memory. A continuous recorder runs alongside those segment recorders so the saved files have a valid, uninterrupted media container. Segment boundaries can have small gaps because each standalone segment starts a fresh encoder; the saved continuous files avoid those gaps. The recording remains in memory until the tab closes.

To convert the two saved files into one MP4 with FFmpeg, run a command such as:

```sh
ffmpeg -i recording-video.webm -i recording-audio.webm -c:v libx264 -c:a aac recording.mp4
```

Replace the input extensions if your browser saved MP4 or Ogg instead. You can extract any five-second range from the video with `ffmpeg -ss 5 -t 5 -i recording-video.webm -c copy video-chunk.webm`.

### Earlier `.ufsrec` files

Files saved by the first version of this page are indexed archives, so a media player cannot open them directly. Extract their standalone segments with Node.js:

```sh
node tools/extract-ufsrec.mjs old-video.ufsrec video-chunks
node tools/extract-ufsrec.mjs old-audio.ufsrec audio-chunks
```

The extractor creates numbered playable chunks and FFmpeg concat lists. To turn those earlier chunks into a single MP4:

```sh
ffmpeg -f concat -safe 0 -i video-chunks/video.ffconcat -f concat -safe 0 -i audio-chunks/audio.ffconcat -c:v libx264 -c:a aac recording.mp4
```
