# Secure FileShare (ultimate-file-sharing)

Static front end for **https://secure.fileshare.ovh**: browser-to-browser file sharing, file
transfer, encrypted video calls, and CAPTCHA widgets. There is no build system or framework
here: plain HTML + vanilla JS (global functions/objects, or IIFE modules in newer code) +
CSS, served by nginx from `/data/nginx-pusher/data` on the server. The backend is the
**Pushca** WebSocket/binary relay at `wss://secure.fileshare.ovh:31085` (not in this repo).

## Commands

- Tests: `node --test tests/` (Node's built-in runner, no deps; ~105 tests, all fast).
  Single file: `node --test tests/remote-call-playback.test.js`.
- Minified bundles: built by hand with `terser` (`npm install` gives a local copy, so use
  `npx terser`). The exact file lists and flags for every bundle are in `create-min-js-command`
  — run from `js/`. **After editing any source file that is part of a bundle, rebuild that
  bundle**; pages load the bundle, not the sources.
- Deploy: `deploy-*.sh` scripts `scp` specific files to `root@148.251.49.213` using
  `~/.ssh/pushca-backend.key` (override with `SSH_KEY` / `DEPLOY_HOST`). They touch production —
  only run when asked. `tmp.txt` holds ad-hoc scp snippets.

## Pages (repo root) → main scripts

| Page | Purpose | Scripts |
|---|---|---|
| `index.html` | Landing page (product links, demo video dialogs) | `landing.js`, `landing.css` |
| `file-sharing-embedded.html` | Current file-sharing app (upload → shareable link, password/CAPTCHA protection, expiry) | `file.sharing.min.js` bundle (source: `file-sharing-embedded.js` + commons, thumbnails, `binary-chunks-db.js`), `datetime-picker.js`, `url-input.js` |
| `file-transfer-embedded.html` | Current device-to-device transfer app (virtual host / QR, paste, drag & drop) | `pushca.file-transfer.min.js` bundle (source: `transfer-site.js`, `transfer-commons.js`, `localization.js`, …), `file-transfer-embedded-theme.css` |
| `file-transfer.html` | Older transfer page loading unminified sources | same sources as above |
| `remote-call.html` | Encrypted 1:1 video call | `pushca.min.js`, `remote-call-connection.js`, `remote-call-conversation.js`, `remote-call.js` |
| `remote-call-channel.html` | Hidden iframe, one per media kind (`?kind=audio` or `?kind=video`) | `remote-call-channel.js` |
| `public-binary*.html`, `public-content.html` | Viewer/downloader for a publicly shared file (optionally CAPTCHA-gated) | `shared-binary.js`, `public-binary.js`, `validate-human-token.js`, `similarity-captcha-integration.js` |
| `protected-binary*.html` | Viewer for a password-protected file | `protected-binary-commons.js`, `protected-binary-ws.js` / `-ex.js`, `credentials-db.js` |
| `main.html` | Promo/demo widget page | `main.js`, `demo-widget.js` |
| `*captcha*.html`, `test.html`, `embedded-dynamic-captcha-demo.html` | Puzzle / similarity / dynamic CAPTCHA widgets and demos | `puzzle-captcha.js`, `similarity-captcha.js`, `embedded-similarity-captcha.js`, `dynamic-captcha.js` |
| `binary-ping-demo.html` | Backend binary-ping demo | `backend.binary(.silent).ping.min.js` |
| `video-recorder.html` | Standalone chunked camera recorder experiment (see `README.md`) | `video-recorder.js` |
| `ufshm.html`, `secure-file-share-old.html`, `index-bk.html`, `ufshm-new.html` | Legacy file-sharing manager (jQuery/Bootstrap, ag-grid) | `ws-connection.js`, `add-binary-popup.js`, `transfer-file.js`, `save-in-cloud.js`, … |

Other: `html/` header/footer/popup fragments, `privacy/`, `manual/` (user docs + PDF),
`background.js` (Chrome extension service worker that opens the site), `sitemap.xml`,
`robots.txt`, `file-sharing-manifest.json` (PWA manifest).

## Shared JS core (`js/`)

- `pnotifications.js` — `PushcaClient`: WebSocket client, commands/channels, binary send,
  reconnect. Base URL `https://secure.fileshare.ovh`.
- `pushca-binary-helper.js` — binary protocol: `BinaryType`, `BinaryManifest`, datagrams,
  `buildPushcaBinaryHeader`, chunk storage/upload.
- `security-utils.js` (crypto/encryption; protected files whose encryption contract carries
  `v: PASSWORD_VERIFIER_VERSION` store a salted PBKDF2 password verifier, older ones a SHA-256 —
  `calculatePasswordHash` picks the right one), `common-utils.js`, `callable-future.js`
  (async waiters with retries), `owner-signature.js`, `device-secret.js`, `gateway-server.js`
  (handles gateway requests such as join-transfer-group / signature verification).
- `transfer-verification.js` — optional 2FA for direct transfers (off by default, toggle
  `#receiverVerificationToggle`): the handshake request carries a `commitment`, the receiver answers
  with a `nonce` (and a `proof` once paired), the sender reveals its nonce by message
  (`transfer-verification::reveal::`) and both pages show an 8-digit code; after the sender confirms,
  the pages stay paired for the session. Transfer RSA keys are one non-extractable pair per page
  (`getTransferKeyPair` in `transfer-commons.js`).
- `binary-chunks-db.js`, `credentials-db.js` — IndexedDB storage.
- `thumbnail-*.js` — image/video/text thumbnails for shared files.
- Vendored libraries (never edit): `fp.min.js`, `detect.min.js`, `client.min.js`,
  `uuid.min.js`, `qrcode.min.js`, `jsQR.js`, `purify.min.js`, `jszip.min.js`,
  `ag-grid-community.min.js`.
- Generated bundles (rebuild, don't hand-edit): `pushca.min.js`, `pushca.file-transfer.min.js`,
  `file.sharing.min.js`, `puzzle.captcha.min.js`, `similarity.captcha.min.js`,
  `similarity.challenge.min.js`, `backend.binary(.silent).ping.min.js`.

## Remote call architecture

- `remote-call-connection.js` — signalling over Pushca (`PROTOCOL = 'REMOTE_CALL_V10'`, apps
  `REMOTE-CALL-MANAGER/VIDEO/AUDIO`), invite link, optional media encryption; creates one hidden
  `remote-call-channel.html` iframe per media kind and talks to it with `postMessage`.
  Key exchange: the receiver sends a fresh non-extractable RSA-OAEP public key in JOIN; the caller
  wraps a random secret in OFFER. A `link-key` in the joint link `#fragment` (never sent to the
  server) authenticates JOIN (`keyProof` HMAC) and is mixed into HKDF, so the relay cannot swap keys;
  OFFER and later control signals are HMAC-signed. 2FA codes use commit-then-reveal (JOIN carries
  `commitment`, OFFER the caller `nonce`, REVEAL the receiver nonce) so a relay cannot grind codes.
- `remote-call-channel.js` — per-kind WebSocket connection, HKDF-derived encryption, 60-byte
  chunk header (`"RCM6"` magic, sender start/end times, playback marks).
- `remote-call.js` — capture (MediaRecorder, default 500 ms chunks, `?chunkSeconds=` override),
  independent audio/video MSE playback pipelines, delay monitoring, self-view widget.
- `remote-call-echo-worklet.js` — AudioWorklet spectral echo suppression.
- `remote-call-conversation.js` — optional conversation recording of the live playback.
- Design notes: `remote-call-playback-refactoring.md` (and the source brief `replay_refactoring.txt`).
  Changing the wire format needs both the connection and channel side updated together.

## Tests

`tests/*.test.js` load browser scripts as text and run them in `node:vm` contexts with
hand-written DOM/WebSocket stubs (some extract a single method by string slicing, e.g.
`pushca-transfer.test.js` checks the same method in both `pnotifications.js` and the
`pushca.min.js` bundle — so a stale bundle fails it). Follow that pattern for new tests.

## Conventions and gotchas

- Many HTML files use `?v=<?= time(); ?>` PHP-style cache busters; newer pages use explicit
  version strings (e.g. `?v=20261008-...`, `?v=remote-call-10`). **Bump the `?v=` on any
  script/CSS you change** in pages that use fixed versions, or browsers serve stale files.
- Pages that must work when embedded on other sites reference absolute
  `https://secure.fileshare.ovh/js/...` URLs.
- Newer code: IIFE + `'use strict'`, `const` UI element maps, no globals leaked. Older code:
  global functions and `Object.freeze` enums. Match the style of the file you edit.
- `backups/` holds timestamped manual snapshots of redesign iterations and `artifacts/` holds
  promo-video production sources (Python `render.py`, timelines, subtitles); final videos are
  copied to `videos/`. Neither is loaded by the site.
- Deploy scripts with SSH multiplexing must follow `AGENTS.md` (short control socket path under
  `/tmp`, never `$TMPDIR`; cleanup in an `EXIT` trap).

## Mandatory rules

Always follow these rules for all work in this project:

@.claude/rules/AGENTS.md
