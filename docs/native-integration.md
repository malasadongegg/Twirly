# Native Windows integration

Status: **core hypothesis H1 validated on 2026-10-18** with a real Explorer drag (see "Spike log").
Items still marked untested in §4 have not been exercised yet.

## 1. The problem

The user drags files in Explorer. Explorer runs an OLE drag loop (`DoDragDrop`) and owns the
`IDataObject` that carries the file list (`CF_HDROP`, shell ID lists). Obsidian is a separate
process. The questions are:

1. How does Obsidian know a drag is happening and that Shift was pressed?
2. How does Obsidian get the dragged file paths?

## 2. What does *not* work

| Idea | Why not |
|---|---|
| Global keyboard/mouse hooks alone | `WH_KEYBOARD_LL` / `WH_MOUSE_LL` report keys and coordinates, **never** the drag payload. Knowing "Shift + left button held" gives us no file paths. |
| Reading the clipboard | A drag does not use the clipboard. `OleGetClipboard` returns the clipboard, not the drag's `IDataObject`. |
| A transparent, click-through overlay | A window with `WS_EX_TRANSPARENT` (or a fully transparent layered window) is skipped by the hit testing OLE uses to pick the target, so it never receives `DragEnter`. |
| Injecting into explorer.exe / hooking `DoDragDrop` | Code injection into the shell. Fragile, flagged by security software, and explicitly out of scope. **Not done.** |
| Shell extension (`IDropTarget` handler / `IContextMenu` DLL) loaded in Explorer | That is in-process COM in Explorer. It is supported, but only for drops *onto files/folders in Explorer*; it does not give a floating wheel. Rejected for complexity and the crash surface. |

## 3. The mechanism that should work (hypothesis H1)

OLE's drag loop decides the drop target **while the drag is in progress**. On every mouse move,
`DoDragDrop` calls `WindowFromPoint`, looks for a window registered with `RegisterDragDrop`, and
sends it `DragEnter`/`DragOver`. A window that **appears under the cursor mid-drag** should
therefore become the drop target on the next mouse move. No hooking of Explorer is needed: we just
need to put a *real, hit-testable, drop-registered* window under the cursor at the right moment.

Chromium (and so Electron) registers an `IDropTarget` on its windows. A drop delivers standard
HTML5 `drop` events whose `File` objects map to real paths via `webUtils.getPathForFile` in the
preload. **No native drop target code is needed for receiving files** (if H1 holds).

So the design is:

```
native helper (C#, no injection)                Electron main                 wheel window (renderer)
  WH_MOUSE_LL + WH_KEYBOARD_LL ──JSON/stdout──▶  "Shift pressed while LMB     shows wheel, receives OLE
  (events only, no payload)                        held and moved > 6 px"  ──▶ dragenter/dragover/drop
                                                   → position + show wheel     → file paths via preload
                                                   window under the cursor      → action engine
```

### Why there is still a native helper
Electron cannot observe the global mouse-button state or global key state. The helper only
reports *input state* (LMB down/up, mouse position, Shift down/up). It never touches other
processes. Low-level hooks run inside the helper itself (no DLL injection, by OS design).

### Summon heuristic
Show the wheel when **all** are true:
- LMB went down and has stayed down,
- the cursor moved > `SM_CXDRAG`/`SM_CYDRAG` since then (a drag is plausible),
- Shift went down *after* LMB went down (so Shift-click-selection does not trigger it),
- the foreground window belongs to explorer.exe (configurable: "Explorer only" / "Anywhere").

The heuristic **cannot tell** whether the user is dragging files, text, or a window. So:
**if no OLE `dragenter` with files reaches the wheel within 350 ms** of the wheel appearing under
the cursor, the wheel hides itself. Releasing LMB outside the wheel also hides it.

## 4. Risks

| # | Risk | Impact | Mitigation / test |
|---|---|---|---|
| R1 | **Shift means MOVE.** In Explorer, holding Shift during a drag requests `DROPEFFECT_MOVE`. If the target reports MOVE, Explorer may **delete the source file** after the drop (non-optimized move). | **Data loss**. Critical. | The wheel renderer always sets `dataTransfer.dropEffect = 'copy'` on `dragover`/`drop`. Spike must verify that the source survives a Shift-drop. The drop is never acted on if the reported effect is not copy/link. |
| R2 | A newly shown window does not become the target until the next mouse move | Minor: the user must move 1 px | Acceptable; documented. |
| R3 | Transparent Electron windows might be hit-test transparent at transparent pixels | The wheel never receives the drag | Spike: test a `transparent: true` frameless window. Fallback: a non-transparent circular window via `setShape`. |
| R4 | UIPI: hooks do not see input aimed at elevated windows; non-elevated Obsidian cannot be the drop target of an elevated Explorer | The summon does not fire for elevated sources | Documented limitation. |
| R5 | Mixed DPI across monitors: coordinate mismatch between hook (physical px) and Electron (DIP) | Wheel appears offset | Use `screen.screenToDipPoint` in main; the helper is per-monitor-v2 DPI aware. |
| R6 | Focus stealing: showing the wheel window might activate it and disrupt the drag | Drag cancelled | Show with `showInactive()`, `focusable: false`. Spike verifies. |
| R7 | Security software flags LL hooks | User trust | Hooks are well-documented, no injection; signed release build; can be turned off (fallbacks E2/E3 remain). |
| R8 | Hook timeouts: Windows removes LL hooks whose callback is slow (`LowLevelHooksTimeout`) | The summon silently stops working | The hook callback only enqueues; I/O happens on another thread. The helper re-installs hooks if they stop firing. |

## 5. Fallbacks (always available)

