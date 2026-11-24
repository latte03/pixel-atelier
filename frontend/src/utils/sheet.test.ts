import { describe, expect, it } from 'vitest'
import type { GenerationJob } from '@/types/models'
import { cellRect, normalizeLayout } from './sheet'

function job(layout: GenerationJob['layout'], kind: GenerationJob['kind'] = 'sheet'): GenerationJob {
  return {
    id: 'job', prompt: '', status: 'completed', created_at: 0, events: [],
    action: 'idle', kind, layout,
  }
}

describe('normalizeLayout', () => {
  it('uses the layout recorded by the completed generation job', () => {
    expect(normalizeLayout(job({ cols: 4, rows: 2, count: 8 }))).toEqual({ cols: 4, rows: 2, count: 8 })
    expect(normalizeLayout(job({ cols: 4, rows: 4, count: 16 }))).toEqual({ cols: 4, rows: 4, count: 16 })
  })

  it('falls back safely for missing or impossible sheet layouts', () => {
    expect(normalizeLayout(job(null))).toEqual({ cols: 4, rows: 2, count: 8 })
    expect(normalizeLayout(job({ cols: 2, rows: 2, count: 8 }))).toEqual({ cols: 4, rows: 2, count: 8 })
    expect(normalizeLayout(job({ cols: 0, rows: 2, count: 8 }))).toEqual({ cols: 4, rows: 2, count: 8 })
  })

  it('treats a single pose as one frame', () => {
    expect(normalizeLayout(job(null, 'pose'))).toEqual({ cols: 1, rows: 1, count: 1 })
  })
})

describe('cellRect', () => {
  it('reads a sheet from left to right and top to bottom', () => {
    const layout = { cols: 4, rows: 2, count: 8 }
    expect(cellRect(640, 320, 0, layout)).toEqual({ x: 0, y: 0, width: 160, height: 160 })
    expect(cellRect(640, 320, 3, layout)).toEqual({ x: 480, y: 0, width: 160, height: 160 })
    expect(cellRect(640, 320, 4, layout)).toEqual({ x: 0, y: 160, width: 160, height: 160 })
    expect(cellRect(640, 320, 7, layout)).toEqual({ x: 480, y: 160, width: 160, height: 160 })
  })

  it('distributes rounding remainder without leaving gaps', () => {
    const rects = Array.from({ length: 3 }, (_, index) => cellRect(100, 100, index, { cols: 3, rows: 1, count: 3 }))
    expect(rects.map(rect => rect.width)).toEqual([33, 34, 33])
    expect(rects[2].x + rects[2].width).toBe(100)
  })
})
