import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import type { FileInfo } from '@shared/types'
import type { ImageMetadata } from '@shared/api'
import { formatBytes } from '@core/format/bytes'
import { WindowFrame } from '../../components/FloatingWindow/WindowFrame'
import { EditorFooter } from './EditorFooter'
import { cleanError, useEditorJob, useImagePreview } from './useImageJob'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-fg-3">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  )
}

/** Read-only view of what an image reveals, with one-click "remove metadata". */
export function MetadataView({ file }: { file: FileInfo }) {
  const { preview } = useImagePreview(file.path, 400)
  const [meta, setMeta] = useState<ImageMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  const job = useEditorJob('image.strip-metadata', file.path)

  useEffect(() => {
    window.twirly
      .imageMetadata(file.path)
      .then(setMeta)
      .catch((e) => setError(cleanError(e)))
  }, [file.path])

  const groups = meta ? [...new Set(meta.exif.fields.map((f) => f.group))].filter((g) => g !== 'Location') : []
  const anyMeta = meta && (meta.hasExif || meta.hasXmp || meta.hasIptc)

  return (
    <WindowFrame
      title="Metadata"
      subtitle={file.name}
      footer={
        <EditorFooter
          {...job}
          idle={anyMeta ? 'Saves a clean copy' : 'No personal metadata found'}
          primary="Remove metadata"
          primaryDisabled={!anyMeta}
          onPrimary={() => void job.run({})}
        />
      }
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" data-testid="metadata-view">
        {error && <div className="text-sm text-danger">{error}</div>}
        <div className="flex gap-3">
          {preview && <img src={preview.dataUrl} alt="" className="h-24 w-24 shrink-0 rounded-md object-cover" />}
          {meta && (
            <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <Row label="Format" value={meta.format.toUpperCase()} />
              <Row label="Size" value={`${meta.width} × ${meta.height} px · ${formatBytes(file.size)}`} />
              <Row label="Color" value={`${meta.space === 'srgb' ? 'sRGB' : (meta.space ?? '?')}${meta.hasAlpha ? ' + alpha' : ''}${meta.iccProfile ? ' · ICC profile' : ''}`} />
              {meta.density && <Row label="Density" value={`${meta.density} dpi`} />}
              <Row label="Embedded" value={[meta.hasExif && 'EXIF', meta.hasXmp && 'XMP', meta.hasIptc && 'IPTC'].filter(Boolean).join(', ') || 'None'} />
            </dl>
          )}
        </div>

        {meta?.exif.gps && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs" data-testid="gps-warning">
            <MapPin size={15} className="mt-px shrink-0 text-danger" />
            <div>
              <div className="font-semibold text-fg">This photo contains its location</div>
              <div className="mt-0.5 text-fg-2 tabular-nums">
                {meta.exif.gps.lat.toFixed(5)}, {meta.exif.gps.lon.toFixed(5)}
                {meta.exif.gps.altitude !== undefined ? ` · ${Math.round(meta.exif.gps.altitude)} m` : ''}
              </div>
              <div className="mt-1 text-fg-3">Anyone you share the original with can see where it was taken.</div>
            </div>
          </div>
        )}

        {groups.map((g) => (
          <section key={g} className="rounded-lg bg-surface p-3">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{g}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {meta!.exif.fields
                .filter((f) => f.group === g)
                .map((f) => (
                  <Row key={f.label} label={f.label} value={f.value} />
                ))}
            </dl>
          </section>
        ))}
        {meta && meta.exif.fields.length === 0 && meta.hasExif && <p className="text-xs text-fg-3">EXIF is present but holds none of the common fields.</p>}
      </div>
    </WindowFrame>
  )
}
