# Known issues and limitations

Severity: **H** blocks a public release · **M** should fix · **L** cosmetic or edge case.

## Release

| # | Sev | Issue |
|---|---|---|
| R1 | H | **Unsigned binaries.** The installer and `Twirly.exe` are not Authenticode-signed, so SmartScreen will warn, and some antivirus products are suspicious of an unsigned app that installs low-level input hooks. See `release.md`. |
| R2 | M | Install/uninstall verified on the dev machine (2026-10-19): silent per-user install in 8.7 s, installed app passes the packaged smoke tests, silent uninstall removes the folder, shortcuts and uninstall entry. **Not yet tested on a clean Windows 10/11 VM.** |

## Integration

| # | Sev | Issue |
|---|---|---|
| K1 | M | Drag-summon does not work over **elevated** windows (UIPI). Fallbacks: drop zone, context menu. By design. |
| K2 | L | Second monitor (negative coordinates) and edge clamping verified with real drags. Not verified: scaling other than 100 %. |
| K3 | L | The wheel becomes the drop target on the first mouse move after it appears (OLE behavior). |
| K4 | M | The summon heuristic can fire for non-file drags (e.g. Shift while dragging a window). The wheel closes itself after 700 ms without an OLE dragenter. |
| K5 | L | Low-level hooks may be flagged by security software. They can be turned off in Settings. |
| K6 | L | Custom trigger (Q) and chosen-apps scope verified live, including the Files app (summons) and Explorer excluded by scope (does not). Other file managers (Directory Opus, Total Commander) untested. |
| K7 | L | Context-menu verb verified live (install, shell invocation on 2 files batched into one wheel, uninstall). On Windows 11 it is under "Show more options". |

## Processing

| # | Sev | Issue |
|---|---|---|
| P1 | L | HEIC is decoded through FFmpeg (needs FFmpeg with HEVC). EXIF from HEIC is not carried over, and HDR HEIC is converted to 8-bit without tone mapping. Without FFmpeg, HEIC is explained as unavailable. |
| P3 | L | Rotate / Strip metadata re-encode JPEGs (lossless JPEG transforms are not available in sharp). |
| P4 | L | Animated GIF/WebP: first frame only. |
| P6 | L | BMP: RLE-compressed and OS/2 BMPs are rejected with a clear message. 1/4/8/16/24/32-bit uncompressed and bitfield BMPs are supported. |
| P7 | L | PDF Compress recompresses JPEG and 8-bit RGB/gray Flate images (downscale > 2000 px, JPEG q72). It leaves CMYK/Indexed images, masks, predictor-encoded images and vector content alone, and refuses to output a file that is not smaller. Ghostscript-level font/vector optimization is not done. |
| P8 | M | PDF → TXT has no OCR: scanned PDFs report "no text layer". |
| P9 | M | Not implemented: office documents → PDF (LibreOffice), PDF redaction (deliberately disabled). PDF → DOCX carries text, paragraphs, headings and page breaks, but not fonts, bold/italic, images or tables. |
| P10 | L | GIF export of long videos can be large; there is no length warning yet. |
| P11 | L | FFmpeg is bundled (adds ~55 MB to the installer). Office → PDF needs Microsoft Office or LibreOffice; without either, Twirly offers a one-click LibreOffice install via winget (opens the download page if winget is missing). The real winget install has not been run in testing (only the offer/decline path is covered). |

## Security hardening backlog

| # | Sev | Issue |
|---|---|---|
| S1 | M | The renderer passes absolute paths to main. Main validates them (absolute, exists, regular file, signature re-check, never overwrites; `media:open` is limited to the editor's own files) but does not tie paths to a user gesture. Planned: a per-window path-token registry. |
| S2 | L | `npm audit`: moderate advisories in electron-builder's build-time tree only. |

## Testing gaps

| # | Sev | Issue |
|---|---|---|
| T1 | M | Playwright cannot synthesize OS drops with real paths. Covered by: synthetic drag UI tests, file-dialog execution tests, and the opt-in real-Explorer spike (`scripts/spike/run-explorer-spike.ps1`, moves the mouse). |
| T2 | L | No screenshot of the wheel composited over the desktop during a real drag. |
| T3 | M | E2E tests launch the real input helper (low-level hooks active for the test's duration). Harmless, but note it when running tests on a shared machine. |
