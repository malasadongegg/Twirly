import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FolderOpen, Pause, Play, X } from 'lucide-react'
import type { FileInfo, MediaInfo } from '@shared/types'
import { AUDIO_FORMATS, VIDEO_FORMATS, type MediaFormat } from '@core/actions/media-actions'
import { formatBytes } from '@core/format/bytes'
import { WindowFrame } from '../../components/FloatingWindow/WindowFrame'
import { Button, FieldRow, IconButton, Segmented } from '../../components/ui/controls'
import { useJob } from '../../hooks/useJob'

const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 75.25 → "1:15.2" */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00.0'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** "1:15.2" or "75.2" → 75.2; null when unparseable. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n) || n < 0) || parts.length === 0 || parts.length > 3) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="flex items-center gap-1.5 text-xs text-fg-2">
      {label}
      <input
        aria-label={label}
        value={draft ?? formatTime(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = draft !== null ? parseTime(draft) : null
          if (v !== null) onCommit(v)
          setDraft(null)
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-7 w-20 rounded-md border border-line bg-bg px-2 text-[13px] text-fg tabular-nums outline-none focus:border-accent"
      />
    </label>
  )
}

/** Trim timeline: a track with start/end handles and a playhead. */
function Timeline({
  duration,
  start,
  end,
  current,
  onChange,
  onSeek,
}: {
  duration: number
  start: number
  end: number
  current: number
  onChange: (start: number, end: number) => void
  onSeek: (t: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef<'start' | 'end' | null>(null)
  const pct = (t: number) => `${(t / duration) * 100}%`
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(Math.max(((clientX - r.left) / r.width) * duration, 0), duration)
  }
  const MIN = Math.min(0.1, duration / 10)

  const onMove = (e: ReactPointerEvent) => {
    if (!dragging.current) return
    const t = timeAt(e.clientX)
    if (dragging.current === 'start') onChange(Math.min(t, end - MIN), end)
    else onChange(start, Math.max(t, start + MIN))
  }
  const handle = (which: 'start' | 'end') => (e: ReactPointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragging.current = which
  }
  const key = (which: 'start' | 'end') => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1
    const d = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    if (!d) return
    e.preventDefault()
    if (which === 'start') onChange(Math.min(Math.max(start + d, 0), end - MIN), end)
    else onChange(start, Math.max(Math.min(end + d, duration), start + MIN))
  }

  return (
    <div
      ref={ref}
      data-testid="timeline"
      className="relative h-10 cursor-pointer select-none rounded-md bg-bg"
      onPointerDown={(e) => onSeek(timeAt(e.clientX))}
      onPointerMove={onMove}
      onPointerUp={() => (dragging.current = null)}
    >
      <div className="absolute inset-y-0 rounded-md bg-accent/25 ring-1 ring-accent" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
      <div className="pointer-events-none absolute inset-y-0 w-px bg-white" style={{ left: pct(current) }} />
      {(['start', 'end'] as const).map((w) => (
        <div
          key={w}
          role="slider"
          tabIndex={0}
          aria-label={w === 'start' ? 'Trim start' : 'Trim end'}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={w === 'start' ? start : end}
          onPointerDown={handle(w)}
          onPointerMove={onMove}
          onPointerUp={() => (dragging.current = null)}
          onKeyDown={key(w)}
          className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white shadow outline-accent"
          style={{ left: pct(w === 'start' ? start : end) }}
        />
      ))}
    </div>
  )
}

