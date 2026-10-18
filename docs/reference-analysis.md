# Reference analysis

Source: `references/reference.mp4` (originally `snapgram.io_1yftsssh70ao.mp4`).
Method: `ffprobe` metadata, `ffmpeg` frame extraction (2 fps contact sheet, per-frame strips of
entrance/exit, full-resolution crops of key states). All extracted frames live in
`docs/reference-frames/`. REA was **not** used for this: REA analyzes binaries, apps, websites and
captures, not video (see `docs/progress.md` → REA).

Legend used below:

- **[O] Observed**: visible in the frames.
- **[I] Inferred**: a reasonable reading of what is visible, not directly provable from the video.
- **[A] Assumption**: not determinable from the video at all.

## 1. The recording itself

| Property | Value |
|---|---|
| Container / codecs | MP4, H.264 720×1280 @ 30 fps, AAC audio |
| Duration | 21.52 s (644 video frames) |
| Nature | A social-media repost (portrait) of a **macOS** screen recording. The useful content is a band at roughly y = 505–935 px. The caption reads "This guy created a tool that lets you convert files with just drag + shift". |
| Editing | [O] The clip is zoomed and panned (starts as a laptop mock-up, then zooms in). So absolute pixel sizes are meaningless, timings are accurate to about ±1 frame (33 ms), and the playback speed might have been edited [A]. |

The reference product runs on macOS (Finder desktop, macOS drag image, green "+" copy badge).
Its OS integration therefore tells us **nothing** about what Windows Explorer allows.

## 2. Timeline

| Time | Event |
|---|---|
| 0.0–0.9 s | [O] Desktop with a file `Page 001.pdf`. The user starts dragging it (a ghost copy follows the cursor). |
| ≈1.0 s | [O] The wheel appears centered on the cursor. [I] Triggered by pressing Shift mid-drag (caption only; the keyboard is not visible). |
| 1.0–2.8 s | [O] **4-segment format wheel**: DOCX (top), JPG (right), PNG (bottom), TXT (left). Hovering highlights each segment in turn. |
| ≈2.9 s | [O] Dropped on JPG. The wheel disappears; a toast "Converting to JPG / 1 of 1 saved" with a progress bar appears next to the cursor. |
| ≈3.3 s | [O] Toast gone; `Page 001.jpg` appears beside the source. The source PDF is still there (copy semantics). |
| 3.5–5.5 s | [O] `Page 001.jpg` is dragged; **8-segment tool wheel**: COMPRESS, METADATA, EDIT, ANNOTATE, ADD BG, CROP, REDACT, plus one more under the dragged item. The hub shows "1.2 MB" when nothing is hovered. |
| ≈5.5 s | [O] Dropped on CROP. A floating "Crop Image" editor opens. |
| 6–10 s | [O] Crop handles dragged; Apply. → `Page 001 Cropped.jpg`. |
| 11–13 s | [O] Cropped file dragged; the same 8-segment wheel; dropped on ADD BG. |
| 13–19 s | [O] "Add BG" editor: background swatches, Padding / Corners / Shadow sliders, Ratio; "Save with Background". |
| ≈19.5 s | [O] `Page 001 Cropped With Background.png` appears beside the others. |

## 3. Radial wheel geometry

Measured on full-resolution crops (`t2_0.png`, `t5_2.png`), expressed as ratios of the outer radius R:

| Element | Ratio | Notes |
|---|---|---|
| Outer rim (translucent ring) | 1.00 R | [O] A thin, frosted band with a light edge highlight. Not interactive. |
| Segment outer edge | ≈0.93 R | |
| Segment inner edge | ≈0.42 R | |
| Hub (central disc) | ≈0.36 R | [O] Recessed disc containing a **pill** label. |
| Gap between segments | ≈4–5° at the mid radius | [O] Constant-width visual gutters. |
| Segment corners | Rounded | [O] Each sector is a rounded annular wedge ("petal"), not a hard-edged sector. |
| Start angle | Segment 0 centered at 12 o'clock | [O] In both the 4- and 8-segment wheels; clockwise order. |

