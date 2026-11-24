import type { CharacterAction, CharacterProject, FrameSize, SpriteRecipe, Vec2 } from '@/types/models'

export const FRAME_SIZES: FrameSize[] = [128, 160, 192, 224, 256, 320]

export function isFrameSize(value: number): value is FrameSize {
  return FRAME_SIZES.includes(value as FrameSize)
}

export function createBlankProject(name: string): CharacterProject {
  return {
    format: 'pixel-atelier-character/1',
    name: name.trim().slice(0, 80),
    master: null,
    spec: {
      frameSize: 224,
      pivot: [112, 208],
      paletteLimit: 64,
      palette: [],
      frozen: false,
      version: 0,
      profile: 'custom',
      identity: '',
      weapon: '',
      style: '完整人物硬边像素逐帧，有限色板，真实透明 Alpha 背景。',
    },
    actions: {},
  }
}

export function createDraftAction(label: string, prompt = ''): CharacterAction {
  return { label, source: '', prompt, review: 'pending', draft: true }
}

export function actionIdBase(value: string): string {
  const base = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
  return /^[a-z]/.test(base) ? base : 'action'
}

export function uniqueActionId(actions: Record<string, CharacterAction>, label: string, preferred = ''): string {
  let base = actionIdBase(preferred || label)
  if (!preferred && ['idle', 'run', 'dash', 'light', 'heavy', 'jump', 'hurt', 'knockdown'].includes(base)) {
    base = `custom_${base}`
  }
  let id = base
  let version = 2
  while (actions[id]) id = `${base}_${version++}`
  return id
}

export function insertActionAfter(
  actions: Record<string, CharacterAction>,
  afterId: string,
  id: string,
  action: CharacterAction,
): Record<string, CharacterAction> {
  const result: Record<string, CharacterAction> = {}
  for (const [key, value] of Object.entries(actions)) {
    result[key] = value
    if (key === afterId) result[id] = action
  }
  if (!Object.hasOwn(result, id)) result[id] = action
  return result
}

export function moveAction(
  actions: Record<string, CharacterAction>,
  id: string,
  delta: -1 | 1,
): Record<string, CharacterAction> {
  const entries = Object.entries(actions)
  const index = entries.findIndex(([key]) => key === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= entries.length) return actions
  ;[entries[index], entries[target]] = [entries[target], entries[index]]
  return Object.fromEntries(entries)
}

export function nextActionVersion(actions: Record<string, CharacterAction>, base: string): { id: string; label: string } {
  if (!actions[base]) return { id: base, label: '' }
  let version = 2
  while (actions[`${base}_v${version}`]) version++
  return { id: `${base}_v${version}`, label: ` · v${version}` }
}

export function validateRecipe(recipe: SpriteRecipe): void {
  if (![recipe.cols, recipe.rows, recipe.count, recipe.frameSize].every(Number.isInteger)
    || recipe.cols < 1 || recipe.rows < 1 || recipe.cols > 8 || recipe.rows > 8
    || recipe.count < 1 || recipe.count > Math.min(64, recipe.cols * recipe.rows)
    || !isFrameSize(recipe.frameSize)) {
    throw new Error('动作排版或画布尺寸无效')
  }
  if (!Number.isFinite(recipe.scale) || recipe.scale <= 0 || recipe.scale > 8) {
    throw new Error('动作采样倍率无效')
  }
  if (recipe.offsets.length !== recipe.count || recipe.durations.length !== recipe.count) {
    throw new Error('帧偏移或时长数量不匹配')
  }
  if (recipe.durations.some(value => !Number.isInteger(value) || value < 10 || value > 2000 || value % 10)) {
    throw new Error('帧时长应为 10 至 2000ms，并按 10ms 递增')
  }
}

export function totalDuration(recipe: SpriteRecipe): number {
  return recipe.durations.reduce((total, value) => total + value, 0)
}

export function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}s`
}

export function normalizeOffset(value: Vec2): Vec2 {
  return [Math.round(value[0]), Math.round(value[1])]
}

export function actionStatus(action: CharacterAction): string {
  if (action.draft) return '待制作'
  return `${action.recipe?.count || 0} 帧`
}
