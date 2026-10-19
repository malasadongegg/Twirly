# Progress

Last updated: 2026-10-19 (second session). Read this first when resuming, then `architecture.md`,
`native-integration.md` and `known-issues.md`.

**Product name: Twirly** (renamed from the working title "Obsidian", which collided with the
Obsidian note-taking app's folders). "Obsidian" survives only as the name of the dark theme. The
repo folder is `Projects/Twirly` (renamed from `Projects/Obsidian` on 2026-10-19).

## How to run

```powershell
npm install                # also copies pdf.js assets (postinstall)
npm run helper:build       # .NET 10 SDK → native/windows-helper/bin/publish/TwirlyHelper.exe
npm run dev                # electron-vite dev (HMR)
npm test                   # unit + integration (Vitest); media tests need ffmpeg/ffprobe on PATH
npm run test:e2e           # builds, then Playwright drives the real Electron app
npm run dist:dir           # packaged app in release/win-unpacked (+ packaged smoke test runs in test:e2e)
npm run dist               # NSIS installer release/Twirly-Setup-<version>.exe
npm run typecheck; npm run lint
```

> Terminals inside VS Code inherit `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain
> Node. The E2E harness and spike script strip it; for `npm run dev`, run
> `Remove-Item Env:ELECTRON_RUN_AS_NODE` first.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 Reference analysis | ✅ | `reference-analysis.md`, `interaction-specification.md`, frames in `docs/reference-frames/`. |
| 1 Foundation | ✅ | electron-vite 6, React 19, TS 6.0, Tailwind 4; sandboxed renderers, zod-validated IPC, CSP. |
| 2 Design system | ✅ | Tokens (`renderer/styles/tokens.css`), controls, motion. Light theme architected, not tuned. |
| 3 Radial wheel | ✅ | Shared geometry for drawing and hit testing; keyboard; reduced motion; hub text wraps. |
| 4 In-app drag & drop | ✅ | Drop zone and Browse; MIME-provisional actions during the drag, signature re-validation on drop. |
| 5 Native feasibility | ✅ | **H1 validated with a real Explorer drag** (`native-integration.md`). |
| 6 Images | ✅ | Convert PNG/JPG/WEBP/AVIF/TIFF/**BMP** (built-in codec); **HEIC input via FFmpeg** (tile grids composed); compress, rotate, strip; crop/resize, **Annotate**, Add background, secure Redact, Metadata (EXIF + GPS) editors; images → PDF. |
| 7 PDF | ✅ | To JPG/PNG/TXT, **to DOCX** (own writer, verified by opening in Microsoft Word), merge, split, rotate, **compress** (own image recompression, no Ghostscript), optimize, page editor (reorder, rotate, delete, extract, **crop margins → CropBox**). PDF redaction deliberately disabled. |
| 8 Audio/video | ✅ | FFmpeg actions with progress and cancel; trim/convert editor with `twirly-media://` preview (Range support). Encoders detected at runtime. |
| 9 Windows integration | ✅ | All verified live on 2026-10-19: Shift and custom (Q) triggers; **chosen apps with the Files app** (and Explorer correctly excluded); **second monitor** at negative coordinates and **edge clamping**; **context-menu verb** (install → shell invoke on 2 files batched into one wheel → action → uninstall). Not verified: DPI scaling ≠ 100 % (user chose not to change scaling). |
| 10 Settings | ✅ | Appearance, output folder/naming/quality, integration, wheel order/visibility, startup/tray, diagnostics; persisted atomically; E2E-verified. |
| 11 QA | 🟡 | 174 unit/integration + 20 app E2E + 2 packaged + 1 live context-menu test. Manual checklist items covered by the live spikes; DPI and clean-VM still open. |
| 12 Packaging | 🟡 | NSIS per-user installer (121 MB), rebuilt with all features; install → smoke test → uninstall verified on this machine. Remaining: clean-VM test (user skipped for now) and code signing. |

## Session 3 (2026-10-19): expansion

Added folders and archives as kinds, Copy path, SHA-256, ZIP compress/extract (with zip-slip and
zip-bomb guards), Extract images (PDF, DOCX/PPTX/XLSX), Office → PDF (installed Office or
LibreOffice), Text → PDF/DOCX and Combine, Folder images → PDF, and Shrink for Messenger/Discord.
Fixed the Explorer drag-summon closing after 0.7 s when the user pauses after Shift (now waits
for the button release). That fix still needs a manual check by the user.

## Features in the reference video vs. Twirly

| Reference | Twirly |
|---|---|
| Format wheel for PDF (DOCX/JPG/PNG/TXT) | ✅ all four (DOCX = text and paragraph structure, not layout) |
| Tool wheel: Compress, Metadata, Edit, Annotate, Add BG, Crop, Redact | ✅ all (default image wheel matches this set) |
| Crop editor with aspect presets and W/H | ✅ (plus rotate/flip, format, quality, before/after) |
| Add BG editor (swatches, padding, corners, shadow, ratio) | ✅ (original presets) |
| Progress toast, output next to source | ✅ |

## REA

Not configured (`claude mcp list` has no `rea`). Not needed for the MP4. Setup requires approval
because it edits global Claude config: `npx rea-agents@latest setup --client claude_code`, or
per-project `claude mcp add --scope local rea -- cmd.exe /d /c npx -y rea-agents@6.7.0 mcp`.
REA needs Node ≥ 22.19 (this machine: 22.16.0).

## Next steps

1. Clean-VM install (Windows Sandbox needs enabling: admin + reboot) and a DPI ≠ 100 % check.
2. Code signing (see `release.md`) before distributing.
3. Optional: office documents → PDF via LibreOffice when installed; OCR for scanned PDFs.
4. Optional: higher-fidelity PDF → DOCX (bold/italic runs, images, tables).
