import { canvasToDataUrl, loadImage } from '@/services/images'

export interface ReferenceImage {
  dataUrl: string
  name: string
  origin: 'upload' | 'library' | 'master'
  sourceProjectId?: string
}

export function referenceGrid(count: number) {
  const columns = 2
  const rows = Math.ceil(count / columns)
  const cellSize = 640
  const gap = 16
  return {
    columns,
    rows,
    cellSize,
    gap,
    width: columns * cellSize + (columns + 1) * gap,
    height: rows * cellSize + (rows + 1) * gap,
  }
}

export async function composeReferenceImages(references: ReferenceImage[]): Promise<string> {
  if (!references.length) throw new Error('请先选择参考图')
  if (references.length > 4) throw new Error('最多使用 4 张参考图')
  if (references.length === 1) return references[0].dataUrl

  const layout = referenceGrid(references.length)
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建参考图画布')
  context.imageSmoothingEnabled = false

  const images = await Promise.all(references.map(reference => loadImage(reference.dataUrl)))
  images.forEach((image, index) => {
    const scale = Math.min(layout.cellSize / image.width, layout.cellSize / image.height)
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const column = index % layout.columns
    const row = Math.floor(index / layout.columns)
    const x = layout.gap + column * (layout.cellSize + layout.gap) + Math.floor((layout.cellSize - width) / 2)
    const y = layout.gap + row * (layout.cellSize + layout.gap) + Math.floor((layout.cellSize - height) / 2)
    context.drawImage(image, x, y, width, height)
  })
  return canvasToDataUrl(canvas)
}
