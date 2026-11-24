import type { CharacterProject } from '@/types/models'

export interface PromptInput {
  project: CharacterProject
  actionId: string
  actionPrompt: string
  identity: string
  weapon: string
  style: string
  styleNote: string
  keep: string
  frameSize: number
  colors: number
  kind: 'pose' | 'sheet'
  layout?: { cols: number; rows: number; count: number }
  presetFacing?: boolean
}

const STYLE_LABELS: Record<string, string> = {
  chibi: '二至三头身 Q 版像素，清晰硬边、深色轮廓、小块分级明暗，避免平滑插画。',
  classic: '约三头身经典 RPG 像素，清晰轮廓、有限色阶，避免写实和模糊。',
  custom: '按补充画风规则绘制完整人物像素。',
}

export function buildPrompt(input: PromptInput): string {
  const action = input.project.actions[input.actionId]
  const layout = input.layout || { cols: 4, rows: 2, count: 8 }
  const output = input.kind === 'sheet'
    ? `规则 ${layout.cols} 列 × ${layout.rows} 行动作图表，共 ${layout.count} 个连续关键姿势，按从左到右、从上到下排列。每格等尺寸，保持同一人物尺度、镜头与逻辑根节点，完整容纳人物、装备与动作特效。`
    : '只生成一张完整角色姿势图，人物居中，四周留足武器空间。'
  return [
    '【角色与目标】',
    input.project.name,
    `人物特征：${input.identity.trim() || input.project.spec.identity || '严格沿用参考图的脸部、发型、服装与识别点。'}`,
    '',
    '【美术规则】',
    STYLE_LABELS[input.style] || STYLE_LABELS.custom,
    input.styleNote.trim(),
    `目标原生画布 ${input.frameSize} × ${input.frameSize}，配色目标 ${input.colors} 色；后续切帧统一采样，禁止逐帧独立缩放。`,
    input.presetFacing ? '全身三分之四侧视，面向右侧。' : '视角与人物朝向以动作描述为准。',
    '',
    '【装备与必须保留项】',
    input.weapon.trim() || input.project.spec.weapon,
    input.keep.trim(),
    '',
    '【动作过程】',
    actionPrompt(input.actionPrompt, action?.prompt),
    '完整人物逐帧，肩肘腕髋膝踝活动合理；不拆部件、不加多余肢体。',
    '',
    '【输出要求】',
    output,
    '真实透明 Alpha 背景，不画底板、地面、投影、棋盘格、文字或网格线。清晰像素硬边，不抗锯齿、不模糊。角色位移交给游戏代码，姿势本身保留必要重心变化。',
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n').trim()
}

function actionPrompt(value: string, fallback?: string): string {
  return value.trim() || fallback?.trim() || '请描述预备、发力、主要姿势、释放或收势。'
}
