import { describe, expect, it } from 'vitest'
import { createBlankProject, createDraftAction } from './project'
import { buildPrompt } from './prompt'

function prompt(overrides: Partial<Parameters<typeof buildPrompt>[0]> = {}) {
  const project = createBlankProject('七方向弓箭手')
  project.spec.identity = '轻甲、无箭袋'
  project.spec.weapon = '左手持弓，右手拉弦'
  project.actions.idle = createDraftAction('待机', '呼吸起伏，首尾循环')
  return buildPrompt({
    project,
    actionId: 'idle',
    actionPrompt: '',
    identity: '轻甲、无箭袋',
    weapon: '左手持弓，右手拉弦',
    style: 'chibi',
    styleNote: '深色轮廓',
    keep: '七方向装备一致',
    frameSize: 224,
    colors: 64,
    kind: 'sheet',
    layout: { cols: 4, rows: 2, count: 8 },
    ...overrides,
  })
}

describe('buildPrompt', () => {
  it('locks the requested sheet layout and transparent output', () => {
    const value = prompt()
    expect(value).toContain('规则 4 列 × 2 行动作图表，共 8 个连续关键姿势')
    expect(value).toContain('真实透明 Alpha 背景')
    expect(value).toContain('不画底板、地面、投影、棋盘格、文字或网格线')
  })

  it('keeps identity, equipment and action constraints from their fallbacks', () => {
    const value = prompt({ identity: '', weapon: '' })
    expect(value).toContain('呼吸起伏，首尾循环')
    expect(value).toContain('轻甲、无箭袋')
    expect(value).toContain('七方向装备一致')
  })

  it('describes multiple references as one character reference sheet', () => {
    const value = prompt({ referenceCount: 3 })
    expect(value).toContain('参考表包含 3 张同一角色的参考图')
    expect(value).toContain('不要把参考表的分格画进结果')
  })

  it('emits a single-pose prompt without sheet instructions', () => {
    const value = prompt({ kind: 'pose', layout: undefined })
    expect(value).toContain('只生成一张完整角色姿势图')
    expect(value).not.toContain('行动作图表')
  })
})
