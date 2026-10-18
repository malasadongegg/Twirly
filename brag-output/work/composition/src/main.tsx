import { useState, type CSSProperties, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MotionGlobalConfig } from 'motion/react'
import { FileText, Film } from 'lucide-react'
import './comp.css'
import { RadialWheel, wheelGeometry, type WheelItem } from '@renderer/components/RadialWheel/RadialWheel'
import { JobToast } from '@renderer/components/ProgressIndicator/JobToast'
import { resolveActions } from '@core/actions/resolve'
import { hitTest, polar, segmentCenterAngle } from '@core/wheel/geometry'
import type { Capabilities, FileInfo, JobProgress } from '@shared/types'

// Every frame is a pure function of t: Motion's own animations are switched off and all motion
// below is computed from the timeline.
MotionGlobalConfig.skipAnimations = true

export const DURATION = 21.6
const W = 1920
const H = 1080

// ---------- timing helpers ----------
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const k = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
const outCubic = (p: number) => 1 - (1 - p) ** 3
const inOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
const outBack = (p: number) => {
  const c = 1.15
  return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2
}
/** Visibility envelope: fades in over `inDur` from a, out over `outDur` ending at b. */
const env = (t: number, a: number, b: number, inDur = 0.25, outDur = 0.2) => Math.min(outCubic(k(t, a, a + inDur)), 1 - k(t, b - outDur, b))

type Key = { t: number; x: number; y: number }
function path(t: number, keys: Key[]): { x: number; y: number } {
  if (t <= keys[0]!.t) return keys[0]!
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!
    const b = keys[i]!
    if (t <= b.t) {
      const p = inOutCubic(k(t, a.t, b.t))
      return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) }
    }
  }
  return keys.at(-1)!
}