- **E2 In-app drop zone**: a compact always-on-top drop target (optional) and the main window.
- **E3 Context menu**: per-user verb under
  `HKCU\Software\Classes\SystemFileAssociations\<ext>\shell\Obsidian` (and `*\shell`) running
  `Obsidian.exe --files "%1"`. Installed and removed by the app (Settings → Integration), so no
  admin rights are needed. On Windows 11 this appears under "Show more options" (the modern
  top-level menu requires a packaged app with a sparse package, which is deferred).

## 6. Spike plan (Phase 5)

1. `native/windows-helper`: a .NET 10 console app. LL hooks → JSON lines on stdout. Self-test mode.
2. In Electron: a wheel-sized window, frameless, transparent, `focusable:false`, shown with
   `showInactive` under the cursor on the summon event.
3. Experiments (each recorded below with result):
   - S1: does an Explorer drag deliver `dragenter`/`drop` with real paths to a window shown mid-drag? (H1)
   - S2: with Shift held, which effect does Explorer see, and does the source survive? (R1)
   - S3: transparent window hit testing. (R3)
   - S4: focus: does `showInactive` keep the drag alive? (R6)
   - S5: DPI and multi-monitor positioning. (R5)
4. Automated variant: a test harness that drives a **real Explorer window** with `SendInput`
   (moves the user's mouse; run only with consent), plus a manual checklist.

## Spike log

### 2026-10-18: S1/S2/S4, real Explorer drag via SendInput (Windows 10 Pro 19045, 100 % DPI, 2 monitors)

Harness: `scripts/spike/run-explorer-spike.ps1`, which drives `tests/native/ExplorerDragSpike` (UI
Automation finds the item in a real `CabinetWClass` Explorer window; `SendInput` performs left-down
→ move past `SM_CXDRAG` → **LShift down** → small moves → move 110 px up → left-up). Fixture: a fresh
240×160 PNG in `tests/.tmp/explorer-spike/`. App: built Electron app with `OBSIDIAN_SPIKE_LOG`.

Evidence (abridged from the log):

```
+0 ms     helper  ready
+4018 ms  helper  summon {x:331, y:631, process:"explorer.exe"}
+4026 ms  wheel-shown {x:191, y:461, 360×360}            ← 8 ms summon→shown
+5393 ms  helper  mouseup
+5400 ms  job-start image.convert.jpeg ["…\explorer-spike\sample.png"]
+5410 ms  job done → sample-converted.jpg (valid JPEG 240×160)
after +2 s: sample.png exists, SHA-256 unchanged
```

| Experiment | Result |
|---|---|
| **S1** Window shown mid-drag becomes the OLE drop target and receives real paths (H1) | ✅ **Confirmed.** The drop arrived in the wheel renderer, `webUtils.getPathForFile` returned the real path, and the top segment's action ran. |
| **S2 / R1** Shift held through the drop: does Explorer delete the source? | ✅ **Source survives** (hash unchanged after 2 s). Forcing `dropEffect = 'copy'` makes Chromium report COPY even though Shift requested MOVE. |
| **S4 / R6** `showInactive` + `focusable:false` keeps the drag alive | ✅ Confirmed. |
| **S3 / R3** Transparent-window hit testing | ✅ Partially confirmed: the drag entered where the (pending) wheel is drawn. Not tested: fully transparent corners of the window. The design no longer depends on that (the rim and hub render immediately on summon). |
| S5 / R5 Mixed DPI, second monitor | ⏳ Not yet tested (the machine has 2 monitors at 100 %; Explorer was on the primary). |
| Negative control (no Shift) | ⏳ Not automated: without Shift, a misplaced release would really move the file inside Explorer. Covered by unit logic and the helper's state machine; needs a manual check. |

**Update 2026-10-19:** the trigger key and the scope are user-configurable (Settings → Explorer
integration). Any letter/digit/F-key/Space/Tab/CapsLock/modifier can be the trigger (Esc, Win,
Enter, Backspace and Delete are refused). Scope: Explorer & desktop, chosen apps (process names,
e.g. `dopus.exe`), or any app. Main sends `{type:"config", enabled, scope, apps, triggerVks}` to
the helper over stdin. **Verified 2026-10-19 with a real Explorer drag** (`run-explorer-spike.ps1 -Trigger KeyQ`, isolated
settings with `trigger: "KeyQ"`): Shift was never pressed; Q summoned the wheel (13 ms
summon→shown), the drop ran Convert to JPG, and the source was unchanged. A regression run with
the default Shift trigger passed as well (4 ms).

### 2026-10-19: chosen apps, second monitor, edge clamping, context-menu verb

| Run | Result |
|---|---|
| Files app (`-App files -Scope custom -Apps files.exe`) | ✅ summon from `Files.exe` in 12 ms; the WinUI drag delivered real paths; Convert to JPG ran; source unchanged |
| Explorer excluded (`-Scope custom -Apps files.exe -Dy 0`) | ✅ helper saw `mouseup` only, **no summon**, nothing written |
| Second monitor (portrait, origin −1080,−368), window at −1000,−200 | ✅ wheel bounds −918,−124 (centered on the cursor, fully on that monitor) |
| Edge: window at −1080,1100 (cursor near the work-area bottom 1512) | ✅ wheel clamped to y = 1152 (= 1512 − 360); the drop still hit the top segment |
| Context-menu verb (`tests/e2e/live-context-menu.spec.ts`) | ✅ installed via the Settings IPC, invoked on 2 files through `Shell.Application` (two processes), batched into one wheel ("2 images"), WEBP outputs written, uninstalled (key gone) |

**Decision:** adopt H1 as the primary integration (E1). Keep E2 (drop zone) and E3 (context menu) as
fallbacks for elevated Explorer windows (R4), users who disable the helper, and accessibility.
