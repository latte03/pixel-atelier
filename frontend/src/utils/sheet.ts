import type { GenerationJob, SpriteFrame, SpriteRecipe, Vec2 } from '@/types/models'
import { normalizeOffset, validateRecipe } from './project'

export interface SheetLayout {
  cols: number
  rows: number
  count: number
}

export function normalizeLayout(job?: GenerationJob | null): SheetLayout {
  const layout = job?.layout
  if (layout && [layout.cols, layout.rows, layout.count].every(Number.isInteger)
    && layout.cols > 0 && layout.rows > 0 && layout.count > 0
    && layout.count <= layout.cols * layout.rows) {
    return { cols: layout.cols, rows: layout.rows, count: layout.count }
  }
  if (job?.kind === 'pose') return { cols: 1, rows: 1, count: 1 }
  return { cols: 4, rows: 2, count: 8 }
}

export function cellRect(imageWidth: number, imageHeight: number, index: number, layout: SheetLayout) {
  const column = index % layout.cols
  const row = Math.floor(index / layout.cols)
  const x = Math.round(column * imageWidth / layout.cols)
  const y = Math.round(row * imageHeight / layout.rows)
  const right = Math.round((column + 1) * imageWidth / layout.cols)
  const bottom = Math.round((row + 1) * imageHeight / layout.rows)
  return { x, y, width: right - x, height: bottom - y }
}

export function visibleBounds(image: HTMLImageElement, rect: { x: number; y: number; width: number; height: number }): [number, number, number, number] | null {
  const canvas = document.createElement('canvas')
  canvas.width = rect.width
  canvas.height = rect.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('浏览器无法读取图片像素')
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  const pixels = context.getImageData(0, 0, rect.width, rect.height).data
  let left = rect.width
  let top = rect.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      if (pixels[(y * rect.width + x) * 4 + 3] < 220) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  return right < 0 ? null : [left, top, right + 1, bottom + 1]
}

export function sliceSheet(image: HTMLImageElement, options: {
  layout: SheetLayout
  frameSize: number
  durations?: number[]
  offsets?: Vec2[]
  colors?: number
  previewScale?: number
  loop?: boolean
  scale?: number
  baseOffset?: Vec2
  pivot?: Vec2
}): { frames: SpriteFrame[]; recipe: SpriteRecipe } {
  const layout = options.layout
  const frames: SpriteFrame[] = []
  let union: [number, number, number, number] = [Infinity, Infinity, 0, 0]
  for (let index = 0; index < layout.count; index++) {
    const rect = cellRect(image.width, image.height, index, layout)
    const bounds = visibleBounds(image, rect)
    if (bounds) {
      union = [
        Math.min(union[0], bounds[0]),
        Math.min(union[1], bounds[1]),
        Math.max(union[2], bounds[2]),
        Math.max(union[3], bounds[3]),
      ]
    }
    frames.push({
      rect,
      bounds,
      duration: options.durations?.[index] || 100,
      offset: normalizeOffset(options.offsets?.[index] || [0, 0]),
    })
  }
  if (!Number.isFinite(union[0])) throw new Error('生成图中没有可见角色，请检查图片或重新生成')
  const scale = options.scale ?? Math.min(8, (options.frameSize - 24) / Math.max(union[2] - union[0], union[3] - union[1]))
  const baseOffset = options.baseOffset ?? [
    Math.round((options.frameSize - (union[2] - union[0]) * scale) / 2 - union[0] * scale),
    Math.round(options.frameSize - 16 - union[3] * scale),
  ]
  const recipe: SpriteRecipe = {
    ...layout,
    frameSize: options.frameSize as SpriteRecipe['frameSize'],
    scale,
    baseOffset: normalizeOffset(baseOffset),
    offsets: frames.map(frame => [...frame.offset]),
    durations: frames.map(frame => frame.duration),
    pivot: normalizeOffset(options.pivot || [Math.round(options.frameSize / 2), options.frameSize - 16]),
    colors: options.colors || 64,
    previewScale: options.previewScale || 4,
    loop: options.loop ?? true,
  }
  validateRecipe(recipe)
  return { frames, recipe }
}

export function renderFrame(
  source: HTMLImageElement,
  frame: SpriteFrame,
  recipe: SpriteRecipe,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = recipe.frameSize
  canvas.height = recipe.frameSize
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建画布')
  context.imageSmoothingEnabled = false
  if (frame.overrideImage) {
    context.drawImage(frame.overrideImage, frame.offset[0], frame.offset[1])
    return canvas
  }
  const rect = frame.rect
  context.drawImage(
    source,
    rect.x, rect.y, rect.width, rect.height,
    Math.round(recipe.baseOffset[0] + frame.offset[0]),
    Math.round(recipe.baseOffset[1] + frame.offset[1]),
    Math.round(rect.width * recipe.scale),
    Math.round(rect.height * recipe.scale),
  )
  return canvas
}

export function frameOverflow(frame: SpriteFrame, recipe: SpriteRecipe): boolean {
  if (frame.overrideImage) {
    const bounds = visibleBounds(frame.overrideImage, { x: 0, y: 0, width: recipe.frameSize, height: recipe.frameSize })
    return !!bounds && (
      bounds[0] + frame.offset[0] < 0 || bounds[1] + frame.offset[1] < 0
      || bounds[2] + frame.offset[0] > recipe.frameSize || bounds[3] + frame.offset[1] > recipe.frameSize
    )
  }
  if (!frame.bounds) return false
  const [left, top, right, bottom] = frame.bounds
  const x = recipe.baseOffset[0] + frame.offset[0]
  const y = recipe.baseOffset[1] + frame.offset[1]
  return x + left * recipe.scale < 0 || y + top * recipe.scale < 0
    || x + right * recipe.scale > recipe.frameSize || y + bottom * recipe.scale > recipe.frameSize
}
