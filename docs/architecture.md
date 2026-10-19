# Twirly architecture

(Working title was "Obsidian"; that name now only refers to the dark theme.)

## Stack decisions

| Concern | Choice | Why |
|---|---|---|
| Shell | Electron 44 | Required. Chromium's built-in OLE `IDropTarget` is what makes the Explorer integration possible without native drop code (see `native-integration.md`). |
| Build | electron-vite (Vite 8) | One config for main, preload and renderer; fast HMR; bundles `packages/*` via aliases. |
| Packaging | **electron-builder** (NSIS) | Mature NSIS installer with per-user install (no admin), `asarUnpack` for sharp's native binaries, `extraResources` for the .NET helper. Forge's Vite plugin is less mature and its Squirrel installer gives less control over uninstall cleanup (registry verbs). |
| UI | React 19, Tailwind 4, Motion, Lucide, Zustand | Required stack. |
| IPC validation | zod | Every IPC payload is parsed in main before use. |
| Images | sharp (libvips) | PNG/JPEG/WebP/AVIF/TIFF/GIF in the prebuilt binary. BMP is not in libvips: decode via FFmpeg (when present), encode with our own small BMP writer. HEIC (HEVC) is **not** in sharp's prebuilt libvips: not advertised. |
| PDF | pdf-lib (structure edits) + pdf.js (render/thumbnails/text, in the renderer) | pdf-lib cannot render; pdf.js cannot write. |
| Audio/video | FFmpeg/FFprobe **bundled** as separate executables (`resources/ffmpeg`, fetched by `npm run ffmpeg:fetch`); falls back to PATH | GPL build shipped unmodified next to the MIT app, with its licence and source links. Codecs are detected at runtime (`ffmpeg -encoders`). |
| Documents | LibreOffice headless, optional, detected | Not installed on the dev machine; actions hidden when missing. |
| Native helper | C# / .NET 10, published self-contained single-file | The .NET 10 SDK is present; no C++ toolchain on the machine. P/Invoke covers `SetWindowsHookEx`, `GetSystemMetrics` and DPI APIs cleanly. |
| Helper IPC | The child process's **stdio pipes** (JSON lines) | Only the parent holds the pipe handles, so no other process can connect. This is simpler and safer than a named pipe that needs ACLs and a handshake. |
| Tests | Vitest (+ jsdom, RTL), Playwright `_electron` for E2E | Required. |

## Layering

```
apps/desktop/src/renderer   React UI. No Node. Talks only to window.obsidian (preload API).
apps/desktop/src/preload    contextBridge: a narrow typed API over ipcRenderer + webUtils.getPathForFile.
apps/desktop/src/main       Windows, IPC handlers (zod-validated), job runner, native helper bridge.
packages/shared             Types, IPC contracts (zod schemas), constants. No runtime deps besides zod.
packages/core               Pure logic: file-type detection, action registry, wheel geometry,
                            output naming, job model. No Electron, no Node-only APIs except in
                            clearly separated `node/` files.
packages/processing         Node-side processors (sharp, pdf-lib, ffmpeg). Imported only by main.
native/windows-helper       .NET helper (input-state events only).
```

Rules:
- The renderer runs with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and a
  strict CSP. It never receives arbitrary paths to read: it sends **file tokens** (paths that main
  registered when they arrived through a drop, dialog, or CLI) and main resolves them.
  _(Initial milestone: paths that come from a drop are allowed after main re-validates that they
  exist and are regular files; the token registry is a hardening item in `known-issues.md`.)_
- `packages/core` is unit-tested without Electron.
- Processors write to a temp file in the destination directory, then `rename` atomically into place.
  On cancel or failure the temp file is removed.

## Job execution

`main/jobs/runner.ts` re-inspects every path, checks the action against the real files and the
capabilities, then calls a handler from `main/jobs/handlers.ts` (images, PDF, background, redact)
or `main/jobs/media-handlers.ts` (FFmpeg). Handlers write only through `OutputWriter`
(`packages/processing/output.ts`), which reserves a collision-safe name with O_EXCL, writes to a
temp file beside it and renames atomically. `produce()` gives external tools (FFmpeg) a temp path
with the real extension. If a file fails or is cancelled midway, the runner rolls back the
outputs that file had produced (e.g. half of a split).

Where heavy work runs:
| Work | Runs in |
|---|---|
| sharp/libvips | libuv thread pool (main process stays responsive) |
| FFmpeg | child process, `-progress pipe:1`, killed on cancel |
| pdf.js rendering/text | a hidden sandboxed **render window** (`pdf-worker.html`), created on demand, closed after 90 s idle (`main/pdf/render-client.ts`) |
| pdf-lib | main process (structural edits are fast) |

## Custom protocol

`twirly-media://file/<token>` (`main/media-protocol.ts`) serves only files explicitly opened in
an editor, with HTTP Range support for seeking. Editor CSP allows `media-src twirly-media:`.

## Process model

- **Main window**: the drop zone, recent jobs, and settings.
- **Wheel window**: frameless, transparent, always-on-top, `focusable: false`, about 360×360 DIP,
  pre-created hidden at startup so the summon latency is just show + position.
- **Editor windows**: one per open editor, frameless, draggable, created on demand.
- **Toast**: rendered inside the wheel window after a drop (the wheel morphs into the toast), so
  no window creation is on the hot path.

## Action engine

`ActionDefinition` (packages/core/actions/types.ts) declares id, label, icon, category, accepted
file kinds, min/max count, required capabilities (e.g. `ffmpeg`, `sharp:avif`), `mode`
(`instant` | `editor`), the default params schema, and an output naming suffix. Execution lives in
main (`apps/desktop/src/main/jobs`) keyed by action id, so definitions stay pure and usable in the
renderer for wheel building.

`resolveActions(files, capabilities, wheelConfig)` returns only actions valid for every file, in
the user's configured order, capped at 8.

## Directory map

See the repository tree. Key files are listed in `progress.md` as they are created.
