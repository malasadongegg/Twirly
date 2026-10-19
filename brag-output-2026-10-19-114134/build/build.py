"""Assemble composition/index.html from the template: inline the real wheel SVGs, SFX and audio data."""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
COMP = HERE.parent / 'composition'
WHEELS = COMP / 'assets' / 'wheels'
manifest = json.loads((WHEELS / 'manifest.json').read_text(encoding='utf8'))


def svg(set_name, state, uid):
    s = (WHEELS / f'{set_name}-{state}.svg').read_text(encoding='utf8')
    # React's useId gives every export the same id; make them unique per inlined copy.
    s = s.replace('_R_0_', uid)
    s = re.sub(r' (role|aria-[a-z]+|tabindex|data-testid|data-active|data-hub)="[^"]*"', '', s)
    s = re.sub(r' style="transition:[^"]*"', '', s)
    return s


def wheel(wid, set_name, extra_style=''):
    n = len(manifest[set_name])
    parts = [f'<div class="st st-idle">{svg(set_name, "idle", f"{wid}-idle")}</div>']
    for i in range(n):
        parts.append(f'<div class="st st-{i}">{svg(set_name, i, f"{wid}-{i}")}</div>')
    return f'<div id="{wid}" class="wheel" style="{extra_style}">' + ''.join(parts) + '</div>'


html = (HERE / 'index.template.html').read_text(encoding='utf8')
html = re.sub(
    r'<!--WHEEL id=(\S+) set=(\S+) cx=(\d+) cy=(\d+)-->',
    lambda m: wheel(m[1], m[2], f'left: {int(m[3]) - 160}px; top: {int(m[4]) - 160}px'),
    html,
)
html = re.sub(r'<!--MINI set=(\S+)-->', lambda m: wheel(f'w-{m[1]}', m[1]), html)

# SFX: (file, time, volume). Chosen after the motion existed; low-HF-risk picks for repeats.
SFX = [
    ('click_003', 1.42, 0.55),  # Shift press
    ('impactSoft_medium_001', 2.12, 0.7),  # wheel blooms
    ('rollover2', 2.85, 0.28), ('rollover2', 3.5, 0.28), ('rollover2', 4.2, 0.28), ('rollover2', 4.9, 0.28), ('rollover2', 5.75, 0.28),
    ('click_002', 6.34, 0.6),  # drop on JPG
    ('bong_001', 7.35, 0.5),  # saved
    ('drop_002', 8.3, 0.45),  # output lands
    ('impactSoft_medium_004', 10.54, 0.6), ('impactSoft_medium_002', 12.65, 0.6),
    ('rollover2', 11.05, 0.22), ('rollover2', 11.6, 0.22), ('rollover2', 12.15, 0.22),
    ('rollover2', 13.16, 0.22), ('rollover2', 13.71, 0.22), ('rollover2', 14.26, 0.22),
    ('drop_002', 14.76, 0.35), ('drop_002', 15.28, 0.35), ('drop_002', 15.81, 0.35), ('drop_002', 16.34, 0.35),
    ('card-slide-1', 17.38, 0.35), ('card-slide-1', 17.91, 0.3),
    ('impactBell_heavy_000', 20.54, 0.5),  # logo lands
]
tags = [
    f'<audio id="sfx{n}" src="assets/sfx/{f}.ogg" data-start="{t}" data-track-index="{11 + n}" data-volume="{v}"></audio>'
    for n, (f, t, v) in enumerate(SFX)
]
html = html.replace('<!--SFX-->', '\n      '.join(tags))
html = html.replace('/*SFXJSON*/[]', '[]')

data = json.loads((HERE / 'audio-data.json').read_text(encoding='utf8'))
rms = [round(fr['rms'], 3) for fr in data['frames']]
html = html.replace('/*RMS*/[]', json.dumps(rms, separators=(',', ':')))

(COMP / 'index.html').write_text(html, encoding='utf8', newline='\n')
print('wrote', COMP / 'index.html', len(html), 'bytes')
