# Twirly

**Drag a file, tap Shift, drop it on what you want.**

Twirly is an open-source Windows app that opens a radial action wheel right under your cursor
while you drag files. Convert, crop, annotate, redact or compress them without opening another
program. Everything runs locally: your files never leave your PC.

> ⚠️ **Pre-release (v0.1.0 beta). This is not the final version.**
> It works and is tested, but expect rough edges and changes before 1.0. The installer is not
> code-signed yet, so Windows SmartScreen will warn on first run (More info → Run anyway).


## What it does

- **Drag + Shift anywhere in Explorer** (or a key and apps you choose) → the wheel opens at the cursor. Also works from a drop zone and an "Open with Twirly" right-click entry.
- **The wheel knows what you're holding**:
  - **Images** (PNG, JPG, WEBP, AVIF, TIFF, BMP, HEIC): convert, compress, crop, resize, rotate, annotate, **remove background** (AI, runs on your PC, one or many images at once; a **Touch up** button lets you brush back or erase what it missed), add a background (presets, your own colors or a picture, optionally cutting the subject out first), redact (pixels truly replaced), view/remove metadata and GPS.
  - **PDFs**: to JPG/PNG/TXT/Word (DOCX), merge, split, rotate, compress, extract images, page editor (reorder, rotate, delete, extract, crop).
  - **Word, Excel, PowerPoint**: to PDF (uses your installed Office, or LibreOffice), extract images.
  - **Text files** (.txt, .md, .csv, .json…): to PDF, to Word, combine several into one.
  - **Video & audio**: convert, compress, extract audio, GIF, trim, **shrink for Messenger (25 MB) / Discord (10 MB)**.
  - **Folders & ZIPs**: zip anything, extract ZIPs safely, turn a folder of images into one PDF.
  - **Anything**: copy its path, copy its SHA-256 checksum.
- **Safe by default**: originals are never overwritten; outputs land next to them (`photo-converted.webp`).

## Install

Download the latest installer from [Releases](../../releases) (marked **pre-release**). Windows 10/11, x64.

Everything is included: video, audio and HEIC work out of the box (FFmpeg ships inside the installer). Only **Word/Excel/PowerPoint → PDF** needs Microsoft Office or [LibreOffice](https://www.libreoffice.org/). If neither is installed, Twirly offers to install LibreOffice (free) for you the first time you use it, or from Settings → Diagnostics.

## Build from source

```powershell
npm install
npm run helper:build   # needs the .NET 10 SDK
npm run dev            # run in development
npm test               # unit + integration tests
npm run dist           # build the installer into release/
```

Project status, architecture and known issues: [`docs/`](docs/) (start with `docs/progress.md`).

## Credits

- Trailer made with [brag](https://github.com/latent-spaces/brag) and [Hyperframes](https://github.com/heygen-com/hyperframes). Music: "Happy Beats / Business Moves" by [ende.app](https://ende.app). Sound effects: [Kenney](https://kenney.nl) (CC0).
- Built with Electron, React, sharp, pdf.js, pdf-lib and FFmpeg.
- Background removal uses [IS-Net](https://github.com/xuebinqin/DIS) (Apache-2.0, ONNX export from [rembg](https://github.com/danielgatis/rembg)) through [ONNX Runtime](https://onnxruntime.ai) (MIT), bundled in the installer.
- The installer bundles [FFmpeg](https://ffmpeg.org) as separate, unmodified executables under the GNU GPL (licence in `resources/ffmpeg/LICENSE.txt`; build from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), source at [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg)).

## License

[MIT](LICENSE). Free to use, modify and share.
