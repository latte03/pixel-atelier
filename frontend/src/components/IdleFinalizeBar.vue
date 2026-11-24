<script setup lang="ts">
import { computed } from 'vue'
import { SaveOutline } from '@vicons/ionicons5'
import { NButton, NIcon, useMessage } from 'naive-ui'
import { useProjectStore } from '@/stores/project'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{ actionId: string }>()
const emit = defineEmits<{ finalized: [] }>()
const projectStore = useProjectStore()
const workspace = useWorkspaceStore()
const message = useMessage()
const currentFrame = computed(() => workspace.currentIndex + 1)
const isCurrentMaster = computed(() => projectStore.project?.masterBasis?.action === props.actionId)
const replacingMaster = computed(() => projectStore.hasMaster && !isCurrentMaster.value)
const title = computed(() => isCurrentMaster.value
  ? '选定一帧，更新角色母版'
  : replacingMaster.value ? '选定一帧，更换角色母版' : '选定一帧，定稿角色母版')
const description = computed(() => projectStore.hasMaster
  ? `当前使用第 ${currentFrame.value} 帧。保存后其他动作会沿用新母版，已生成的动作不会自动重绘。`
  : `当前使用第 ${currentFrame.value} 帧。定稿后会冻结角色色板，并解锁其他动作制作。`)
const actionLabel = computed(() => isCurrentMaster.value
  ? '更新母版'
  : replacingMaster.value ? '更换为当前待机母版' : '定稿待机并设为母版')

async function finalize() {
  const updatingMaster = isCurrentMaster.value
  try {
    await workspace.finalizeIdle(props.actionId)
    message.success(updatingMaster ? '角色母版已更新' : '待机已定稿，可以继续制作行走与射击动作')
    emit('finalized')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <section class="idle-finalize-bar" aria-label="待机母版定稿">
    <span class="next-badge">下一步</span>
    <div class="finalize-copy">
      <strong>{{ title }}</strong>
      <small>{{ description }}</small>
    </div>
    <NButton type="primary" size="small" :loading="projectStore.saving" :disabled="!workspace.hasFrames" @click="finalize">
      <template #icon><NIcon><SaveOutline /></NIcon></template>{{ actionLabel }}
    </NButton>
  </section>
</template>

<style scoped>
.idle-finalize-bar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 7px 12px; border: 1px solid #bdd5c7; border-radius: 11px; background: rgba(247, 252, 248, .97); box-shadow: 0 6px 18px #1e352714; }
.next-badge { flex: none; padding: 3px 6px; border-radius: 5px; background: var(--accent); color: #fff; font-size: 10px; font-weight: 700; }
.finalize-copy { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.finalize-copy strong { font-size: 12px; }
.finalize-copy small { color: var(--muted); font-size: 11px; line-height: 1.35; }
@media (max-width: 680px) {
  .idle-finalize-bar { align-items: flex-start; flex-wrap: wrap; }
  .finalize-copy { flex-basis: calc(100% - 70px); }
  .idle-finalize-bar > .n-button { width: 100%; }
}
</style>
