# Test plan

| Layer | Tool | Location | Run |
|---|---|---|---|
| Pure logic (geometry, signatures, actions, naming, crop math, MIME) | Vitest | `tests/unit/core` | `npm test` |
| Components (RadialWheel: roles, keyboard, hub wrapping) | Vitest + RTL + jsdom | `tests/unit/renderer` | `npm test` |
| Processing (real sharp encode/decode, atomic writes, Unicode, >260-char paths, corrupt input, cancellation, concurrency) | Vitest (node) | `tests/integration` | `npm test` |
| App E2E (real Electron: drop zone, synthetic drags, wheel hover, browse → convert, crop/resize editors, error toast) | Playwright `_electron` | `tests/e2e` | `npm run test:e2e` (builds first) |
| **Explorer integration** (real Explorer drag + Shift → wheel → action; source-survival check) | SendInput driver + PowerShell | `scripts/spike/run-explorer-spike.ps1` | Manual opt-in: **moves the mouse**. Requires `npm run build` and `npm run helper:build`. |
| PDF (pdf-lib structure ops, damaged files, images → PDF, OutputWriter rollback) | Vitest (node) | `tests/integration/pdf-processing.test.ts` | `npm test` |
| Media (real FFmpeg: WEBM, GIF, trim+scale, audio copy, normalize, cancel kills FFmpeg, damaged input) | Vitest (node) | `tests/integration/media-processing.test.ts` | `npm test` (skipped without FFmpeg) |
| Image extras (background geometry, secure redaction, EXIF/GPS reader), BMP codec | Vitest | `tests/integration/image-extras.test.ts`, `tests/unit/core/bmp.test.ts` | `npm test` |
| App E2E: PDF → PNG/TXT via the render window, PDF page editor, media editor (protocol streaming + trim), background/redact/metadata editors, settings (trigger recorder, app list) | Playwright | `tests/e2e/app.spec.ts` | `npm run test:e2e` |
| **Packaged app** (isPackaged, helper from resources, sharp from asar.unpacked, pdf.js from asar) | Playwright | `tests/e2e/packaged.spec.ts` | after `npm run dist:dir` |
| HEIC (real samples: 2×2 tile grid, 45 MP CC0 photo) | Vitest | `tests/integration/heic.test.ts` | `node scripts/fetch-test-fixtures.mjs` once, then `npm test` |
| PDF compress / crop, paragraphs → DOCX (opened in **Microsoft Word** via COM when installed) | Vitest | `tests/integration/pdf-processing.test.ts`, `tests/unit/core/paragraphs-docx.test.ts` | `npm test` |
| **Live: context-menu verb** (writes HKCU, invokes the verb through `Shell.Application`) | Playwright | `tests/e2e/live-context-menu.spec.ts` | `TWIRLY_LIVE=1 npx playwright test tests/e2e/live-context-menu.spec.ts` |
| **Live: drag spikes** (moves the mouse): `-Trigger KeyQ`, `-App files -Scope custom -Apps files.exe`, `-Scope custom -Apps files.exe -Dy 0` (must not summon), `-MoveTo '-1000,-200'` (second monitor), `-MoveTo '-1080,1100'` (edge clamp) | PowerShell + driver | `scripts/spike/run-explorer-spike.ps1` | manual, opt-in |
| Helper smoke | the helper itself | `TwirlyHelper.exe --selftest` | manual |

## Manual checklist (per release)

0. Settings → change the trigger key to Q; drag a file in Explorer and press Q: the wheel appears. Set scope to "Chosen apps" without explorer.exe: no wheel.
1. Drag 1 PNG in Explorer, press Shift: the wheel appears at the cursor; drop on JPG → `*-converted.jpg` beside the source; the source is unchanged.
2. Same with 3 images → batch toast "3 of 3 saved".
3. Drag without Shift → no wheel, normal Explorer behavior.
4. Shift-drag a window title bar → the wheel flashes for at most 700 ms, or not at all.
5. Second monitor (left of primary, negative coordinates) → the wheel stays fully on that monitor near the edges.
6. 150 % DPI monitor → wheel centered on the cursor.
7. Elevated Explorer → no summon (documented); the drop zone still works.
8. Esc while dragging in Explorer → the wheel closes.
9. Reduced motion (Windows: Settings → Accessibility → Visual effects → Animation effects off) → no scale/blur entrance.
