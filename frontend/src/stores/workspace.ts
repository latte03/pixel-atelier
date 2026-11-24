import { computed, markRaw, ref, shallowRef, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import { fetchDataUrl, loadImage } from '@/services/images'
import type { CharacterAction, ExportResult, GenerationJob, SpriteFrame, SpriteRecipe, Vec2 } from '@/types/models'
import { isIdleActionId, nextActionVersion, totalDuration } from '@/utils/project'
import { frameOverflow, normalizeLayout, renderFrame, sliceSheet, type SheetLayout } from '@/utils/sheet'
import { useProjectStore } from './project'

export const useWorkspaceStore = defineStore('workspace', () => {
  const projectStore = useProjectStore()
  const source = shallowRef<HTMLImageElement | null>(null)
  const sourceData = ref('')
  const sourceLabel = ref('')
  const sourceJob = shallowRef<GenerationJob | null>(null)
  const frames = ref<SpriteFrame[]>([])
  const recipe = ref<SpriteRecipe | null>(null)
  const currentIndex = ref(0)
  const playing = ref(false)
  const playbackSpeed = ref(1)
  const loop = ref(true)
  const background = ref<'checker' | 'dark' | 'light'>('checker')
  const zoom = ref<number | null>(null)
  const pan = ref<Vec2>([0, 0])
  const showGrid = ref(false)
  const showGround = ref(false)
  const showOnion = ref(false)
  const exportResult = shallowRef<ExportResult | null>(null)
  const exporting = ref(false)

  const hasFrames = computed(() => frames.value.length > 0)
  const currentFrame = computed(() => frames.value[currentIndex.value] || null)
  const duration = computed(() => recipe.value ? totalDuration(recipe.value) : 0)

  function reset() {
    source.value = null
    sourceData.value = ''
    sourceLabel.value = ''
    sourceJob.value = null
    frames.value = []
    recipe.value = null
    currentIndex.value = 0
    playing.value = false
    exportResult.value = null
    zoom.value = null
    pan.value = [0, 0]
  }

  async function loadSource(url: string, label: string, job: GenerationJob | null = null) {
    const [image, data] = await Promise.all([loadImage(url), fetchDataUrl(url)])
    source.value = markRaw(image)
    sourceData.value = data
    sourceLabel.value = label
    sourceJob.value = job
    frames.value = []
    recipe.value = null
    currentIndex.value = 0
    playing.value = false
    exportResult.value = null
    zoom.value = null
    pan.value = [0, 0]
    return image
  }

  function slice(layout: SheetLayout = normalizeLayout(sourceJob.value), frameSize = projectStore.project?.spec.frameSize || 224) {
    if (!source.value) throw new Error('先选择一张角色图或动作图表')
    const result = sliceSheet(source.value, {
      layout,
      frameSize,
      colors: projectStore.project?.spec.paletteLimit || 64,
      pivot: projectStore.project?.spec.pivot,
    })
    frames.value = result.frames
    recipe.value = result.recipe
    currentIndex.value = 0
    playing.value = false
    exportResult.value = null
    if (projectStore.project) {
      projectStore.project.spec.frameSize = result.recipe.frameSize
      projectStore.project.spec.pivot = [...result.recipe.pivot]
      projectStore.markDirty()
    }
    return result
  }

  async function loadAction(id: string) {
    const project = projectStore.project
    const action = project?.actions[id]
    if (!action || action.draft || !action.recipe) throw new Error('这个动作还没有可编辑的帧')
    await loadSource(action.source, action.label || id)
    const result = sliceSheet(source.value!, {
      layout: { cols: action.recipe.cols, rows: action.recipe.rows, count: action.recipe.count },
      frameSize: action.recipe.frameSize,
      durations: action.recipe.durations,
      offsets: action.recipe.offsets,
      colors: action.recipe.colors,
      previewScale: action.recipe.previewScale,
      loop: action.recipe.loop,
      scale: action.recipe.scale,
      baseOffset: action.recipe.baseOffset,
      pivot: action.recipe.pivot,
    })
    frames.value = result.frames
    recipe.value = action.recipe
    for (const [key, value] of Object.entries(action.overrides || {})) {
      const index = Number(key)
      if (!frames.value[index]) continue
      frames.value[index].override = value
      frames.value[index].overrideImage = markRaw(await loadImage(value))
      frames.value[index].offset = [0, 0]
    }
    currentIndex.value = 0
    playing.value = false
    loop.value = action.recipe.loop
    playbackSpeed.value = 1
    return action
  }

  function overrides(): Record<string, string> {
    const result: Record<string, string> = {}
    frames.value.forEach((frame, index) => {
      if (frame.override) result[String(index)] = frame.override
    })
    return result
  }

  function actionFromWorkspace(label: string, prompt: string): CharacterAction {
    if (!sourceData.value || !recipe.value) throw new Error('当前没有可保存的动作帧')
    return {
      label,
      source: sourceData.value,
      prompt,
      review: 'pending',
      overrides: overrides(),
      recipe: structuredClone(toRaw(recipe.value)),
    }
  }

  function syncAction(actionId: string, prompt?: string) {
    const project = projectStore.project
    const action = project?.actions[actionId]
    if (!project || !action || action.draft || !recipe.value) return
    project.actions[actionId] = {
      ...action,
      source: sourceData.value,
      recipe: structuredClone(toRaw(recipe.value)),
      overrides: overrides(),
      prompt: prompt ?? action.prompt,
      review: 'pending',
    }
    exportResult.value = null
    projectStore.markDirty()
  }

  async function commitGenerated(actionId: string, label: string, prompt: string) {
    const project = projectStore.project
    if (!project) throw new Error('先打开角色工程')
    const existing = project.actions[actionId]
    let targetId = actionId
    let targetLabel = label
    if (existing && !existing.draft) {
      const version = nextActionVersion(project.actions, actionId)
      targetId = version.id
      targetLabel = `${label}${version.label}`
    }
    const action = actionFromWorkspace(targetLabel, prompt)
    project.actions[targetId] = action
    projectStore.markDirty()
    await projectStore.save()
    return targetId
  }

  function selectFrame(index: number, stop = true) {
    if (!frames.value.length) return
    if (stop) playing.value = false
    currentIndex.value = (index + frames.value.length) % frames.value.length
  }

  function updateCurrentFrame(actionId: string, patch: Partial<Pick<SpriteFrame, 'duration' | 'offset'>>) {
    const frame = currentFrame.value
    if (!frame || !recipe.value) return
    if (patch.duration !== undefined) {
      if (!Number.isInteger(patch.duration) || patch.duration < 10 || patch.duration > 2000 || patch.duration % 10) {
        throw new Error('帧时长应为 10 至 2000ms，并按 10ms 递增')
      }
      frame.duration = patch.duration
      recipe.value.durations[currentIndex.value] = patch.duration
    }
    if (patch.offset) frame.offset = [...patch.offset]
    recipe.value.offsets[currentIndex.value] = [...frame.offset]
    syncAction(actionId)
  }

  function applyTempo(actionId: string, factor: number) {
    if (!recipe.value) return
    frames.value.forEach((frame, index) => {
      frame.duration = Math.max(10, Math.min(2000, Math.round(frame.duration * factor / 10) * 10))
      recipe.value!.durations[index] = frame.duration
    })
    syncAction(actionId)
  }

  function applyOffsetToAll(actionId: string) {
    if (!currentFrame.value || !recipe.value) return
    frames.value.forEach((frame, index) => {
      frame.offset = [...currentFrame.value!.offset]
      recipe.value!.offsets[index] = [...frame.offset]
    })
    syncAction(actionId)
  }

  function frameCanvas(index = currentIndex.value): HTMLCanvasElement {
    if (!source.value || !recipe.value || !frames.value[index]) throw new Error('当前没有可预览的帧')
    return renderFrame(source.value, frames.value[index], recipe.value)
  }

  function updateRecipe(actionId: string, patch: Partial<Pick<SpriteRecipe, 'pivot' | 'colors' | 'previewScale' | 'loop'>>) {
    if (!recipe.value) return
    Object.assign(recipe.value, patch)
    loop.value = recipe.value.loop
    syncAction(actionId)
  }

  async function replaceFrame(actionId: string, file: File) {
    if (!recipe.value) throw new Error('先建立动作时间轴')
    const objectUrl = URL.createObjectURL(file)
    let data: string
    try {
      data = await fetchDataUrl(objectUrl)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
    const image = await loadImage(data)
    if (image.width !== recipe.value.frameSize || image.height !== recipe.value.frameSize) {
      throw new Error(`请提供 ${recipe.value.frameSize} × ${recipe.value.frameSize} 的透明 PNG`)
    }
    const frame = currentFrame.value
    if (!frame) return
    frame.override = data
    frame.overrideImage = markRaw(image)
    frame.offset = [0, 0]
    recipe.value.offsets[currentIndex.value] = [0, 0]
    syncAction(actionId)
  }

  async function finalizeIdle(actionId: string) {
    const project = projectStore.project
    if (!project || !isIdleActionId(actionId) || !hasFrames.value) {
      throw new Error('请先打开一段待机动作')
    }
    if (frames.value.length < 2) throw new Error('待机需要至少两帧')
    project.master = frameCanvas().toDataURL('image/png')
    project.masterBasis = { action: actionId, frame: currentIndex.value }
    project.spec.version++
    projectStore.markDirty()
    await projectStore.save()
    if (!project.spec.frozen) await projectStore.freeze()
  }

  async function exportCurrent(name: string) {
    if (!projectStore.project || !recipe.value || !hasFrames.value) throw new Error('先打开一个动作')
    exporting.value = true
    try {
      for (const [index, frame] of frames.value.entries()) {
        if (frameOverflow(frame, recipe.value)) throw new Error(`第 ${index + 1} 帧超出画布，请调整偏移`)
      }
      const result = await api.exportAnimation({
        name,
        frames: frames.value.map((frame, index) => ({
          image: frameCanvas(index).toDataURL('image/png'),
          duration_ms: frame.duration,
          offset: frame.offset,
        })),
        pivot: recipe.value.pivot,
        colors: recipe.value.colors,
        preview_scale: recipe.value.previewScale,
        loop: loop.value,
        source: sourceData.value,
        recipe: recipe.value,
        fixed_palette: projectStore.project.spec.frozen ? projectStore.project.spec.palette : undefined,
      })
      exportResult.value = result
      return result
    } finally {
      exporting.value = false
    }
  }

  return {
    source, sourceData, sourceLabel, sourceJob, frames, recipe, currentIndex, currentFrame,
    playing, playbackSpeed, loop, background, zoom, pan, showGrid, showGround, showOnion,
    exportResult, exporting, hasFrames, duration,
    reset, loadSource, slice, loadAction, syncAction, commitGenerated, selectFrame,
    updateCurrentFrame, applyTempo, applyOffsetToAll, frameCanvas, updateRecipe, replaceFrame, finalizeIdle, exportCurrent,
  }
})
