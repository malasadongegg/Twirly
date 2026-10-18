# Twirly

**Drag a file, tap Shift, drop it on what you want.**

Twirly is an open-source Windows app that opens a radial action wheel right under your cursor
while you drag files. Convert, crop, annotate, redact or compress them without opening another
program. Everything runs locally: your files never leave your PC.

> ⚠️ **Pre-release (v0.1.0 beta). This is not the final version.**
> It works and is tested, but expect rough edges and changes before 1.0. The installer is not
> code-signed yet, so Windows SmartScreen will warn on first run (More info → Run anyway).

https://github.com/user-attachments/assets/REPLACE-WITH-UPLOADED-VIDEO

*(Trailer: [`brag-output/brag.mp4`](brag-output/brag.mp4))*

## What it does

- **Drag + Shift anywhere in Explorer** (or a key and apps you choose) → the wheel opens at the cursor. Also works from a drop zone and an "Open with Twirly" right-click entry.
- **The wheel knows what you're holding**:
  - **Images** (PNG, JPG, WEBP, AVIF, TIFF, BMP, HEIC): convert, compress, crop, resize, rotate, annotate, add background, redact (pixels truly replaced), view/remove metadata and GPS.
  - **PDFs**: to JPG/PNG/TXT/Word (DOCX), merge, split, rotate, compress, page editor (reorder, rotate, delete, extract, crop).
  - **Video & audio** (with FFmpeg): convert, compress, extract audio, GIF, trim.
- **Safe by default**: originals are never overwritten; outputs land next to them (`photo-converted.webp`).

## Install

Download the latest installer from [Releases](../../releases) (marked **pre-release**). Windows 10/11, x64.

Optional: install [FFmpeg](https://ffmpeg.org/) (`winget install Gyan.FFmpeg`) for video, audio and HEIC.

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

- Trailer made with [brag](https://github.com/latent-spaces/brag). Music: "Happy Beats / Business Moves" by [ende.app](https://ende.app). Sound effects: [Kenney](https://kenney.nl) (CC0).
- Built with Electron, React, sharp, pdf.js, pdf-lib and FFmpeg.

## License

[MIT](LICENSE). Free to use, modify and share.
