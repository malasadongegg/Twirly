// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RadialWheel, wrapHubText, type WheelItem } from '@renderer/components/RadialWheel/RadialWheel'

const items: WheelItem[] = [
  { id: 'a', label: 'JPG', title: 'Convert to JPG', icon: 'file-image' },
  { id: 'b', label: 'CROP', title: 'Crop image', icon: 'crop' },
  { id: 'c', label: 'ROTATE', title: 'Rotate', icon: 'rotate-cw' },
  { id: 'd', label: 'STRIP', title: 'Strip metadata', icon: 'eraser' },
]

describe('RadialWheel', () => {
  it('renders one menuitem per action with accessible names', () => {
    render(<RadialWheel items={items} activeIndex={null} hubLabel="1.2 MB" />)
    expect(screen.getAllByRole('menuitem').map((el) => el.getAttribute('aria-label'))).toEqual([
      'Convert to JPG',
      'Crop image',
      'Rotate',
      'Strip metadata',
    ])
    expect(screen.getByRole('menu')).toHaveAttribute('data-hub', '1.2 MB')
  })

  it('shows the highlighted action in the hub', () => {
    render(<RadialWheel items={items} activeIndex={1} hubLabel="1.2 MB" />)
    expect(screen.getByRole('menu')).toHaveAttribute('data-hub', 'Crop image')
    expect(screen.getByTestId('wheel-segment-b')).toHaveAttribute('data-active', 'true')
  })

  it('supports keyboard navigation, digits, Enter and Escape in interactive mode', () => {
    const onHover = vi.fn()
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    render(<RadialWheel items={items} activeIndex={3} hubLabel="" interactive onHover={onHover} onSelect={onSelect} onCancel={onCancel} />)
    const menu = screen.getByRole('menu')
    expect(menu).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowRight' })
    expect(onHover).toHaveBeenLastCalledWith(0) // wraps around
    fireEvent.keyDown(menu, { key: 'ArrowLeft' })
    expect(onHover).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith(3)
    fireEvent.keyDown(menu, { key: '2' })
    expect(onSelect).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(menu, { key: '9' }) // out of range: ignored
    expect(onSelect).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('ignores keys when not interactive (drag mode)', () => {
    const onSelect = vi.fn()
    render(<RadialWheel items={items} activeIndex={0} hubLabel="" onSelect={onSelect} />)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('wrapHubText', () => {
  it('keeps short text on one line', () => {
    expect(wrapHubText('1.2 MB', 54)).toEqual(['1.2 MB'])
  })
  it('wraps long messages on word boundaries instead of truncating', () => {
    expect(wrapHubText('No common actions for 1 image, 1 PDF', 54)).toEqual(['No common actions', 'for 1 image, 1 PDF'])
  })
  it('truncates only beyond three lines', () => {
    const lines = wrapHubText('one two three four five six seven eight nine ten eleven twelve thirteen fourteen', 30)
    expect(lines.length).toBe(3)
    expect(lines[2]!.endsWith('…')).toBe(true)
  })
})
