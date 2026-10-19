# Hyperframes Composition Brief: Twirly

## Objective
A short launch-style video for Twirly to go at the top of the GitHub README and to share with friends.

## Output
- Composition: `composition/` (built from `build/index.template.html` by `build/build.py`, which inlines the real wheel SVGs, the SFX tags and the RMS data)
- Video: `brag.mp4`, landscape 1920×1080, 24.6 s

## Source material
- Project root: the Twirly repo. Files read: README.md, LICENSE, tokens.css, RadialWheel.tsx, JobToast.tsx, the action registry (`packages/core/actions`)
- Product name: Twirly
- Tagline: "Drag a file, tap Shift, drop it on what you want." → on screen as "Drag. Shift. Done."
- Key UI moment: the radial wheel blooming under the cursor mid-drag
- Verbatim copy: action labels/titles from the registry ("Convert to WEBP", "Convert to Word (DOCX)", "Shrink for Messenger (25 MB)", ...), "1 of 1 saved"

## Creative direction
- Tone: polished
- Hook: drag + Shift + bloom in the first 2.1 s
- Outro: icon, "Twirly", "Drag. Shift. Done.", open source, beta
- Avoid: generic SaaS language, invented stats, abstract filler

## Visual identity
See brag-plan.md. Background #0B0F14, accent #3B82F6/#60A5FA, Segoe UI.

## Storyboard
See brag-plan.md (7 scenes, 24.6 s).

## Audio
- Role: warm bed plus sparse UI accents
- Music: happy-beats-business-moves-vol-9 (bundled cue preset); fade-out under the outro
- Audio-reactive: subtle; RMS → background glow and outro glow
- SFX: chosen after the motion existed (see `build/build.py`)

## Gate
`npx hyperframes check`: passed with 0 errors; contrast 27/27 WCAG AA; layout 0 issues. The remaining lint warnings are structural suggestions (split into sub-compositions) and do not affect the render.
