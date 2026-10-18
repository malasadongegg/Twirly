import { z } from 'zod'

/** Messages the native helper writes to stdout, one JSON object per line. */
const helperMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), version: z.number() }),
  /** Shift went down while the left button was held and the cursor had moved past the drag threshold. */
  z.object({ type: z.literal('summon'), x: z.number(), y: z.number(), process: z.string().optional() }),
  z.object({ type: z.literal('mouseup') }),
  z.object({ type: z.literal('error'), message: z.string() }),
])

export type HelperMessage = z.infer<typeof helperMessage>

export function parseHelperMessage(line: string): HelperMessage | null {
  try {
    const r = helperMessage.safeParse(JSON.parse(line))
    return r.success ? r.data : null
  } catch {
    return null
  }
}
