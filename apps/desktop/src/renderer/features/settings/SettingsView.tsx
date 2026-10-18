import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Check, FolderOpen, RefreshCw, RotateCcw, X } from 'lucide-react'
import type { Diagnostics } from '@shared/api'
import { ACTIONS, DEFAULT_WHEEL_ORDER } from '@core/actions/definitions'
import { MAX_WHEEL_SEGMENTS } from '@core/actions/resolve'
import { Button, FieldRow, IconButton, Segmented, Slider } from '../../components/ui/controls'
import { useSettings } from '../../stores/settings'
import { normalizeAppName, normalizeTrigger, triggerLabel } from '@shared/keys'

const ACCENTS = ['#3b82f6', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444']

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <FieldRow label={label}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-raised'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </FieldRow>
  )
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-success' : 'bg-fg-3'}`} />
      {label}
    </span>
  )
}

/**
 * "Press a key" recorder for the drag-summon trigger. Holding the side modifier key (e.g. Right
 * Shift) while pressing records that exact side; otherwise modifiers are side-agnostic.
 */
function KeyRecorder({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') return setRecording(false)
      const key = normalizeTrigger(e.code)
      if (!key) {
        setError(`${e.key} can't be used (it would interfere with dragging or Windows).`)
        return
      }
      setError(null)
      setRecording(false)
      onChange(key)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <kbd className="min-w-12 rounded-md border border-line-strong bg-bg px-2 py-0.5 text-center text-xs font-semibold" data-testid="trigger-key">
          {recording ? 'Press a key…' : triggerLabel(value)}
        </kbd>
        <Button className="h-7 px-2 text-xs" onClick={() => setRecording((r) => !r)}>
          {recording ? 'Cancel' : 'Change'}
        </Button>
        {value !== 'Shift' && !recording && (
          <IconButton label="Reset to Shift" onClick={() => onChange('Shift')}>
            <RotateCcw size={13} />
          </IconButton>
        )}
      </div>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  )
}

/** Process names the trigger works in when scope is "Chosen apps". */
function AppList({ apps, onChange }: { apps: string[]; onChange: (apps: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)
  const add = () => {
    const name = normalizeAppName(draft)
    if (!name) return setInvalid(true)
    setInvalid(false)
    setDraft('')
    if (!apps.includes(name)) onChange([...apps, name])
  }
  return (
    <div className="rounded-md bg-bg p-2">
      <div className="flex flex-wrap gap-1">
        {apps.map((a) => (
          <span key={a} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px]">
            {a}
            <button type="button" aria-label={`Remove ${a}`} className="text-fg-3 hover:text-fg" onClick={() => onChange(apps.filter((x) => x !== a))}>
              <X size={11} />
            </button>
          </span>
        ))}
        {apps.length === 0 && <span className="text-[11px] text-fg-3">No apps: the trigger is effectively off.</span>}
      </div>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          aria-label="App to add"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. dopus.exe, totalcmd64.exe"
          className={`h-7 flex-1 rounded-md border bg-surface px-2 text-xs outline-none focus:border-accent ${invalid ? 'border-danger' : 'border-line'}`}
        />
        <Button type="submit" className="h-7 px-2 text-xs">
          Add
        </Button>
      </form>
      <p className="mt-1.5 text-[11px] text-fg-3">The trigger works while one of these apps is in front. explorer.exe also covers the desktop.</p>
    </div>
  )
}

