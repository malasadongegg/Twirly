import { useEffect, useState } from 'react'
import type { FileInfo } from '@shared/types'
import type { EditorContext } from '@shared/ipc'
import { ACTIONS_BY_ID } from '@core/actions/definitions'
import { ImageEditor } from '../image-editor/ImageEditor'
import { PdfEditor } from '../pdf-tools/PdfEditor'
import { MediaEditor } from '../media-tools/MediaEditor'
import { BackgroundEditor } from '../image-editor/BackgroundEditor'
import { RedactEditor } from '../image-editor/RedactEditor'
import { MetadataView } from '../image-editor/MetadataView'
import { AnnotateEditor } from '../image-editor/AnnotateEditor'
import { WindowFrame } from '../../components/FloatingWindow/WindowFrame'

/** Editor window entry: loads its context from main, then mounts the matching editor. */
export function EditorApp() {
  const [ctx, setCtx] = useState<{ context: EditorContext; files: FileInfo[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const context = await window.twirly.editorContext()
      const { files, rejected } = await window.twirly.inspect(context.paths)
      if (files.length === 0) throw new Error(rejected[0]?.reason ?? 'File not available')
      setCtx({ context, files })
    })().catch((e: Error) => setError(e.message))
  }, [])

  if (error || !ctx) {
    return (
      <WindowFrame title="Editor">
        <div className="flex flex-1 items-center justify-center text-sm text-fg-2">{error ?? 'Loading…'}</div>
      </WindowFrame>
    )
  }

  const action = ACTIONS_BY_ID.get(ctx.context.actionId)
  if (action?.editor === 'image') return <ImageEditor actionId={action.id} file={ctx.files[0]!} />
  if (action?.editor === 'background') return <BackgroundEditor actionId={action.id} file={ctx.files[0]!} />
  if (action?.editor === 'redact') return <RedactEditor actionId={action.id} file={ctx.files[0]!} />
  if (action?.editor === 'annotate') return <AnnotateEditor actionId={action.id} file={ctx.files[0]!} />
  if (action?.editor === 'metadata') return <MetadataView file={ctx.files[0]!} />
  if (action?.editor === 'pdf') return <PdfEditor actionId={action.id} file={ctx.files[0]!} />
  if (action?.editor === 'media') return <MediaEditor actionId={action.id} file={ctx.files[0]!} />
  return (
    <WindowFrame title="Editor">
      <div className="flex flex-1 items-center justify-center text-sm text-fg-2">No editor for {ctx.context.actionId}</div>
    </WindowFrame>
  )
}
