import type { PdfWorkerRequest } from '@shared/api'
import { canvasToPng, openPdf, pageLayout, pageText, renderToCanvas, type PdfDoc } from './lib/pdf'

/**
 * Hidden render window. Main sends PDF bytes and page requests; we answer with PNG bytes or
 * text. Running pdf.js here keeps heavy rendering off the main process and uses Chromium's
 * own canvas, so no native canvas module is needed.
 */
const docs = new Map<number, PdfDoc>()
let nextDocId = 1

async function handle(req: PdfWorkerRequest): Promise<unknown> {
  switch (req.op) {
    case 'open': {
      const doc = await openPdf(req.bytes)
      const docId = nextDocId++
      docs.set(docId, doc)
      return { docId, pageCount: doc.numPages }
    }
    case 'render': {
      const doc = docs.get(req.docId)
      if (!doc) throw new Error('Document not open')
      const canvas = await renderToCanvas(doc, req.page, req.dpi, req.maxPixels)
      const png = await canvasToPng(canvas)
      return { png, width: canvas.width, height: canvas.height }
    }
    case 'text': {
      const doc = docs.get(req.docId)
      if (!doc) throw new Error('Document not open')
      return { text: await pageText(doc, req.page) }
    }
    case 'layout': {
      const doc = docs.get(req.docId)
      if (!doc) throw new Error('Document not open')
      return pageLayout(doc, req.page)
    }
    case 'close': {
      await docs.get(req.docId)?.loadingTask.destroy()
      docs.delete(req.docId)
      return null
    }
  }
}

window.twirly.pdfWorker.onRequest((req) => {
  handle(req).then(
    (result) => window.twirly.pdfWorker.respond({ reqId: req.reqId, ok: true, result }),
    (err: Error) => window.twirly.pdfWorker.respond({ reqId: req.reqId, ok: false, error: err?.message ?? String(err) }),
  )
})
