import type { ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '../../components/ui/controls'

/** Shared editor footer: Cancel/Close, status line, Show in folder, primary action. */
export function EditorFooter({
  busy,
  done,
  error,
  output,
  idle,
  primary,
  onPrimary,
  primaryDisabled,
}: {
  busy: boolean
  done: boolean
  error: string | null
  output?: string
  idle: ReactNode
  primary: string
  onPrimary: () => void
  primaryDisabled?: boolean
}) {
  return (
    <>
      <Button variant="ghost" onClick={() => void window.twirly.closeWindow()}>
        {done ? 'Close' : 'Cancel'}
      </Button>
      <div className="min-w-0 flex-1 truncate text-center text-xs" data-testid="editor-status">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : done ? (
          <span className="text-success">Saved {output?.split(/[\\/]/).pop()}</span>
        ) : busy ? (
          <span className="text-fg-2">Saving…</span>
        ) : (
          <span className="text-fg-3">{idle}</span>
        )}
      </div>
      {done && output && (
        <Button onClick={() => void window.twirly.showInFolder(output)}>
          <FolderOpen size={14} /> Show
        </Button>
      )}
      <Button variant="primary" disabled={busy || primaryDisabled} onClick={onPrimary} data-testid="editor-export">
        {primary}
      </Button>
    </>
  )
}