- [O] Segment count varies with file type (4 for the PDF, 8 for the JPG). Segments always fill 360° evenly.
- [O] Labels: uppercase, bold, small tracking. In the 8-wheel, a monochrome line icon sits above each label.
- [O] **Hub pill content**: the file size ("1.1 MB", "1.2 MB") when nothing is hovered; the hovered action's name ("JPG", "TXT", "ANNOTATE", "ADD BG") when a segment is hovered.
- [O] The wheel stays where it was summoned; the cursor moves inside it. It does not follow the cursor.
- [O] The hub/rim is translucent: the dragged item and the wallpaper are visible through it (backdrop blur + tint).

## 4. States and feedback

- **Idle segment** [O]: pale, translucent, warm-tinted fill.
- **Hovered segment** [O]: fills with a saturated accent (orange-red in the reference). The label/icon stays legible. The hub pill echoes the action name.
- **Drop effect** [O]: the macOS green "+" badge stays visible on the drag image throughout. The OS reports a copy, and the source file survives.
- **No visible "disabled" segments** [I]: the wheel only shows applicable actions.

## 5. Motion

From the per-frame strips (`entrance-0.6-1.2s.png`, `exit-2.8-3.4s.png`):

- **Entrance** [O]: within about 3–4 frames (≈100–130 ms) the wheel goes from a small, blurred, low-opacity blob to full size. [I] A scale (≈0.6→1.0) and opacity fade, with a slight overshoot at most. No visible rotation.
- **Hover** [O]: highlight changes land within 1 frame of the pointer crossing a boundary. [I] A short color cross-fade (<100 ms).
- **Exit on drop** [O]: the wheel is gone within 1–2 frames (≈33–66 ms). [I] A fast fade/scale-down.
- **Toast** [O]: fades/scales in over about 3 frames near the drop point, shows the title, "n of m saved", and a progress bar, then fades out after about 1 s.

## 6. Floating editors

**Crop Image** (`t8_0.png`) [O]:
- Compact rounded panel (portrait, about 1.5:1), warm translucent material, centered title "Crop Image", close "×" top-left.
- Preview area: the image with the area outside the crop dimmed; L-shaped corner handles and bar-shaped mid-edge handles in the accent color.
- "Aspect ratio" segmented control: Free / 1:1 / 16:9 / 9:16 / 4:3 / 3:4.
- W / H numeric fields with a "px" unit.
- Footer: "Reset" (secondary, left) and "Apply" (accent, right).

**Add BG** (`t16_2.png`) [O]:
- Same panel pattern. A live preview of the image placed on a background.
- Swatch grid: gradients, solid colors, plus a custom-image button.
- Sliders with live px readouts: Padding, Corners, Shadow. A "Ratio" segmented control: Auto / 1:1 / 16:9 / 4:5.
- Footer: "Reset" and "Save with Background".

## 7. Output behavior

- [O] The output is written next to the source, never over it. Names: `Page 001.jpg` (pure format conversion, new extension), `Page 001 Cropped.jpg`, `Page 001 Cropped With Background.png`.
- [I] Suffixes are appended per operation and chain across repeated operations.
- [A] Collision handling (what happens if `Page 001.jpg` already existed) is not shown.

## 8. Things the video does **not** show

- The trigger: whether Shift alone or Shift plus a drag threshold summons the wheel. [A]
- Cancellation (Esc, or dropping outside the wheel). [A]
- Multi-file selections, errors, unsupported types, progress for long jobs. [A]
- Keyboard navigation, accessibility, settings. [A]
- How the app gets the files out of Finder (system-wide drag observation on macOS is a different problem from Windows). [A]

## 9. What Obsidian takes from this, and what it deliberately does not

Takes (interaction patterns): drag-summoned radial wheel centered at the cursor; segment count
driven by file type; a hub showing file info or the hovered action; drop-to-execute for simple
actions; compact floating editors for complex ones; a progress toast at the drop point;
non-destructive suffix naming.

Does not take: the warm glass palette, layout proportions verbatim, wording, icons, or branding.
Obsidian's visual identity (graphite, near-black, electric blue) is specified in
`interaction-specification.md` and `architecture.md`.
