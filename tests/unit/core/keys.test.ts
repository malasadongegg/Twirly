import { describe, expect, it } from 'vitest'
import { normalizeAppName, normalizeTrigger, triggerLabel, triggerVks } from '@shared/keys'
import { settingsSchema } from '@shared/settings'

describe('trigger keys', () => {
  it('maps modifiers to both sides plus the generic VK', () => {
    expect(triggerVks('Shift')).toEqual([0x10, 0xa0, 0xa1])
    expect(triggerVks('Control')).toEqual([0x11, 0xa2, 0xa3])
  })
  it('maps letters, digits, function keys and named keys', () => {
    expect(triggerVks('KeyQ')).toEqual([0x51])
    expect(triggerVks('Digit5')).toEqual([0x35])
    expect(triggerVks('F1')).toEqual([0x70])
    expect(triggerVks('F24')).toEqual([0x87])
    expect(triggerVks('Space')).toEqual([0x20])
    expect(triggerVks('AltRight')).toEqual([0xa5])
  })
  it('refuses keys that would break a drag or the shell', () => {
    for (const k of ['Escape', 'MetaLeft', 'Enter', 'Delete', 'NotAKey']) expect(triggerVks(k)).toBeNull()
  })
  it('normalizes captured codes', () => {
    expect(normalizeTrigger('ShiftRight')).toBe('Shift')
    expect(normalizeTrigger('ShiftRight', true)).toBe('ShiftRight')
    expect(normalizeTrigger('KeyA')).toBe('KeyA')
    expect(normalizeTrigger('Escape')).toBeNull()
    expect(triggerLabel('Control')).toBe('Ctrl')
    expect(triggerLabel('KeyA')).toBe('A')
  })
  it('normalizes app names', () => {
    expect(normalizeAppName('dopus')).toBe('dopus.exe')
    expect(normalizeAppName('C:\\Program Files\\GPSoftware\\Directory Opus\\dopus.exe')).toBe('dopus.exe')
    expect(normalizeAppName('TOTALCMD64.EXE')).toBe('totalcmd64.exe')
    expect(normalizeAppName('bad|name')).toBeNull()
  })
  it('validates the trigger in settings', () => {
    expect(settingsSchema.parse({}).dragSummon.trigger).toBe('Shift')
    expect(() => settingsSchema.parse({ dragSummon: { trigger: 'Escape' } })).toThrow()
  })
})
