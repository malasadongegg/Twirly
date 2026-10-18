/**
 * Trigger keys for drag-summon. Stored as a KeyboardEvent.code (or a side-agnostic modifier
 * name) and translated to Windows virtual-key codes for the native helper.
 */

const MODIFIERS: Record<string, { label: string; vks: number[] }> = {
  Shift: { label: 'Shift', vks: [0x10, 0xa0, 0xa1] },
  Control: { label: 'Ctrl', vks: [0x11, 0xa2, 0xa3] },
  Alt: { label: 'Alt', vks: [0x12, 0xa4, 0xa5] },
}

const NAMED: Record<string, [string, number]> = {
  Space: ['Space', 0x20],
  Tab: ['Tab', 0x09],
  CapsLock: ['Caps Lock', 0x14],
  Backquote: ['`', 0xc0],
  ShiftLeft: ['Left Shift', 0xa0],
  ShiftRight: ['Right Shift', 0xa1],
  ControlLeft: ['Left Ctrl', 0xa2],
  ControlRight: ['Right Ctrl', 0xa3],
  AltLeft: ['Left Alt', 0xa4],
  AltRight: ['Right Alt', 0xa5],
}

/** Keys that cannot be triggers: Esc cancels drags, Win opens Start, Enter/Backspace are risky. */
const FORBIDDEN = new Set(['Escape', 'MetaLeft', 'MetaRight', 'Enter', 'NumpadEnter', 'Backspace', 'Delete'])

/** Windows VK codes for a trigger key id, or null when unsupported. */
export function triggerVks(key: string): number[] | null {
  if (FORBIDDEN.has(key)) return null
  if (MODIFIERS[key]) return MODIFIERS[key].vks
  if (NAMED[key]) return [NAMED[key][1]]
  let m = /^Key([A-Z])$/.exec(key)
  if (m) return [m[1]!.charCodeAt(0)]
  m = /^Digit([0-9])$/.exec(key)
  if (m) return [0x30 + Number(m[1])]
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key)
  if (m) return [0x6f + Number(m[1])]
  return null
}

export function triggerLabel(key: string): string {
  if (MODIFIERS[key]) return MODIFIERS[key].label
  if (NAMED[key]) return NAMED[key][0]
  const m = /^(?:Key|Digit)(.)$/.exec(key)
  return m ? m[1]! : key
}

/**
 * Normalize a captured KeyboardEvent.code: plain modifiers become side-agnostic ("Shift"),
 * because users rarely care which side, unless `exactSide` is set.
 */
export function normalizeTrigger(code: string, exactSide = false): string | null {
  if (!exactSide) {
    if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift'
    if (code === 'ControlLeft' || code === 'ControlRight') return 'Control'
    if (code === 'AltLeft' || code === 'AltRight') return 'Alt'
  }
  return triggerVks(code) ? code : null
}

/** Normalize a process name the user typed: "dopus" → "dopus.exe". */
export function normalizeAppName(input: string): string | null {
  const name = input.trim().split(/[\\/]/).pop() ?? ''
  if (!/^[\w .-]{1,100}$/.test(name)) return null
  return /\.exe$/i.test(name) ? name.toLowerCase() : `${name.toLowerCase()}.exe`
}
