import { describe, expect, it } from 'vitest'
import { referenceGrid } from './references'

describe('referenceGrid', () => {
  it('lays out four references in a bounded two-column sheet', () => {
    expect(referenceGrid(4)).toEqual({
      columns: 2,
      rows: 2,
      cellSize: 640,
      gap: 16,
      width: 1328,
      height: 1328,
    })
  })

  it('keeps a partial second row for three references', () => {
    expect(referenceGrid(3).rows).toBe(2)
  })
})
