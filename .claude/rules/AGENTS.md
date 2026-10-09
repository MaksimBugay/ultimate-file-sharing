---
apply: always
---

# AI assistant rules

Apply these rules to all work in this project. The goal is correct, readable,
minimal interview solutions that the developer can explain and defend.
Explicit challenge requirements and developer instructions take precedence.

## Project context

- Read the challenge, relevant implementation, tests, `README.md`, `CLAUDE.md`, and the pages that load the affected script before editing.
- This is a framework-free browser project: plain HTML, vanilla JavaScript, and CSS, with no bundler or transpiler. Preserve the `js/`, `css/`, `html/`, and `tests/` layout.
- Keep changes within the relevant page or feature. Preserve public globals, function signatures, wire/message formats, and `postMessage` contracts that other pages, iframes, embedded sites, or the backend rely on.
- Use dependencies from `package.json` for tooling and the vendored libraries in `js/` for runtime; do not add runtime packages from npm or new CDNs without asking.

## JavaScript best practices

- Write modern ES2020+ code that runs natively in current browsers without a build step. Follow the style of the file being edited: IIFE with `'use strict'` in newer modules, global functions and `Object.freeze` enums in older ones.
- Use `const` by default, `let` when reassigning, never `var`. Use strict equality (`===`/`!==`) and explicit `null`/`undefined` handling.
- Do not leak new globals; keep module state inside the IIFE or an existing namespace object such as `FileSharing` or `PushcaClient`.
- Use `async`/`await` with explicit error handling; never leave a promise floating without a `catch` or an intentional comment. Clear timers, intervals, event listeners, object URLs, media tracks, and WebSocket/MediaSource resources when they are no longer needed.
- Treat all external data (URL parameters, `postMessage` events, WebSocket payloads, file names, clipboard content) as untrusted: validate `event.origin` and message shape, and insert text with `textContent` or sanitize HTML with `DOMPurify`; never build HTML from untrusted strings with `innerHTML`.
- Use the Web Crypto API for cryptography and `crypto.getRandomValues`/`crypto.randomUUID` for secrets and identifiers; never `Math.random` for security-relevant values.
- Keep pages working on mobile and in embedded/in-app browsers; feature-detect APIs (File System Access, MediaRecorder MIME types, Clipboard, AudioWorklet) instead of sniffing user agents.
- Do not edit vendored or generated `*.min.js` files by hand. After changing a bundled source, rebuild the bundle with the recipe in `create-min-js-command`, and bump the `?v=` cache-busting version on pages that use fixed versions.

## Clarify uncertainty before committing to a solution

- Establish inputs, outputs, constraints, edge cases, and acceptance criteria from the prompt and tests.
- If uncertainty could change correctness, the algorithm, public API, concurrency behavior, or dependency compatibility, ask the developer a focused question before implementing the affected part.
- Explain what is unclear, the meaningful alternatives, and your recommendation. Continue independent investigation while awaiting the answer.
- If you cannot justify why the chosen solution meets the constraints after inspecting code and documentation, state the uncertainty and ask; do not hide it behind a confident implementation.
- For low-impact, reversible details such as private names, follow local conventions and proceed. State assumptions that affect observable behavior.
- Do not invent requirements or silently resolve conflicts between the prompt, tests, and implementation.

## Search and reuse before generating code

- Before adding a class, method, algorithm, validation rule, or dependency, search for equivalent behavior with `rg` or IDE symbol/text search.
- Inspect candidate implementations, their callers, and tests to verify semantics, edge cases, and suitability; matching names alone are insufficient.
- Prefer suitable existing project code, then standard-library facilities, then existing dependencies, before writing new code or adding a dependency. Respect exercises that require implementing the algorithm yourself.
- Extend an existing implementation when it owns the same responsibility. Extract shared code only when actual callers share the same contract.
- Keep shared helpers at the narrowest useful scope. Do not couple unrelated exercises or break a standalone submission merely to reuse similar lines.

## Duplication guards

- Before editing, identify existing implementations of the behavior being changed; after editing, search again for copied logic and near-duplicates.
- Keep each shared business rule, invariant, and configuration value in one authoritative place. Update callers instead of copying and modifying an implementation.
- Treat a second implementation of the same rule as a review trigger: reuse or extract it, or explain why the contracts require separation.
- Similar syntax alone does not justify an abstraction. Preserve intentional alternative algorithms and readable test cases; explain intentional duplication when relevant.
- Run an existing duplication checker when available. If automated enforcement is requested, use a JavaScript-compatible detector such as `jscpd`, excluding vendored and generated `*.min.js` files, review existing findings separately, and fail on new unexplained duplication.
- Never hide findings by weakening thresholds or adding blanket exclusions. A manual search is a review guard, not proof that all duplication is absent.

