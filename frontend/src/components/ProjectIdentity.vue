<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { CreateOutline } from '@vicons/ionicons5'
import { NIcon, NInput, NTooltip } from 'naive-ui'
import { useProjectStore } from '@/stores/project'

const route = useRoute()
const projectStore = useProjectStore()
const editingName = ref(false)
const currentProject = computed(() => route.params.projectId ? projectStore.project : null)
const saveLabel = computed(() => projectStore.conflict ? '保存冲突' : projectStore.saving ? '保存中…' : projectStore.dirty ? '有未保存修改' : '已自动保存')

function finishEditing() {
  editingName.value = false
  if (currentProject.value) projectStore.updateName(currentProject.value.name)
}
</script>

<template>
  <section v-if="currentProject" class="project-identity" aria-label="当前角色信息">
    <div class="identity-main">
      <span class="identity-mark"><NIcon><CreateOutline /></NIcon></span>
      <NInput
        v-if="editingName"
        v-model:value="currentProject.name"
        size="small"
        autofocus
        :maxlength="80"
        aria-label="角色名称"
        @blur="finishEditing"
        @keyup.enter="finishEditing"
      />
      <NTooltip v-else>
        <template #trigger>
          <button class="project-name" type="button" @click="editingName = true">{{ currentProject.name }}</button>
        </template>
        点击修改角色名称
      </NTooltip>
      <span class="save-state" :class="{ conflict: projectStore.conflict }">{{ saveLabel }}</span>
    </div>
    <dl class="identity-facts">
      <div><dt>动作</dt><dd>{{ projectStore.completedActions }} / {{ projectStore.actionEntries.length }} 已完成</dd></div>
      <div><dt>母版</dt><dd>{{ projectStore.hasMaster ? '已定稿' : '待定稿' }}</dd></div>
      <div><dt>色板</dt><dd>{{ currentProject.spec.frozen ? `${currentProject.spec.palette.length} 色 · 已冻结` : '待冻结' }}</dd></div>
    </dl>
  </section>
</template>

<style scoped>
.project-identity { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 40px; margin: -8px 0 14px; padding: 4px 12px; border: 1px solid var(--line); border-radius: 11px; background: rgba(255, 255, 255, .72); }
.identity-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.identity-main .n-input { width: min(320px, 42vw); }
.identity-mark { display: grid; place-items: center; flex: 0 0 30px; width: 30px; height: 30px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); font-size: 16px; }
.project-name { max-width: 360px; overflow: hidden; padding: 4px 0; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 14px; font-weight: 680; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.project-name:hover { color: var(--accent); }
.save-state { flex: none; color: var(--muted); font-size: 11px; white-space: nowrap; }
.save-state.conflict { color: var(--danger); }
.identity-facts { display: flex; gap: 24px; margin: 0; }
.identity-facts div { display: flex; align-items: baseline; gap: 7px; white-space: nowrap; }
.identity-facts dt { color: var(--muted); font-size: 10px; }
.identity-facts dd { margin: 0; color: #526159; font-size: 11px; }
@media (max-width: 860px) {
  .project-identity { align-items: flex-start; flex-direction: column; gap: 10px; }
  .identity-facts { width: 100%; justify-content: space-between; gap: 12px; }
}
@media (max-width: 520px) {
  .identity-facts div { align-items: flex-start; flex-direction: column; gap: 3px; }
  .save-state { font-size: 10px; }
}
</style>
