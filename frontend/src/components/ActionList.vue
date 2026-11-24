<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowDownOutline, ArrowUpOutline, CopyOutline, CreateOutline, TrashOutline,
} from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NScrollbar, NTooltip, useMessage } from 'naive-ui'
import { useProjectStore } from '@/stores/project'
import { actionStatus, isIdleActionId } from '@/utils/project'

const props = defineProps<{ activeActionId: string }>()
const emit = defineEmits<{
  open: [id: string]
  create: [id: string]
  changed: []
}>()
const projectStore = useProjectStore()
const message = useMessage()
const adding = ref(false)
const newLabel = ref('')
const confirmingDelete = ref('')
const activeAction = computed(() => projectStore.project?.actions[props.activeActionId] || null)

watch(() => props.activeActionId, () => { confirmingDelete.value = '' })

function open(id: string) {
  const action = projectStore.project?.actions[id]
  if (!action) return
  if (action.draft) {
    if (isIdleActionId(id) || projectStore.hasMaster) emit('create', id)
    else message.warning('先定稿待机母版，再制作其他动作')
    return
  }
  emit('open', id)
}

async function add() {
  const label = newLabel.value.trim()
  if (!label) return
  try {
    const id = projectStore.addAction(label)
    newLabel.value = ''
    adding.value = false
    await projectStore.save()
    emit('changed')
    emit('create', id)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function copy(id: string) {
  try {
    const copyId = projectStore.copyAction(id)
    await projectStore.save()
    emit('changed')
    emit('open', copyId)
    message.success('动作已复制')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function move(id: string, delta: -1 | 1) {
  try {
    projectStore.reorderAction(id, delta)
    await projectStore.save()
    emit('changed')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function remove(id: string) {
  if (confirmingDelete.value !== id) {
    confirmingDelete.value = id
    return
  }
  try {
    projectStore.removeAction(id)
    confirmingDelete.value = ''
    const nextId = Object.keys(projectStore.project?.actions || {})[0] || ''
    emit('changed')
    if (nextId) emit('open', nextId)
    await projectStore.save()
    message.success('动作已删除')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <section class="action-list" aria-label="角色动作列表">
    <div class="action-list-top">
      <div class="action-list-heading">
        <strong>角色动作</strong>
        <span>{{ projectStore.actionEntries.length }}</span>
        <NButton size="tiny" quaternary @click="adding = !adding">
          <template #icon><NIcon><CreateOutline /></NIcon></template>
          {{ adding ? '取消新增' : '新增动作' }}
        </NButton>
      </div>
      <div v-if="activeAction" class="action-tools">
        <span class="current-action" :title="activeAction.label">{{ activeAction.label }}</span>
        <NTooltip placement="top">
          <template #trigger><NButton quaternary size="tiny" :disabled="projectStore.actionEntries.findIndex(([id]) => id === props.activeActionId) === 0" aria-label="上移当前动作" @click="move(props.activeActionId, -1)"><NIcon><ArrowUpOutline /></NIcon></NButton></template>
          上移
        </NTooltip>
        <NTooltip placement="top">
          <template #trigger><NButton quaternary size="tiny" :disabled="projectStore.actionEntries.findIndex(([id]) => id === props.activeActionId) === projectStore.actionEntries.length - 1" aria-label="下移当前动作" @click="move(props.activeActionId, 1)"><NIcon><ArrowDownOutline /></NIcon></NButton></template>
          下移
        </NTooltip>
        <NTooltip placement="top">
          <template #trigger><NButton quaternary size="tiny" aria-label="复制当前动作" @click="copy(props.activeActionId)"><NIcon><CopyOutline /></NIcon></NButton></template>
          复制
        </NTooltip>
        <NTooltip placement="top">
          <template #trigger>
            <NButton
              quaternary
              size="tiny"
              :type="confirmingDelete === props.activeActionId ? 'error' : 'default'"
              :aria-label="confirmingDelete === props.activeActionId ? '确认删除当前动作' : '删除当前动作'"
              @click="remove(props.activeActionId)"
            >
              <NIcon><TrashOutline /></NIcon>
              <span v-if="confirmingDelete === props.activeActionId" class="confirm-label">确认</span>
            </NButton>
          </template>
          {{ confirmingDelete === props.activeActionId ? '再次点击确认删除' : '删除' }}
        </NTooltip>
      </div>
    </div>
    <div v-if="adding" class="add-action-row">
      <NInput v-model:value="newLabel" placeholder="例如：射击 · 顶上" :maxlength="80" autofocus @keyup.enter="add" />
      <NButton type="primary" size="small" :disabled="!newLabel.trim()" @click="add">添加</NButton>
    </div>
    <NScrollbar x-scrollable>
      <div class="action-strip">
      <button
        v-for="([id, action], index) in projectStore.actionEntries"
        :key="id"
        type="button"
        class="action-chip"
        :class="{ active: props.activeActionId === id, draft: action.draft }"
        :title="action.label || id"
        @click="open(id)"
      >
        <span class="action-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <span class="action-copy">
          <strong>{{ action.label || id }}</strong>
          <small>{{ actionStatus(action) }}</small>
        </span>
        <span class="action-state">{{ action.draft ? '制作' : props.activeActionId === id ? '当前' : '查看' }}</span>
      </button>
      </div>
    </NScrollbar>
  </section>
</template>

<style scoped>
.action-list { display: grid; gap: 10px; min-width: 0; }
.action-list-top { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 30px; }
.action-list-heading, .action-tools { display: flex; align-items: center; gap: 7px; min-width: 0; }
.action-list-heading strong { font-size: 13px; }
.action-list-heading > span { color: var(--muted); font: 11px "SFMono-Regular", Consolas, monospace; }
.current-action { max-width: 180px; overflow: hidden; margin-right: 4px; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.action-strip { display: flex; gap: 8px; width: max-content; min-width: 100%; padding-bottom: 5px; }
.action-chip { display: flex; flex: 0 0 154px; align-items: center; gap: 9px; min-width: 0; padding: 10px 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: inherit; text-align: left; cursor: pointer; transition: border-color .16s, background .16s; }
.action-chip:hover { border-color: #b7c9bc; }
.action-chip.active { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px #176b5512; }
.action-chip.draft { border-style: dashed; }
.action-index { color: #96a098; font: 10px "SFMono-Regular", Consolas, monospace; }
.action-copy { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; }
.action-copy strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.action-copy small { color: var(--muted); font-size: 10px; }
.action-state { color: var(--accent); font-size: 10px; white-space: nowrap; }
.confirm-label { margin-left: 3px; font-size: 10px; }
.add-action-row { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border: 1px solid #b8cec0; border-radius: 10px; background: #f6fbf8; }
@media (max-width: 720px) {
  .action-list-top { align-items: flex-start; flex-direction: column; }
  .action-tools { width: 100%; }
  .current-action { flex: 1; }
}
</style>