/** Visible wheel actions for one file kind, reorderable, with show/hide. */
function WheelEditor({ kind }: { kind: string }) {
  const { settings, update } = useSettings()
  const all = ACTIONS.filter((a) => a.kinds.includes(kind as never))
  const customized = kind in settings.wheelOrder
  const visible = customized ? settings.wheelOrder[kind]! : (DEFAULT_WHEEL_ORDER[kind] ?? all.map((a) => a.id)).slice(0, MAX_WHEEL_SEGMENTS)
  const hidden = all.filter((a) => !visible.includes(a.id))
  const save = (ids: string[]) => void update({ wheelOrder: { ...settings.wheelOrder, [kind]: ids } })
  const move = (i: number, d: -1 | 1) => {
    const next = [...visible]
    ;[next[i], next[i + d]] = [next[i + d]!, next[i]!]
    save(next)
  }
  const label = (id: string) => ACTIONS.find((a) => a.id === id)?.title ?? id

  return (
    <div>
      <ol className="space-y-1" aria-label={`${kind} wheel actions`}>
        {visible.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-md bg-bg px-2 py-1">
            <span className="w-4 text-right text-[11px] text-fg-3 tabular-nums">{i + 1}</span>
            <span className="flex-1 truncate text-xs">{label(id)}</span>
            <IconButton label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={13} />
            </IconButton>
            <IconButton label={`Move ${label(id)} down`} disabled={i === visible.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown size={13} />
            </IconButton>
            <IconButton label={`Hide ${label(id)}`} disabled={visible.length <= 1} onClick={() => save(visible.filter((v) => v !== id))}>
              <X size={13} />
            </IconButton>
          </li>
        ))}
      </ol>
      {hidden.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {hidden.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={visible.length >= MAX_WHEEL_SEGMENTS}
              onClick={() => save([...visible, a.id])}
              className="rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px] text-fg-2 hover:text-fg disabled:opacity-40"
            >
              + {a.title}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px] text-fg-3">
        <span>
          {visible.length}/{MAX_WHEEL_SEGMENTS} segments. Actions that don't fit a file are skipped automatically.
        </span>
        {customized && (
          <Button
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              const rest = { ...settings.wheelOrder }
              delete rest[kind]
              void update({ wheelOrder: rest })
            }}
          >
            <RotateCcw size={12} /> Reset
          </Button>
        )}
      </div>
    </div>
  )
}