// ---------- real data: what Twirly's wheel shows for each file ----------
const CAPS: Capabilities = {
  imageInput: ['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'heic'],
  imageOutput: ['png', 'jpeg', 'webp', 'avif', 'tiff', 'bmp'],
  ffmpeg: { available: true, path: 'ffmpeg', encoders: ['libx264', 'aac', 'libvpx-vp9', 'libopus', 'gif', 'libmp3lame', 'pcm_s16le', 'flac', 'libvorbis'] },
  ffprobe: { available: true, path: 'ffprobe' },
  libreoffice: { available: false },
}
const file = (name: string, kind: FileInfo['kind'], format: string): FileInfo => ({ path: `C:\\Demo\\${name}`, name, ext: format, size: 2_516_582, kind, format, extensionMismatch: false })
const items = (f: FileInfo): WheelItem[] => resolveActions([f], CAPS).actions.map((a) => ({ id: a.id, label: a.label, title: a.title, icon: a.icon }))
const IMAGE_ITEMS = items(file('sunset.png', 'image', 'png'))
const PDF_ITEMS = items(file('contract.pdf', 'pdf', 'pdf'))
const VIDEO_ITEMS = items(file('launch-clip.mov', 'video', 'mov'))

// The wheel renders at its native size (so labels keep their designed proportions) and is
// scaled up as vector art. Hit testing uses the same geometry, divided by the scale.
const NATIVE = 320
const S = 1.95
const WHEEL = NATIVE * S
const seg = (cx: number, cy: number, i: number, count: number) => {
  const g = wheelGeometry(NATIVE, count)
  const p = polar((g.inner + g.outer) / 2, segmentCenterAngle(i, count))
  return { x: cx + p.x * S, y: cy + p.y * S }
}
const activeAt = (cx: number, cy: number, cursor: { x: number; y: number }, count: number) =>
  hitTest((cursor.x - cx) / S, (cursor.y - cy) / S, wheelGeometry(NATIVE, count))

// ---------- building blocks ----------
const abs = (x: number, y: number, extra: CSSProperties = {}): CSSProperties => ({ position: 'absolute', left: x, top: y, ...extra })

function Caption({ t, a, b, children, y = 118, size = 68 }: { t: number; a: number; b: number; children: ReactNode; y?: number; size?: number }) {
  const v = env(t, a, b, 0.3, 0.22)
  if (v <= 0) return null
  return (
    <div
      style={{ ...abs(0, y), width: W, textAlign: 'center', opacity: v, transform: `translateY(${(1 - v) * 18}px)`, fontSize: size, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'var(--font-display)', color: 'var(--color-fg)' }}
    >
      {children}
    </div>
  )
}

const Accent = ({ children }: { children: ReactNode }) => <span style={{ color: 'var(--color-accent-hover)' }}>{children}</span>

function Cursor({ x, y, pressed = false, opacity = 1 }: { x: number; y: number; pressed?: boolean; opacity?: number }) {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" style={{ ...abs(x - 3, y - 2), opacity, transform: `scale(${pressed ? 0.9 : 1})`, transformOrigin: '3px 2px', filter: 'drop-shadow(0 3px 6px rgb(0 0 0 / .55))', zIndex: 50 }}>
      <path d="M3 2 L3 19 L7.5 14.8 L10.4 21.4 L13.2 20.2 L10.4 13.8 L16.6 13.6 Z" fill="#fff" stroke="#0b0f14" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function FileTile({ x, y, label, opacity = 1, scale = 1, highlight = false, icon }: { x: number; y: number; label: string; opacity?: number; scale?: number; highlight?: boolean; icon?: ReactNode }) {
  return (
    <div style={{ ...abs(x - 90, y - 90), width: 180, opacity, transform: `scale(${scale})`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: 132,
          height: 132,
          borderRadius: 22,
          overflow: 'hidden',
          background: 'var(--color-elevated)',
          border: `1px solid ${highlight ? 'rgb(96 165 250 / .9)' : 'var(--color-line-strong)'}`,
          boxShadow: highlight ? '0 0 0 4px rgb(59 130 246 / .25), 0 0 48px rgb(59 130 246 / .45)' : '0 14px 30px rgb(0 0 0 / .5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon ?? <img src="./sunset.png" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{ padding: '4px 12px', borderRadius: 8, background: highlight ? 'var(--color-accent)' : 'rgb(59 130 246 / .85)', color: '#fff', fontSize: 20, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  )
}

function Wheel({ cx, cy, list, active, hub, bloom, exit = 0 }: { cx: number; cy: number; list: WheelItem[]; active: number | null; hub: string; bloom: number; exit?: number }) {
  const p = outBack(clamp01(bloom))
  const scale = S * lerp(0.55, 1, p) * lerp(1, 0.92, exit)
  const opacity = Math.min(outCubic(clamp01(bloom * 1.6)), 1 - exit)
  if (opacity <= 0) return null
  return (
    <div style={{ ...abs(cx - NATIVE / 2, cy - NATIVE / 2), width: NATIVE, height: NATIVE, transform: `scale(${scale})`, opacity, filter: `drop-shadow(0 16px 30px rgb(0 0 0 / .55))` }}>
      <RadialWheel items={list} activeIndex={active} hubLabel={hub} size={NATIVE} />
    </div>
  )
}

function Ring({ cx, cy, p }: { cx: number; cy: number; p: number }) {
  if (p <= 0 || p >= 1) return null
  const r = lerp(300, 460, outCubic(p))
  return <div style={{ ...abs(cx - r, cy - r), width: r * 2, height: r * 2, borderRadius: '50%', border: '2px solid rgb(96 165 250)', opacity: (1 - p) * 0.7, boxShadow: '0 0 40px rgb(59 130 246 / .6)' }} />
}

function Background({ t }: { t: number }) {
  const glow = 0.11 + 0.04 * outCubic(k(t, 2.0, 2.6)) - 0.04 * k(t, 21, 21.6)
  return (
    <>
      <div style={{ ...abs(0, 0), width: W, height: H, background: '#0b0f14' }} />
      <div style={{ ...abs(0, 0), width: W, height: H, background: `radial-gradient(1100px 700px at 50% 52%, rgb(59 130 246 / ${glow}), transparent 70%)` }} />
      <div style={{ ...abs(0, 0), width: W, height: H, opacity: 0.35, backgroundImage: 'radial-gradient(rgb(255 255 255 / .07) 1.2px, transparent 1.2px)', backgroundSize: '36px 36px' }} />
    </>
  )
}

// ---------- scenes ----------
function Hook({ t }: { t: number }) {
  if (t > 6.6) return null
  const cursor = path(t, [
    { t: 0, x: 380, y: 760 },
    { t: 0.55, x: 575, y: 575 },
    { t: 0.8, x: 575, y: 575 },
    { t: 1.9, x: 960, y: 540 },
    { t: 2.75, x: 960, y: 540 },
    ...[0, 1, 2, 3].map((i, n) => ({ t: 3.0 + n * 0.7, ...seg(960, 540, i, IMAGE_ITEMS.length) })),
    { t: 5.95, ...seg(960, 540, 0, IMAGE_ITEMS.length) },
  ])
  const dragging = t >= 0.8
  const bloom = k(t, 2.12, 2.5)
  const wheelActive = t >= 2.3 ? activeAt(960, 540, cursor, IMAGE_ITEMS.length) : null
  const drop = k(t, 6.34, 6.52)
  const key = env(t, 1.2, 2.75, 0.2, 0.25)
  const pressed = t >= 1.42 && t < 2.45
  return (
    <>
      <Caption t={t} a={0.15} b={1.38}>Drag a file.</Caption>
      <Caption t={t} a={1.42} b={2.62}>
        Tap <Accent>Shift</Accent>.
      </Caption>
      <Caption t={t} a={2.72} b={4.2}>
        Meet <Accent>Twirly</Accent>.
      </Caption>
      <Caption t={t} a={4.23} b={6.3}>
        Every action, right where you drag.
      </Caption>

      <FileTile x={560} y={560} label="sunset.png" opacity={dragging ? 0.45 : env(t, 0, 99, 0.3)} />
      <Ring cx={960} cy={540} p={k(t, 2.12, 2.75)} />
      <Wheel cx={960} cy={540} list={IMAGE_ITEMS} active={drop > 0 ? 0 : wheelActive} hub="2.4 MB" bloom={bloom} exit={drop} />
      {dragging && t < 6.4 && <FileTile x={cursor.x + 46} y={cursor.y + 58} label="sunset.png" scale={lerp(0.42, 0.34, bloom)} opacity={lerp(0.92, 0.55, bloom) * (1 - drop)} />}

      {key > 0 && (
        <div
          style={{
            ...abs(960 - 120, 880),
            width: 240,
            height: 86,
            opacity: key,
            transform: `translateY(${(1 - key) * 30 + (pressed ? 6 : 0)}px)`,
            borderRadius: 16,
            background: pressed ? 'var(--color-accent)' : 'var(--color-elevated)',
            border: '1px solid var(--color-line-strong)',
            boxShadow: pressed ? '0 2px 0 #1d4ed8, 0 0 40px rgb(59 130 246 / .55)' : '0 8px 0 #0b0f14, 0 14px 30px rgb(0 0 0 / .5)',
            color: '#fff',
            fontSize: 34,
            fontWeight: 650,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ⇧ Shift
        </div>
      )}
      {t < 6.6 && <Cursor x={cursor.x} y={cursor.y} pressed={t >= 6.3 && t < 6.45} opacity={1 - k(t, 6.4, 6.6)} />}
    </>
  )
}

function Convert({ t }: { t: number }) {
  if (t < 6.4 || t > 10.6) return null
  const toast = env(t, 6.45, 8.15, 0.3, 0.22)
  const fraction = outCubic(k(t, 6.6, 7.3))
  const done = t >= 7.35
  const progress: JobProgress = {
    jobId: 'demo',
    actionId: 'image.convert.jpeg',
    title: 'Convert to JPG',
    status: done ? 'done' : 'running',
    completed: done ? 1 : 0,
    total: 1,
    fraction: done ? 1 : fraction,
    outputs: done ? ['C:\\Demo\\sunset-converted.jpg'] : [],
  }
  const tiles = k(t, 8.15, 8.55)
  const out = 1 - k(t, 10.32, 10.52)
  return (
    <div style={{ opacity: out }}>
      {toast > 0 && (
        // A fixed-size box centred on screen, scaled about its own centre.
        <div style={{ ...abs(960 - 144, 500), width: 288, transform: `translateY(${(1 - toast) * 20}px) scale(2)`, transformOrigin: '50% 50%', opacity: toast }}>
          <JobToast title={progress.title} progress={progress} onCancel={() => undefined} onDismiss={() => undefined} />
        </div>
      )}
      <FileTile x={790} y={560} label="sunset.png" opacity={outCubic(tiles)} scale={lerp(0.85, 1, outCubic(tiles))} />
      <FileTile x={1130} y={560} label="sunset-converted.jpg" highlight opacity={outCubic(k(t, 8.3, 8.6))} scale={lerp(0.6, 1, outBack(k(t, 8.3, 8.7)))} />
      <Caption t={t} a={8.35} b={10.3}>
        Converted. <span style={{ color: 'var(--color-fg-2)' }}>Original untouched.</span>
      </Caption>
    </div>
  )
}

function KnowsTheFile({ t }: { t: number }) {
  if (t < 10.5 || t > 14.8) return null
  const cx = 1280
  const cy = 560
  const pdf = t < 12.6
  const list = pdf ? PDF_ITEMS : VIDEO_ITEMS
  const a = pdf ? 10.54 : 12.65
  const hover = pdf ? [0, 1, 3] : [0, 2, 4]
  const cursor = path(t, [
    { t: a, x: cx - 40, y: cy + 40 },
    ...hover.map((i, n) => ({ t: a + 0.45 + n * 0.55, ...seg(cx, cy, i, list.length) })),
  ])
  const exit = pdf ? k(t, 12.45, 12.62) : k(t, 14.55, 14.75)
  const bloom = k(t, a, a + 0.38)
  const chip = env(t, a + 0.05, pdf ? 12.6 : 14.75, 0.3, 0.15)
  return (
    <>
      <Ring cx={cx} cy={cy} p={k(t, a, a + 0.6)} />
      <Wheel cx={cx} cy={cy} list={list} active={t > a + 0.3 ? activeAt(cx, cy, cursor, list.length) : null} hub={pdf ? '1.1 MB' : '48.2 MB'} bloom={bloom} exit={exit} />
      <Cursor x={cursor.x} y={cursor.y} opacity={Math.min(k(t, a + 0.25, a + 0.4), 1 - exit)} />
      <div style={{ ...abs(250, 380), width: 640, opacity: chip, transform: `translateX(${(1 - chip) * -30}px)` }}>
        <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.08, fontFamily: 'var(--font-display)' }}>
          {pdf ? (
            <>
              PDFs get
              <br />
              <Accent>PDF tools.</Accent>
            </>
          ) : (
            <>
              Video gets
              <br />
              <Accent>video tools.</Accent>
            </>
          )}
        </div>
        <div style={{ marginTop: 34, display: 'inline-flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderRadius: 14, background: 'var(--color-surface)', border: '1px solid var(--color-line-strong)', fontSize: 26, color: 'var(--color-fg-2)' }}>
          {pdf ? <FileText size={30} color="#60a5fa" /> : <Film size={30} color="#60a5fa" />}
          {pdf ? 'contract.pdf' : 'launch-clip.mov'}
        </div>
      </div>
    </>
  )
}

const EDITORS = ['crop', 'annotate', 'redact', 'background']

function Editors({ t }: { t: number }) {
  if (t < 14.7 || t > 18.5) return null
  const out = 1 - k(t, 18.22, 18.44)
  const drift = 1 + 0.025 * k(t, 15.4, 18.44)
  return (
    <div style={{ opacity: out }}>
      <Caption t={t} a={14.95} b={18.3}>
        Quick editors, <Accent>one drop away.</Accent>
      </Caption>
      <div style={{ ...abs(0, 0), width: W, height: H, transform: `scale(${drift})`, transformOrigin: '50% 60%' }}>
        {EDITORS.map((name, i) => {
          const p = outCubic(k(t, 14.9 + i * 0.18, 15.45 + i * 0.18))
          const rot = [-5, -1.6, 1.6, 5][i]!
          const cx = 390 + i * 380
          const yOff = [26, 0, 0, 26][i]!
          return (
            <img
              key={name}
              src={`./${name}.png`}
              style={{
                ...abs(cx - 244, 290 + yOff),
                width: 488,
                height: 640,
                borderRadius: 18,
                border: '1px solid var(--color-line-strong)',
                boxShadow: '0 40px 80px rgb(0 0 0 / .6)',
                opacity: p,
                transform: `translateY(${(1 - p) * 140}px) rotate(${rot}deg) scale(${lerp(0.92, 1, p)})`,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function Outro({ t }: { t: number }) {
  if (t < 18.4) return null
  const icon = k(t, 18.44, 18.86)
  const word = env(t, 18.65, 99, 0.35)
  const tag = env(t, 19.0, 99, 0.35)
  const foot = env(t, 19.4, 99, 0.35)
  const fade = 1 - k(t, 21.05, 21.6)
  return (
    <div style={{ opacity: fade }}>
      <div style={{ ...abs(960 - 260, 300 - 260), width: 520, height: 520, borderRadius: '50%', background: `radial-gradient(circle, rgb(59 130 246 / ${0.35 * outCubic(icon)}), transparent 65%)` }} />
      <img src="./icon.png" style={{ ...abs(960 - 105, 300 - 105), width: 210, height: 210, opacity: outCubic(icon), transform: `scale(${lerp(0.6, 1, outBack(icon))}) rotate(${lerp(-40, 0, outCubic(icon))}deg)` }} />
      <div style={{ ...abs(0, 450), width: W, textAlign: 'center', fontSize: 124, fontWeight: 700, letterSpacing: '-0.03em', fontFamily: 'var(--font-display)', opacity: word, transform: `translateY(${(1 - word) * 20}px)` }}>Twirly</div>
      <div style={{ ...abs(0, 612), width: W, textAlign: 'center', fontSize: 52, fontWeight: 600, opacity: tag, transform: `translateY(${(1 - tag) * 16}px)` }}>
        Drag<Accent>.</Accent> Shift<Accent>.</Accent> Done<Accent>.</Accent>
      </div>
      <div style={{ ...abs(0, 740), width: W, textAlign: 'center', fontSize: 28, color: 'var(--color-fg-2)', opacity: foot }}>For Windows 10 &amp; 11 · Runs locally, your files never leave your PC</div>
    </div>
  )
}

function Frame({ t }: { t: number }) {
  return (
    <div style={{ position: 'relative', width: W, height: H, overflow: 'hidden', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)' }}>
      <Background t={t} />
      <Hook t={t} />
      <Convert t={t} />
      <KnowsTheFile t={t} />
      <Editors t={t} />
      <Outro t={t} />
    </div>
  )
}

// ---------- render harness ----------
let setTime: (t: number) => void = () => undefined
function App() {
  const [t, setT] = useState(() => Number(new URLSearchParams(location.search).get('t') ?? 0))
  setTime = setT
  return <Frame t={t} />
}
createRoot(document.getElementById('root')!).render(<App />)

const images = ['sunset.png', 'icon.png', ...EDITORS.map((e) => `${e}.png`)]
const ready = Promise.all(
  images.map(
    (src) =>
      new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = img.onerror = () => resolve()
        img.src = `./${src}`
      }),
  ),
).then(() => document.fonts.ready)

declare global {
  interface Window {
    __render: (t: number) => Promise<void>
    __duration: number
  }
}
window.__duration = DURATION
window.__render = async (t: number) => {
  await ready
  flushSync(() => setTime(t))
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
}