export function MediaEditor({ actionId, file }: { actionId: string; file: FileInfo }) {
  const isVideo = actionId === 'video.edit'
  const [src, setSrc] = useState<{ url: string; info: MediaInfo } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [format, setFormat] = useState<MediaFormat>(isVideo ? 'mp4' : 'mp3')
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('medium')
  const [height, setHeight] = useState<number | 0>(0)
  const [kbps, setKbps] = useState(192)
  const [removeAudio, setRemoveAudio] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const progress = useJob(jobId)
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)

  useEffect(() => {
    let alive = true
    window.twirly
      .mediaOpen(file.path)
      .then((r) => {
        if (!alive) return
        setSrc(r)
        setRange({ start: 0, end: r.info.durationSec })
      })
      .catch((e) => alive && setLoadError(cleanError(e)))
    return () => {
      alive = false
    }
  }, [file.path])

  const info = src?.info
  const duration = info?.durationSec ?? 0
  const busy = progress?.status === 'running' || progress?.status === 'queued' || (jobId !== null && !progress)
  const done = progress?.status === 'done'
  const outputs = done ? progress.outputs : []
  const isLossyAudio = format === 'mp3' || format === 'm4a' || format === 'ogg'
  const formats = isVideo ? [...VIDEO_FORMATS, 'mp3', 'm4a'] as MediaFormat[] : AUDIO_FORMATS
  const heights = [2160, 1440, 1080, 720, 480, 360].filter((h) => h < (info?.video?.height ?? 0))

  const seek = (t: number) => {
    if (mediaRef.current) mediaRef.current.currentTime = t
    setCurrent(t)
  }
  const togglePlay = () => {
    const m = mediaRef.current
    if (!m) return
    if (m.paused) {
      if (m.currentTime < range.start || m.currentTime >= range.end - 0.05) m.currentTime = range.start
      void m.play()
    } else m.pause()
  }

  const submit = async () => {
    setSubmitError(null)
    const params: Record<string, unknown> = { start: range.start, end: range.end, format, quality }
    if (isVideo && height) params.height = height
    if (isVideo && removeAudio) params.removeAudio = true
    if (isLossyAudio) params.audioKbps = kbps
    try {
      const { jobId: id } = await window.twirly.runJob({ actionId, paths: [file.path], params })
      setJobId(id)
    } catch (e) {
      setSubmitError(cleanError(e))
    }
  }

  const pctDone = Math.round(((progress?.fraction ?? 0) * 100) | 0)

  return (
    <WindowFrame
      title={isVideo ? 'Trim video' : 'Trim audio'}
      subtitle={`${file.name} · ${formatTime(duration)} · ${formatBytes(file.size)}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => void window.twirly.closeWindow()}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          <div className="min-w-0 flex-1 text-center text-xs" data-testid="editor-status">
            {submitError || progress?.status === 'failed' ? (
              <span className="text-danger" title={progress?.error?.detail}>
                {submitError ?? progress?.error?.message}
              </span>
            ) : done ? (
              <span className="text-success">Saved {outputs.at(-1)?.split(/[\\/]/).pop()}</span>
            ) : progress?.status === 'cancelled' ? (
              <span className="text-fg-2">Cancelled</span>
            ) : busy ? (
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${pctDone}%` }} />
                </div>
                <span className="tabular-nums text-fg-2">{pctDone}%</span>
                <IconButton label="Cancel export" onClick={() => jobId && void window.twirly.cancelJob(jobId)}>
                  <X size={13} />
                </IconButton>
              </div>
            ) : (
              <span className="text-fg-3 tabular-nums">Output {formatTime(range.end - range.start)}</span>
            )}
          </div>
          {done && outputs.at(-1) && (
            <Button onClick={() => void window.twirly.showInFolder(outputs.at(-1)!)}>
              <FolderOpen size={14} /> Show
            </Button>
          )}
          <Button variant="primary" disabled={!src || busy} onClick={() => void submit()} data-testid="editor-export">
            Export
          </Button>
        </>
      }
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {loadError && <div className="rounded-lg bg-surface p-6 text-center text-sm text-danger">{loadError}</div>}
        {src && (
          <div className="overflow-hidden rounded-lg bg-black">
            {isVideo ? (
              <video
                ref={mediaRef}
                src={src.url}
                className="mx-auto block max-h-56 w-full object-contain"
                onTimeUpdate={(e) => {
                  const t = e.currentTarget.currentTime
                  setCurrent(t)
                  if (t >= range.end) e.currentTarget.pause()
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                data-testid="media-preview"
              />
            ) : (
              <audio
                ref={mediaRef}
                src={src.url}
                onTimeUpdate={(e) => {
                  const t = e.currentTarget.currentTime
                  setCurrent(t)
                  if (t >= range.end) e.currentTarget.pause()
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                data-testid="media-preview"
              />
            )}
          </div>
        )}
        {!src && !loadError && <div className="h-40 animate-pulse rounded-lg bg-surface" />}

        {src && (
          <>
            <div className="flex items-center gap-2">
              <IconButton label={playing ? 'Pause' : 'Play selection'} onClick={togglePlay}>
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </IconButton>
              <span className="text-xs text-fg-2 tabular-nums">{formatTime(current)}</span>
              <div className="ml-auto flex gap-1">
                <Button className="h-7 px-2 text-xs" onClick={() => setRange((r) => ({ ...r, start: Math.min(current, r.end - 0.1) }))}>
                  Set start
                </Button>
                <Button className="h-7 px-2 text-xs" onClick={() => setRange((r) => ({ ...r, end: Math.max(current, r.start + 0.1) }))}>
                  Set end
                </Button>
              </div>
            </div>
            <Timeline duration={duration} start={range.start} end={range.end} current={current} onChange={(start, end) => setRange({ start, end })} onSeek={seek} />
            <div className="flex justify-between">
              <TimeField label="Start" value={range.start} onCommit={(v) => setRange((r) => ({ ...r, start: Math.min(Math.max(v, 0), r.end - 0.1) }))} />
              <TimeField label="End" value={range.end} onCommit={(v) => setRange((r) => ({ ...r, end: Math.max(Math.min(v, duration), r.start + 0.1) }))} />
            </div>

            <FieldRow label="Format">
              <Segmented label="Output format" value={format} onChange={setFormat} options={formats.map((f) => ({ value: f, label: f.toUpperCase() }))} />
            </FieldRow>
            {(format === 'mp4' || format === 'webm' || format === 'gif') && (
              <>
                <FieldRow label="Quality">
                  <Segmented
                    label="Quality"
                    value={quality}
                    onChange={setQuality}
                    options={[
                      { value: 'high', label: 'High' },
                      { value: 'medium', label: 'Balanced' },
                      { value: 'low', label: 'Small' },
                    ]}
                  />
                </FieldRow>
                {heights.length > 0 && (
                  <FieldRow label="Resolution">
                    <Segmented
                      label="Resolution"
                      value={String(height)}
                      onChange={(v) => setHeight(Number(v))}
                      options={[{ value: '0', label: 'Original' }, ...heights.map((h) => ({ value: String(h), label: `${h}p` }))]}
                    />
                  </FieldRow>
                )}
                {format !== 'gif' && info?.audio && (
                  <FieldRow label="Audio">
                    <Segmented
                      label="Audio track"
                      value={removeAudio ? 'off' : 'on'}
                      onChange={(v) => setRemoveAudio(v === 'off')}
                      options={[
                        { value: 'on', label: 'Keep' },
                        { value: 'off', label: 'Remove' },
                      ]}
                    />
                  </FieldRow>
                )}
              </>
            )}
            {isLossyAudio && (
              <FieldRow label="Bitrate">
                <Segmented label="Audio bitrate" value={String(kbps)} onChange={(v) => setKbps(Number(v))} options={[128, 192, 256, 320].map((k) => ({ value: String(k), label: `${k}k` }))} />
              </FieldRow>
            )}

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg bg-surface p-3 text-[11px]" data-testid="media-info">
              <dt className="text-fg-3">Container</dt>
              <dd>{file.format.toUpperCase()}</dd>
              {info!.video && (
                <>
                  <dt className="text-fg-3">Video</dt>
                  <dd>
                    {info!.video.codec} · {info!.video.width}×{info!.video.height}
                    {info!.video.fps ? ` · ${info!.video.fps} fps` : ''}
                  </dd>
                </>
              )}
              {info!.audio && (
                <>
                  <dt className="text-fg-3">Audio</dt>
                  <dd>
                    {info!.audio.codec}
                    {info!.audio.sampleRate ? ` · ${info!.audio.sampleRate / 1000} kHz` : ''}
                    {info!.audio.channels ? ` · ${info!.audio.channels} ch` : ''}
                  </dd>
                </>
              )}
              {info!.bitRate && (
                <>
                  <dt className="text-fg-3">Bitrate</dt>
                  <dd>{Math.round(info!.bitRate / 1000)} kb/s</dd>
                </>
              )}
            </dl>
          </>
        )}
      </div>
    </WindowFrame>
  )
}