## Apply SOLID with minimal design

- **Single responsibility:** Give each class or module one cohesive responsibility and reason to change. Separate algorithm/domain logic from input/output and infrastructure when both are present.
- **Open/closed:** Use an existing extension point for a required variation. Introduce a new strategy or abstraction only for demonstrated variation; ordinary fixes can modify existing code.
- **Liskov substitution:** Implementations must preserve their contract, including accepted inputs, results, exceptions, and invariants. Avoid inheritance that introduces unsupported operations or stronger preconditions.
- **Interface segregation:** Keep interfaces focused on what their clients need. Do not force callers or implementations to depend on unrelated methods.
- **Dependency inversion:** Keep domain decisions independent of infrastructure details. Pass external collaborators through constructors or parameters, using small contracts at real boundaries; avoid hidden global dependencies.
- Prefer composition over inheritance and pure functions for algorithmic work. A small function or concrete class can be the complete solution.
- Do not create an interface for every class, a dependency injection framework, extra architectural layers, or speculative extension points just to demonstrate SOLID.

## Latest secure dependencies

- Add a dependency only when the required behavior cannot reasonably use existing code, Web Platform APIs, or Node.js built-ins.
- Whenever adding or updating a dependency or tool, verify the latest stable release from its official release documentation and the npm registry (`npm view <pkg> version`) at implementation time. Never choose a version from model memory alone.
- Select the latest stable, maintained release compatible with the supported browsers, the installed Node.js version, and challenge constraints. Check publisher advisories and a current vulnerability database such as OSV or NVD for known vulnerabilities, including transitive dependencies.
- Do not introduce a dependency with a known applicable vulnerability. Find a fixed release or alternative; if neither is viable, explain the blocker and ask the developer.
- Pin exact versions in `package.json` (`npm install --save-exact`) and commit `package-lock.json`; for vendored browser libraries, record the exact version in the file name or header. Do not use `latest`, `*`, broad ranges, or prereleases unless explicitly required.
- Inspect the resolved dependency tree (`npm ls`) after dependency changes and run `npm audit` or another available vulnerability scanner. Record sources and the check date; a newer release or clean scan does not guarantee security.
- If the newest release requires a breaking migration or conflicts with an explicit version constraint, explain the conflict and ask the developer before proceeding with that migration or an exception. Flag outdated dependencies encountered without expanding an unrelated task into a repository-wide upgrade.
- If release or advisory checks are unavailable, explicitly report that freshness/security is unverified. Do not invent scan results or describe an unverified dependency as secure.

## Build the smallest complete solution

- Implement only the requested behavior and necessary edge-case handling. Avoid speculative features, generic frameworks, unrelated cleanup, and premature optimization.
- Choose the simplest algorithm that satisfies the stated input limits. Be ready to explain correctness and time/space complexity.
- Match local style, use clear names, and keep comments focused on reasoning or non-obvious invariants.
- For behavior changes, add focused tests for the contract, boundaries, and meaningful failure cases; include a regression test for a bug fix. Avoid tests that merely mirror implementation details.
- Run focused tests with `node --test tests/relevant.test.js`, replacing `relevant.test.js` with actual test files. Run `node --test tests/` for shared-code, bundle, or dependency changes, and check syntax of edited scripts with `node --check <file>`.
- Tests run browser scripts in `node:vm` with stubbed DOM and network APIs; follow that pattern. Behavior that depends on real browser APIs (media, WebSocket, layout) also needs a manual browser check; if one was not possible, report it.
- Inspect the final diff for unnecessary code, duplication, SOLID violations, and accidental changes. Do not claim checks passed unless they actually ran successfully.
- Finish with a brief explanation of the solution, reused code, relevant complexity, tests run, and unresolved assumptions or verification gaps. Stop when the requirement is satisfied.

# Deployment scripts

- For SSH multiplexing, create a short private directory directly under `/tmp`, for example `control_dir="$(mktemp -d /tmp/pvf.XXXXXX)"`, and use a short socket name: `control_socket="$control_dir/s"`.
- Never derive the SSH control socket path from `$TMPDIR`. macOS uses long `/var/folders/...` paths, and OpenSSH appends a temporary random suffix that can exceed the Unix socket path limit.
- Keep cleanup in an `EXIT` trap: close the master connection, remove its socket, and remove the private temporary directory.
- When changing control socket setup, check Bash syntax and test actual Unix socket creation with OpenSSH's temporary suffix and a long `TMPDIR`. Syntax checks alone do not detect this path length failure.
