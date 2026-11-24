import { describe, expect, it } from 'vitest'
import type { SpriteRecipe } from '@/types/models'
import {
  createBlankProject, createDraftAction, characterWorkflowStage, insertActionAfter, isIdleActionId, moveAction,
  nextActionVersion, totalDuration, uniqueActionId, validateRecipe,
} from './project'

const idle = createDraftAction('待机')
const run = createDraftAction('行走')

function recipe(): SpriteRecipe {
  return {
    cols: 4, rows: 2, count: 8, frameSize: 224, scale: 2, baseOffset: [0, 0],
    offsets: Array.from({ length: 8 }, () => [0, 0]),
    durations: [100, 110, 120, 130, 140, 150, 160, 170],
    pivot: [112, 208], colors: 64, previewScale: 4, loop: true,
  }
}

describe('project actions', () => {
  it('creates a blank project with safe defaults', () => {
    const project = createBlankProject('  测试角色  ')
    expect(project.name).toBe('测试角色')
    expect(project.spec.frameSize).toBe(224)
    expect(project.spec.pivot).toEqual([112, 208])
    expect(project.actions).toEqual({})
  })

  it('keeps built-in action ids available for templates', () => {
    expect(uniqueActionId({}, 'run')).toBe('custom_run')
    expect(uniqueActionId({}, '射击 · 右上')).toBe('action')
  })

  it('avoids id collisions and preserves insertion order', () => {
    const actions = { idle, custom_run: run }
    expect(uniqueActionId(actions, 'run')).toBe('custom_run_2')
    const copied = { ...idle, label: '待机 · 副本' }
    expect(Object.keys(insertActionAfter(actions, 'idle', 'idle_2', copied))).toEqual(['idle', 'idle_2', 'custom_run'])
  })

  it('recognizes copied and versioned idle action ids', () => {
    expect(['idle', 'idle_2', 'idle_v2'].every(isIdleActionId)).toBe(true)
    expect(['walk', 'custom_idle', 'idle_extra'].some(isIdleActionId)).toBe(false)
  })

  it('tracks workflow completion through idle, master and remaining actions', () => {
    const project = createBlankProject('流程测试')
    expect(characterWorkflowStage(null)).toBe(0)
    expect(characterWorkflowStage(project)).toBe(1)
    project.actions.idle = createDraftAction('待机')
    expect(characterWorkflowStage(project)).toBe(1)
    project.actions.idle.draft = false
    expect(characterWorkflowStage(project)).toBe(2)
    project.master = 'data:image/png;base64,AA=='
    project.masterBasis = { action: 'idle', frame: 0 }
    expect(characterWorkflowStage(project)).toBe(4)
    project.actions.walk = createDraftAction('行走')
    expect(characterWorkflowStage(project)).toBe(3)
  })

  it('moves actions without mutating the input and clamps boundaries', () => {
    const actions = { idle, run }
    expect(Object.keys(moveAction(actions, 'run', -1))).toEqual(['run', 'idle'])
    expect(Object.keys(actions)).toEqual(['idle', 'run'])
    expect(moveAction(actions, 'idle', -1)).toBe(actions)
    expect(nextActionVersion({ idle, idle_v2: idle }, 'idle')).toEqual({ id: 'idle_v3', label: ' · v3' })
  })
})

describe('sprite recipe', () => {
  it('accepts the standard eight-frame recipe and sums duration', () => {
    const value = recipe()
    validateRecipe(value)
    expect(totalDuration(value)).toBe(1080)
  })

  it('rejects impossible layouts and invalid frame timing', () => {
    expect(() => validateRecipe({ ...recipe(), count: 9 })).toThrow('动作排版')
    expect(() => validateRecipe({ ...recipe(), durations: [15, ...recipe().durations.slice(1)] })).toThrow('帧时长')
    expect(() => validateRecipe({ ...recipe(), offsets: [[0, 0]] })).toThrow('数量不匹配')
  })
})
