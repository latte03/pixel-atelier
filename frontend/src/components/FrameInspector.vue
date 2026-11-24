<script setup lang="ts">
import { computed } from 'vue'
import { DownloadOutline, SaveOutline } from '@vicons/ionicons5'
import { NButton, NCard, NCheckbox, NDivider, NFormItem, NIcon, NInputNumber, NSelect, useMessage } from 'naive-ui'
import { useProjectStore } from '@/stores/project'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{ actionId: string }>()
const emit = defineEmits<{ exported: [] }>()
const projectStore = useProjectStore()
const workspace = useWorkspaceStore()
const message = useMessage()
const isIdle = computed(() => /^idle(?:_v[0-9]+)?$/.test(props.actionId))

function updateDuration(value: number | null) {
  if (value === null) return
  try { workspace.updateCurrentFrame(props.actionId, { duration: value }) } catch (error) { message.error((error as Error).message) }
}
function updateOffset(axis: 0 | 1, value: number | null) {
  if (value === null || !workspace.currentFrame) return
  const offset: [number, number] = [workspace.currentFrame.offset[0], workspace.currentFrame.offset[1]]
  offset[axis] = value
  workspace.updateCurrentFrame(props.actionId, { offset })
}
function updateColors(value: number) {
  workspace.updateRecipe(props.actionId, { colors: value })
}
async function finalize() {
  try {
    await workspace.finalizeIdle(props.actionId)
    message.success('待机已定稿并设为角色母版')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <NCard class="inspector-card" title="帧与节奏" size="small">
    <template #header-extra><span class="mono muted">{{ workspace.currentIndex + 1 }} / {{ workspace.frames.length }}</span></template>
    <NFormItem label="当前帧停留时长">
      <NInputNumber :input-props="{ 'aria-label': '当前帧停留时长' }" :value="workspace.currentFrame?.duration || 100" :min="10" :max="2000" :step="10" size="small" @update:value="updateDuration" />
      <span class="unit">ms</span>
    </NFormItem>
    <div class="offset-grid">
      <NFormItem label="水平偏移"><NInputNumber :input-props="{ 'aria-label': '水平偏移' }" :value="workspace.currentFrame?.offset[0] || 0" :min="-300" :max="300" size="small" @update:value="updateOffset(0, $event)" /></NFormItem>
      <NFormItem label="垂直偏移"><NInputNumber :input-props="{ 'aria-label': '垂直偏移' }" :value="workspace.currentFrame?.offset[1] || 0" :min="-300" :max="300" size="small" @update:value="updateOffset(1, $event)" /></NFormItem>
    </div>
    <NButton block size="small" :disabled="!workspace.currentFrame" @click="workspace.applyOffsetToAll(props.actionId)">将当前偏移应用到全部帧</NButton>
    <NDivider style="margin: 16px 0" />
    <span class="field-label">整体节奏</span>
    <div class="tempo-buttons">
      <NButton size="small" @click="workspace.applyTempo(props.actionId, 1.25)">慢一点</NButton>
      <NButton size="small" @click="workspace.applyTempo(props.actionId, 1)">原节奏</NButton>
      <NButton size="small" @click="workspace.applyTempo(props.actionId, .8)">快一点</NButton>
    </div>
    <NDivider style="margin: 16px 0" />
    <NCheckbox v-model:checked="workspace.showGrid">像素网格</NCheckbox>
    <NCheckbox v-model:checked="workspace.showGround">锚点参考线</NCheckbox>
    <NCheckbox v-model:checked="workspace.loop" @change="workspace.updateRecipe(props.actionId, { loop: $event })">循环播放</NCheckbox>
    <NFormItem label="根节点 X"><NInputNumber :input-props="{ 'aria-label': '根节点 X' }" :value="workspace.recipe?.pivot[0]" :min="0" :max="(workspace.recipe?.frameSize || 224) - 1" size="small" @update:value="value => workspace.updateRecipe(props.actionId, { pivot: [value || 0, workspace.recipe?.pivot[1] || 0] })" /></NFormItem>
    <NFormItem label="根节点 Y"><NInputNumber :input-props="{ 'aria-label': '根节点 Y' }" :value="workspace.recipe?.pivot[1]" :min="0" :max="(workspace.recipe?.frameSize || 224) - 1" size="small" @update:value="value => workspace.updateRecipe(props.actionId, { pivot: [workspace.recipe?.pivot[0] || 0, value || 0] })" /></NFormItem>
    <NFormItem label="导出色数">
      <NSelect :value="workspace.recipe?.colors || 64" :options="[32, 64, 128, 255].map(value => ({ label: `${value} 色`, value }))" size="small" @update:value="updateColors" />
    </NFormItem>
    <NButton v-if="isIdle && !projectStore.hasMaster" type="primary" block :loading="projectStore.saving" @click="finalize">
      <template #icon><NIcon><SaveOutline /></NIcon></template>定稿待机并设为母版
    </NButton>
    <NButton v-else block :disabled="!workspace.hasFrames" @click="emit('exported')">
      <template #icon><NIcon><DownloadOutline /></NIcon></template>导出当前动作
    </NButton>
  </NCard>
</template>

<style scoped>
.inspector-card { padding: 16px; }
.unit { margin-left: 8px; color: var(--muted); font-size: 11px; }
.offset-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tempo-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 8px; }
.inspector-card :deep(.n-checkbox) { margin-bottom: 10px; }
</style>
