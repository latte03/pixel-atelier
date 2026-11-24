<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{ index: number }>()
const workspace = useWorkspaceStore()
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

function draw() {
  const element = canvas.value
  if (!element || !workspace.frames[props.index] || !workspace.recipe) return
  const rendered = workspace.frameCanvas(props.index)
  element.width = rendered.width
  element.height = rendered.height
  const context = element.getContext('2d')
  if (!context) return
  context.imageSmoothingEnabled = false
  context.clearRect(0, 0, element.width, element.height)
  context.drawImage(rendered, 0, 0)
}

watch([() => props.index, () => workspace.frames, () => workspace.recipe], draw, { deep: true, flush: 'post' })
onMounted(draw)
</script>

<template>
  <canvas ref="canvas" class="frame-thumbnail" aria-hidden="true"></canvas>
</template>

<style scoped>
.frame-thumbnail { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
</style>