export function SettingsView() {
  const { settings, update } = useSettings()
  const [diag, setDiag] = useState<Diagnostics | null>(null)
  const [menuBusy, setMenuBusy] = useState(false)
  const [menuError, setMenuError] = useState<string | null>(null)

  const refresh = (force = false) => void window.twirly.diagnostics(force).then(setDiag)
  useEffect(() => {
    void window.twirly.diagnostics(false).then(setDiag)
  }, [])

  const toggleContextMenu = async () => {
    setMenuBusy(true)
    setMenuError(null)
    try {
      await window.twirly.contextMenu(diag?.contextMenuInstalled ? 'uninstall' : 'install')
      refresh()
    } catch (e) {
      setMenuError((e as Error).message)
    } finally {
      setMenuBusy(false)
    }
  }

  const caps = diag?.capabilities

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4" data-testid="settings-view">
      <Section title="Appearance">
        <FieldRow label="Theme">
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(theme) => void update({ theme })}
            options={[
              { value: 'dark', label: 'Obsidian' },
              { value: 'light', label: 'Light (preview)' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Accent">
          <div className="flex gap-1.5" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={settings.accent === c}
                aria-label={`Accent ${c}`}
                onClick={() => void update({ accent: c })}
                className="flex h-5 w-5 items-center justify-center rounded-full ring-offset-2 ring-offset-surface"
                style={{ background: c, boxShadow: settings.accent === c ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${c}` : undefined }}
              >
                {settings.accent === c && <Check size={11} className="text-white" />}
              </button>
            ))}
          </div>
        </FieldRow>
        <FieldRow label="Animation">
          <Segmented
            label="Animation"
            value={settings.animation}
            onChange={(animation) => void update({ animation })}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'reduced', label: 'Reduced' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </FieldRow>
      </Section>

      <Section title="Output">
        <FieldRow label="Save to">
          <span className="max-w-40 truncate text-xs text-fg-2" title={settings.outputDir ?? undefined}>
            {settings.outputDir ?? 'Next to the original'}
          </span>
          <IconButton
            label="Choose output folder"
            onClick={async () => {
              const dir = await window.twirly.pickDirectory()
              if (dir) void update({ outputDir: dir })
            }}
          >
            <FolderOpen size={14} />
          </IconButton>
          {settings.outputDir && (
            <IconButton label="Save next to the original" onClick={() => void update({ outputDir: null })}>
              <X size={14} />
            </IconButton>
          )}
        </FieldRow>
        <FieldRow label="Name separator">
          <Segmented
            label="Name separator"
            value={settings.naming.separator}
            onChange={(separator) => void update({ naming: { separator } })}
            options={[
              { value: '-', label: 'photo-converted' },
              { value: '_', label: '_' },
              { value: ' ', label: 'space' },
            ]}
          />
        </FieldRow>
        <Slider label="JPG quality" value={settings.quality.jpeg} min={1} max={100} onChange={(jpeg) => void update({ quality: { ...settings.quality, jpeg } })} />
        <Slider label="WEBP quality" value={settings.quality.webp} min={1} max={100} onChange={(webp) => void update({ quality: { ...settings.quality, webp } })} />
        <Slider label="AVIF quality" value={settings.quality.avif} min={1} max={100} onChange={(avif) => void update({ quality: { ...settings.quality, avif } })} />
      </Section>

      <Section title="Explorer integration">
        <Toggle
          label={`${triggerLabel(settings.dragSummon.trigger)} while dragging opens the wheel`}
          checked={settings.dragSummon.enabled}
          onChange={(enabled) => void update({ dragSummon: { ...settings.dragSummon, enabled } })}
        />
        <FieldRow label="Trigger key">
          <KeyRecorder value={settings.dragSummon.trigger} onChange={(trigger) => void update({ dragSummon: { ...settings.dragSummon, trigger } })} />
        </FieldRow>
        <FieldRow label="Works in">
          <Segmented
            label="Drag summon scope"
            value={settings.dragSummon.scope}
            onChange={(scope) => void update({ dragSummon: { ...settings.dragSummon, scope } })}
            options={[
              { value: 'explorer', label: 'Explorer' },
              { value: 'custom', label: 'Chosen apps' },
              { value: 'anywhere', label: 'Any app' },
            ]}
          />
        </FieldRow>
        {settings.dragSummon.scope === 'custom' && (
          <AppList apps={settings.dragSummon.apps} onChange={(apps) => void update({ dragSummon: { ...settings.dragSummon, apps } })} />
        )}
        <FieldRow label="Input helper">
          <StatusDot ok={diag?.helper.state === 'running'} label={diag ? `${diag.helper.state}${diag.helper.detail ? ` · ${diag.helper.detail}` : ''}` : '…'} />
        </FieldRow>
        <FieldRow label='"Open with Twirly" menu'>
          <StatusDot ok={!!diag?.contextMenuInstalled} label={diag?.contextMenuInstalled ? 'Installed' : 'Not installed'} />
          <Button className="h-7 px-2 text-xs" disabled={menuBusy || !diag} onClick={() => void toggleContextMenu()}>
            {diag?.contextMenuInstalled ? 'Remove' : 'Add'}
          </Button>
        </FieldRow>
        {menuError && <p className="text-xs text-danger">{menuError}</p>}
        <p className="text-[11px] leading-relaxed text-fg-3">
          The menu entry is added for your user only (no admin rights). On Windows 11 it appears under "Show more options".
        </p>
      </Section>

      <Section title="Wheel: images">
        <WheelEditor kind="image" />
      </Section>

      <Section title="Startup & tray">
        <Toggle label="Show tray icon" checked={settings.tray.enabled} onChange={(enabled) => void update({ tray: { ...settings.tray, enabled } })} />
        <Toggle
          label="Closing the window keeps Twirly in the tray"
          checked={settings.tray.closeToTray}
          disabled={!settings.tray.enabled}
          onChange={(closeToTray) => void update({ tray: { ...settings.tray, closeToTray } })}
        />
        <Toggle label="Launch at sign-in" checked={settings.startup.launchAtLogin} onChange={(launchAtLogin) => void update({ startup: { ...settings.startup, launchAtLogin } })} />
        <Toggle
          label="Start in the tray"
          checked={settings.startup.startHidden}
          disabled={!settings.startup.launchAtLogin || !settings.tray.enabled}
          onChange={(startHidden) => void update({ startup: { ...settings.startup, startHidden } })}
        />
      </Section>

      <Section title="Diagnostics">
        {caps ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="diagnostics">
            <dt className="text-fg-3">Image input</dt>
            <dd>{caps.imageInput.join(', ').toUpperCase()}</dd>
            <dt className="text-fg-3">Image output</dt>
            <dd>{caps.imageOutput.join(', ').toUpperCase()}</dd>
            <dt className="text-fg-3">FFmpeg</dt>
            <dd>{caps.ffmpeg.available ? `${caps.ffmpeg.version} · ${caps.ffmpeg.encoders.length} encoders` : 'Not found (audio/video actions hidden)'}</dd>
            <dt className="text-fg-3">FFprobe</dt>
            <dd>{caps.ffprobe.available ? 'Available' : 'Not found'}</dd>
            <dt className="text-fg-3">LibreOffice</dt>
            <dd>{caps.libreoffice.available ? 'Available' : 'Not found (document conversion hidden)'}</dd>
            <dt className="text-fg-3">Version</dt>
            <dd>
              {diag.version} · Electron {diag.electron}
            </dd>
          </dl>
        ) : (
          <p className="text-xs text-fg-3">Detecting…</p>
        )}
        <Button className="h-7 px-2 text-xs" onClick={() => refresh(true)}>
          <RefreshCw size={12} /> Re-detect
        </Button>
      </Section>
    </div>
  )
}
