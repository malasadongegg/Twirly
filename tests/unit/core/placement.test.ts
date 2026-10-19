import { describe, expect, it } from 'vitest'
import { clampCenter, subjectPlacement } from '@core/actions/image-extras'

describe('Add background: image placement', () => {
  it('defaults to centred at full size (same as before)', () => {
    expect(subjectPlacement(372, 252, 320, 200, { x: 0.5, y: 0.5, scale: 1 })).toEqual({ left: 26, top: 26, width: 320, height: 200 })
  })
  it('moves and shrinks the image but keeps it fully on the canvas', () => {
    expect(subjectPlacement(400, 300, 200, 100, { x: 0.25, y: 0.5, scale: 0.5 })).toEqual({ left: 50, top: 125, width: 100, height: 50 })
    expect(subjectPlacement(400, 300, 200, 100, { x: 0, y: 1, scale: 1 })).toEqual({ left: 0, top: 200, width: 200, height: 100 })
    expect(subjectPlacement(400, 300, 200, 100, { x: 1, y: 0, scale: 1 })).toEqual({ left: 200, top: 0, width: 200, height: 100 })
  })
  it('clampCenter gives the closest centre that keeps the image inside', () => {
    expect(clampCenter(400, 300, 200, 100, 0, 0)).toEqual({ x: 0.25, y: 50 / 300 })
    expect(clampCenter(400, 300, 400, 300, 0.9, 0.1)).toEqual({ x: 0.5, y: 0.5 }) // fills the canvas: cannot move
  })
})
