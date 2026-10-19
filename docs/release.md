# Release procedure

## Build

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm ci
npm run typecheck; npm run lint; npm test
npm run dist:dir          # release/win-unpacked
npm run test:e2e          # includes tests/e2e/packaged.spec.ts against release/win-unpacked
npm run dist              # release/Twirly-Setup-<version>.exe (+ .blockmap)
```

Bump `version` in `package.json` first. The installer name comes from `nsis.artifactName`.

## What the installer does

- Per-user install (no admin) to `%LOCALAPPDATA%\Programs\Twirly`, with Start menu and desktop shortcuts.
- Ships: `Twirly.exe` (Electron 44), `resources/app.asar` (≈22 MB), `resources/app.asar.unpacked`
  (sharp + libvips native, ≈20 MB), `resources/helper/TwirlyHelper.exe` (self-contained .NET 10,
  ≈13 MB), `resources/assets`.
- User data: `%APPDATA%\Twirly\settings.json` (kept on uninstall).
- Uninstall (`build/installer.nsh`): stops the helper, deletes `HKCU\Software\Classes\*\shell\Twirly`
  (the optional context-menu verb) and the `dev.twirly.app` Run value (launch at login).

## Runtime dependencies

- **FFmpeg/FFprobe**: bundled. `npm run dist` runs `npm run ffmpeg:fetch`, which downloads the BtbN
  `n9.0 gpl-shared` build into `vendor/ffmpeg` (git-ignored); electron-builder copies it to `resources/ffmpeg`
  with its GPL licence. A system FFmpeg on PATH is only a fallback.
- **LibreOffice**: optional, not used yet.

## Signing (required before public distribution)

Builds are currently **unsigned** (verified with `Get-AuthenticodeSignature`: NotSigned).
Options:
1. Azure Trusted Signing (cheapest current path for individuals/small orgs). electron-builder
   supports it via `win.azureSignOptions`.
2. An OV/EV code-signing certificate (`win.certificateFile` / env `CSC_LINK`, `CSC_KEY_PASSWORD`).

Sign `Twirly.exe`, `TwirlyHelper.exe` (sign it before `dist`, since electron-builder only signs
the files it builds) and the installer.

## Verification checklist

1. `Get-AuthenticodeSignature` reports Valid on all three binaries.
2. Install on a clean Windows 10 and Windows 11 VM. Run the manual checklist in `test-plan.md`.
3. Uninstall: the app folder is gone, the context-menu verb is removed, settings remain.
