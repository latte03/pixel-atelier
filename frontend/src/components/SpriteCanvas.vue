<script setup lang="ts">
import { onMounted, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const stage = useTemplateRef<HTMLDivElement>('stage')
let observer: ResizeObserver | undefined
let dragging: { x: number; y: number; pan: [number, number] } | null = null

function draw() {
  const element = canvas.value
  const container = stage.value
  if (!element || !container || !container.clientWidth || !container.clientHeight) return
  const width = container.clientWidth
  const height = container.clientHeight
  const dpr = window.devicePixelRatio || 1
  if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
    element.width = Math.round(width * dpr)
    element.height = Math.round(height * dpr)
  }
  const context = element.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = false
  if (!workspace.source) return
  const image = workspace.frames.length ? workspace.frameCanvas() : workspace.source
  const size = workspace.frames.length ? workspace.recipe!.frameSize : image.width
  const zoom = workspace.zoom ?? Math.max(.05, Math.min((width - 56) / size, (height - 56) / size))
  const x = (width - size * zoom) / 2 + workspace.pan[0]
  const y = (height - size * zoom) / 2 + workspace.pan[1]
  if (workspace.showOnion && workspace.frames.length > 1) {
    const previous = workspace.frameCanvas((workspace.currentIndex + workspace.frames.length - 1) % workspace.frames.length)
    context.globalAlpha = .24
    context.drawImage(previous, x, y, size * zoom, size * zoom)
    context.globalAlpha = 1
  }
  context.drawImage(image, x, y, image.width * zoom, image.height * zoom)
  if (workspace.showGrid && workspace.frames.length && zoom >= 3) {
    context.strokeStyle = '#4f6b5d22'
    context.lineWidth = 1
    for (let index = 0; index <= size; index++) {
      context.beginPath()
      context.moveTo(Math.round(x + index * zoom) + .5, y)
      context.lineTo(Math.round(x + index * zoom) + .5, y + size * zoom)
      context.stroke()
      context.beginPath()
      context.moveTo(x, Math.round(y + index * zoom) + .5)
      context.lineTo(x + size * zoom, Math.round(y + index * zoom) + .5)
      context.stroke()
    }
  }
  if (workspace.showGround && workspace.frames.length && workspace.recipe) {
    const [pivotX, pivotY] = workspace.recipe.pivot
    const px = x + pivotX * zoom
    const py = y + pivotY * zoom
    context.strokeStyle = '#b7791f'
    context.setLineDash([5, 5])
    context.beginPath(); context.moveTo(0, py); context.lineTo(width, py); context.stroke()
    context.setLineDash([])
    context.beginPath()
    context.moveTo(px - 8, py); context.lineTo(px + 8, py)
    context.moveTo(px, py - 8); context.lineTo(px, py + 8)
    context.stroke()
  }
}

function zoomBy(factor: number) {
  const current = workspace.zoom ?? 1
  workspace.zoom = Math.max(.05, Math.min(32, current * factor))
  draw()
}

function pointerDown(event: PointerEvent) {
  dragging = { x: event.clientX, y: event.clientY, pan: [workspace.pan[0], workspace.pan[1]] }
  stage.value?.setPointerCapture(event.pointerId)
}
function pointerMove(event: PointerEvent) {
  if (!dragging) return
  workspace.pan = [dragging.pan[0] + event.clientX - dragging.x, dragging.pan[1] + event.clientY - dragging.y]
  draw()
}
function pointerUp() { dragging = null }
function wheel(event: WheelEvent) {
  event.preventDefault()
  zoomBy(event.deltaY > 0 ? .9 : 1.1)
}

watch([
  () => workspace.currentIndex,
  () => workspace.frames,
  () => workspace.recipe,
  () => workspace.background,
  () => workspace.showGrid,
  () => workspace.showGround,
  () => workspace.showOnion,
  () => workspace.zoom,
  () => workspace.pan,
  () => workspace.source,
], draw, { deep: true, flush: 'post' })

onMounted(() => {
  observer = new ResizeObserver(draw)
  if (stage.value) observer.observe(stage.value)
  draw()
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div
    ref="stage"
    class="sprite-stage"
    :class="`bg-${workspace.background}`"
    tabindex="0"
    aria-label="动作画布，拖动画布，滚轮缩放"
    @pointerdown="pointerDown"
    @pointermove="pointerMove"
    @pointerup="pointerUp"
    @pointercancel="pointerUp"
    @wheel="wheel"
  >
    <canvas ref="canvas"></canvas>
    <div v-if="!workspace.source" class="stage-empty"><strong>还没有打开动作</strong><span>从创作页生成待机，或打开已有作品。</span></div>
    <div class="stage-badge">{{ workspace.frames.length ? `FRAME ${String(workspace.currentIndex + 1).padStart(2, '0')} / ${workspace.frames.length}` : 'SOURCE' }}</div>
  </div>
</template>

<style scoped>
.sprite-stage { position: relative; width: 100%; height: clamp(260px, 34vh, 480px); overflow: hidden; outline: none; touch-action: none; }
.sprite-stage canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.bg-checker { background-color: #fff; background-image: linear-gradient(45deg, #e8ece6 25%, transparent 25%), linear-gradient(-45deg, #e8ece6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e8ece6 75%), linear-gradient(-45deg, transparent 75%, #e8ece6 75%); background-size: 24px 24px; background-position: 0 0, 0 12px, 12px -12px, -12px 0; }
.bg-dark { background: #202923; }
.bg-light { background: #fff; }
.stage-empty { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; text-align: center; color: #7e8981; pointer-events: none; }
.stage-empty strong { color: #3e4d44; font-size: 16px; }
.stage-empty span { font-size: 12px; }
.stage-badge { position: absolute; left: 14px; bottom: 14px; padding: 7px 10px; border: 1px solid #ffffff24; border-radius: 8px; background: #1d2b24cc; color: #eef5ef; font: 10px "SFMono-Regular", Consolas, monospace; pointer-events: none; }
</style>
