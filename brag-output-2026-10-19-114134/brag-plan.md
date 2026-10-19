# Twirly launch video plan (/brag, full Hyperframes workflow)

**Input:** the Twirly project (this repo). **Format:** landscape 1920×1080, 30 fps, 24.6 s.
**Tone:** `polished`. Punchy and clean: a real utility shown working, no forced jokes.

## Answers

- **What is it?** An open-source Windows app that opens a radial action wheel under your cursor while you drag files (README).
- **For whom / what it does:** anyone moving screenshots, photos, PDFs, documents and clips around. Drag, tap Shift, drop on an action. Originals are never overwritten.
- **What sets it apart:** it lives inside the drag. The wheel knows what you're holding (images, PDFs, video, Word/Excel/PowerPoint, text, folders, ZIPs). Everything runs locally.
- **Strongest claim:** "Drag a file, tap Shift, drop it on what you want." (README tagline)
- **Visual hook:** a file mid-drag, a Shift keycap press, and the real wheel blooming open on the beat.
- **Real UI shown:** the actual `RadialWheel` component, rendered to static SVG (real geometry, icons, labels and hub text) for every hover state, from `resolveActions()` with the real action registry. The `JobToast` is recreated from its source. Editor windows (Crop, Annotate, Redact, Add background) are captures of the running app.

## Visual identity (`apps/desktop/src/renderer/styles/tokens.css`)

Background `#0B0F14`, surface `#151B23`, accent `#3B82F6` / `#60A5FA`, text `#F3F6FA` / `#9BA8B8`. Font: Segoe UI (the app's own family). The active wheel segment uses the deeper accent pair (`#2563EB` → `#1D4ED8`, the token `--color-accent-deep`) so its white label passes WCAG AA in the video.

## Storyboard

| # | Time | Scene | On-screen text | Audio |
|---|---|---|---|---|
| 1 Hook | 0.00–2.65 | `sunset.png` picked up and dragged; Shift keycap presses at 1.42; the image wheel blooms at **2.12**. | "Drag a file." → "Tap Shift." | key click, soft impact on bloom |
| 2 Reveal | 2.65–6.34 | The cursor sweeps JPG → WEBP → CROP → COMPRESS; hub text follows. | "Meet Twirly." → "Every action, right where you drag." (4.23) | quiet rollover ticks |
| 3 Drop | 6.34–10.54 | Drop on JPG at **6.34**; the progress toast fills to "1 of 1 saved"; `sunset-converted.jpg` lands next to the original. | "Converted. Original untouched." (8.44) | click, bong on save, soft drop |
| 4 It knows | 10.54–14.76 | PDF wheel at **10.54** (DOCX, TXT, COMPRESS hovered), video wheel at **12.65** (MP4, 25 MB, 10 MB). | "PDFs get PDF tools." / "Video gets video tools." | soft impacts on the cuts |
| 5 And more | 14.76–17.38 | Four real wheels on consecutive beats: report.docx, notes.txt, a folder, assets.zip. | "Word, Excel, text, folders, ZIPs too." | soft drops on the beat grid |
| 6 Editors | 17.38–20.54 | Crop, Annotate, Redact, Add background windows fan in. | "Quick editors, one drop away." | card slides |
| 7 Outro | 20.54–24.60 | App icon at **20.54**, wordmark, tagline, footer, beta chip. Fade out. | "Twirly" / "Drag. Shift. Done." / "Open source (MIT) · Windows 10 & 11 · Your files never leave your PC" / "v0.1.0 beta · on GitHub" | bell on the icon, music fades |

## Audio

- Bed: brag's `happy-beats-business-moves-vol-9` (114.8 BPM), trimmed to 24.6 s with a 0.4 s fade-in and a 1.5 s fade-out.
- Beat locks: 2.12, 4.23, 6.34, 8.44, 10.54, 12.65, 20.54. Beat grid for the four mini wheels (14.76 / 15.28 / 15.81 / 16.34) and the editor cards (half beats from 17.38).
- Audio-reactive: per-frame RMS (hyperframes-creative `extract-audio-data.py`) drives the background glow and the outro glow. No visualiser graphics.
- SFX: Kenney CC0, low-HF-risk picks for repeated ticks.

## Grounding

Every claim is from the README or the code: the formats and actions come from the action registry, "Shrink for Messenger (25 MB)" is a real action title, "Open source (MIT)" is from LICENSE, "Your files never leave your PC" and "v0.1.0 beta" are from the README. The file names (`sunset.png`, `contract.pdf`, `launch-clip.mov`, `report.docx`, `notes.txt`, `Screenshots`, `assets.zip`) and the redaction sample (a fictional "ACME" invoice) are stand-ins.

## Notes

- Music licence: brag's README says to check the ende.app terms before redistributing. Do that before publishing.
- The Segoe UI font files are copied into `composition/assets/fonts/` only so the local render works. They are Microsoft fonts: do not commit or redistribute them (they are git-ignored).
