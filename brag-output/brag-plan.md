# Twirly launch video plan (/brag-slim)

**Input:** the Twirly project (this repo). **Format:** landscape 1920×1080, 30 fps, 21.6 s.
**Tone:** `default` leaning `polished`: punchy and clean, a real utility shown working, no jokes forced.

## Answers

- **What is it?** A Windows utility that pops a radial action wheel under your cursor while you drag files, so you can convert, edit or compress them without opening an app.
- **Who is it for / what does it do for them?** Anyone who shuffles screenshots, photos, PDFs and clips around: drag, press Shift, drop on an action, done. The original is never touched.
- **What sets it apart?** It lives in the drag itself (Explorer, desktop, even the Files app). The wheel knows what you're holding: images, PDFs and video each get their own actions. Everything runs locally.
- **Most impressive claim:** "Drag. Shift. Done." The whole round trip is one gesture; outputs land next to the original.
- **Visual hook:** a file mid-drag, a Shift keycap press, and the wheel blooming open around the cursor.
- **Real UI to show:** the actual `RadialWheel` component (real geometry, real action labels and hub text), the real `JobToast`, and real editor windows (Crop, Annotate, Redact, Add background) captured from the running app.
- **Share caption:** "Drag a file, tap Shift, drop it on what you want."

## Visual identity (from `apps/desktop/src/renderer/styles/tokens.css`)

Background `#0B0F14`, surface `#151B23`, elevated `#1C2530`, accent `#3B82F6` → `#60A5FA`, text `#F3F6FA` / `#9BA8B8`, hairlines `rgba(255,255,255,.08)`. Font: Segoe UI Variable (the app's own). The app icon (`assets/icon.png`) closes the video.

## Storyboard (cuts land on the track's strong beats)

| # | Time | Scene | On-screen text | Audio |
|---|---|---|---|---|
| 1 Hook | 0.00–2.65 | Dark desk. A file tile `sunset.png` glides with the cursor (mid-drag). At 1.4 s a **Shift** keycap presses in. At **2.12** the real wheel blooms open around the cursor. | "Drag a file." → "Tap Shift." | Music in; soft key tap at 1.4; pop at 2.12 |
| 2 Reveal | 2.65–6.34 | The cursor sweeps across real segments (JPG → WEBP → CROP → ANNOTATE); hub text follows. | "Twirly. Every action, right where you drag." | Quiet rollover ticks |
| 3 Drop | 6.34–10.54 | Drop on **JPG** at 6.34: the wheel folds into the real progress toast ("Convert to JPG · 1 of 1 saved"), then `sunset-converted.jpg` lands next to `sunset.png`. | "Converted. Original untouched." | Click at 6.34, soft bong when saved |
| 4 It knows | 10.54–14.76 | The wheel morphs per file type: a PDF wheel (DOCX, JPG, PNG, TXT, MERGE…) at 10.54, a video wheel (MP4, COMPRESS, TRIM, GIF…) at 12.65. | "PDFs get PDF tools." → "Video gets video tools." | Soft impact on each cut |
| 5 Editors | 14.76–18.44 | Four real editor windows fan in: Crop, Annotate, Redact, Add background. | "Quick editors, one drop away." | Soft whoosh-ins |
| 6 Outro | 18.44–21.60 | App icon + **Twirly** wordmark; tagline; the platform line. Fade out. | "Drag. Shift. Done." / "For Windows 10 & 11 · runs locally" | Impact at 18.44, music fades |

Scene durations: 2.65 + 3.69 + 4.20 + 4.22 + 3.68 + 3.16 = 21.6 s.

## Music cue guidance

Track: brag bundled `happy-beats-business-moves-vol-9` (114.8 BPM). Strong cues used: 2.12 (hook bloom), 6.34 (drop), 10.54 and 12.65 (montage cuts), 18.44 (outro, beat). Cues are hints; readability wins.

## Notes

- Illustrative content only: file names (`sunset.png`, `contract.pdf`, `launch-clip.mp4`) and the redaction sample (a fictional "ACME" invoice with a made-up name) are stand-ins. No real user data.
- Music licence: brag's README says to verify the ende.app terms before redistribution. Flag this to the user before publishing.
