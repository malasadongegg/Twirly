# Obsidian interaction specification

This specification is independent of the reference product. "Wheel" means the Obsidian radial
action wheel.

## 1. Entry points

| # | Entry point | Status |
|---|---|---|
| E1 | **Summon during an Explorer drag**: start dragging files in Explorer (or on the desktop), press **Shift**, and the wheel appears at the cursor. | Target. Depends on the Phase 5 feasibility spike (`native-integration.md`). |
| E2 | **In-app drop zone**: drag files onto the Obsidian window. The wheel opens centered on the drop point (or in place of the drop zone). | Required fallback. |
| E3 | **Explorer context menu**: "Open with Obsidian" on files. Opens the wheel at the cursor with those files preloaded; clicking a segment runs it. | Fallback. Implemented through a per-user registry verb (no shell extension DLL). |
| E4 | **Tray / global shortcut**: opens the drop zone window. | Convenience. |

E2, E3 and E4 all lead into the same wheel and action engine; only the way files get in differs.

## 2. Wheel lifecycle

```
hidden ──summon──▶ entering ──(≤140 ms)──▶ open ──hover──▶ open(segment k)
   ▲                                          │                 │
   │                         drop on hub/rim, │                 │ drop / click / Enter
   │                     Esc, drag leaves the │                 ▼
   └────────────── exiting ◀── cancel ────────┘          executing ──▶ toast or editor
```

- **Summon position**: centered on the cursor, then clamped so the whole wheel stays inside the
  work area of the monitor under the cursor (with a 12 px margin). When clamping moves the wheel,
  the cursor sits off-center; that is acceptable.
- **The wheel never follows the cursor** once open.
- **Segment selection** is purely angular, restricted to the annulus between the inner and outer
  hit radii. The hub and the outer rim select nothing.
- **Hit testing equals rendering**: the same geometry function produces the SVG path and the
  hit test (`packages/core` → `wheel-geometry`).

### Cancel rules
- Esc, or releasing over the hub, the rim, or outside the wheel → cancel, no file operation.
- The drag leaves the wheel window (OLE DragLeave) → the wheel stays open for 400 ms (so a
  jittery exit and re-entry is not punished), then exits.
- The summoning drag is cancelled by the OS (Esc in Explorer) → the wheel exits.

## 3. Segments

- Up to **8** segments; fewer when fewer actions apply (minimum 2; with only one action the wheel
  shows it as a 1-segment ring).
- Order: user-configured per file category (Settings → Wheel). Defaults are in
  `packages/core/actions/defaults.ts`.
- Segment 0 is centered at 12 o'clock, clockwise.
- Each segment shows a Lucide icon and a ≤10-character uppercase label.
- Actions that cannot process the current selection are **not shown**. If nothing applies, the
  wheel shows an "unsupported" hub message and no segments.

### Hub
- Not hovering: file summary: `1.2 MB` for one file, `3 files · 8.4 MB` for several.
- Hovering: the hovered action's full name.
- Mixed selections: a type summary (`2 images, 1 PDF`). Only actions valid for **every** file are
  offered. When the intersection is empty, the hub shows "No common actions".

## 4. Execution

| Action kind | On drop/click |
|---|---|
| **Instant** (convert, compress at defaults, strip metadata, rotate 90°) | Runs immediately. Shows a progress toast at the drop point. Output goes next to the source. |
| **Configurable** (crop, resize, trim, PDF page editor, …) | Opens a floating editor window next to the drop point. |
| **Destructive-looking** (overwrite enabled in settings) | A confirmation dialog first. |

### Progress toast
- Title ("Converting to WEBP"), counter ("2 of 5 saved"), determinate bar when progress is known,
  Cancel (×).
- On success: holds for 1.2 s, offers "Show in folder", then fades.
- On failure: stays until dismissed. Shows a human error message and offers "Copy details".
- On cancel: partial outputs deleted; shows "Cancelled" for 1 s.

## 5. Floating editor windows

Common frame: draggable title bar (title centered, close on the left, matching Windows caption
conventions), preview area, controls, footer with **Cancel** (left) and the primary action (right,
accent). All edits are non-destructive parameters until export. Enter = primary, Esc = cancel.

- **Image**: crop rectangle with corner and edge handles; aspect presets Free / 1:1 / 4:3 / 3:4 /
  16:9 / 9:16; W/H fields (px, linked by aspect); rotate ±90 and flip; output format, quality
  slider; before/after toggle.
- **PDF**: page thumbnail grid; select, reorder by drag, rotate, delete or extract; export.
- **Media**: preview player, timeline with start/end handles, format, quality preset, export
  progress.

## 6. Output naming

`<base>-<suffix>.<ext>`, with a collision-safe counter: `photo-converted.webp`, then
`photo-converted (2).webp`. Suffix per action (`converted`, `resized`, `cropped`, `compressed`,
`rotated`, `trimmed`, `merged`, `pages-1-3`, …). The separator and pattern are configurable.
Overwriting the source is never the default.

## 7. Motion

| Interaction | Spec | Reduced motion |
|---|---|---|
| Wheel enter | Spring (stiffness 520, damping 34): scale 0.82→1, opacity 0→1, about 140 ms perceived | Opacity only, 80 ms |
| Wheel exit | 90 ms ease-in: scale 1→0.94, opacity →0 | Opacity, 60 ms |
| Segment hover | Fill cross-fade 90 ms; segment pushes outward 3 px; inner glow | Fill only |
| Hub label swap | 120 ms cross-fade with a 4 px vertical slide | Instant |
| Toast enter | Spring from 8 px below, opacity 0→1 | Opacity |

Animation intensity settings (Full / Reduced / Off) scale these values. The OS
"prefers-reduced-motion" setting forces Reduced.

## 8. Keyboard and accessibility

- With the wheel open (E2/E3): arrow keys or Tab move between segments clockwise, Enter runs,
  Esc cancels, and digits 1–8 pick directly.
- The wheel uses `role="menu"`; segments use `role="menuitem"` with `aria-label` = action name.
- Focus ring: 2 px accent outline on the segment path.
- Every editor control is reachable by keyboard; sliders have numeric inputs alongside.
