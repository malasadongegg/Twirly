import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '../ui/controls'

/** Frameless floating-tool chrome: draggable title bar, body, sticky footer. */
export function WindowFrame({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="drag-region relative flex h-11 shrink-0 items-center justify-center border-b border-line px-10">
        <IconButton label="Close" className="no-drag absolute left-2" onClick={() => void window.twirly.closeWindow()}>
          <X size={15} />
        </IconButton>
        <div className="min-w-0 text-center">
          <div className="truncate text-[13px] font-semibold">{title}</div>
          {subtitle && <div className="truncate text-[11px] text-fg-3">{subtitle}</div>}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {footer && <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">{footer}</footer>}
    </div>
  )
}
