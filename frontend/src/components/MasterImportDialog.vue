<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowForwardOutline, ImageOutline } from '@vicons/ionicons5'
import { NAlert, NButton, NEmpty, NIcon, NModal, NScrollbar, NSpin, useMessage } from 'naive-ui'
import { api } from '@/services/api'
import type { CharacterProject, ProjectSummary } from '@/types/models'
import type { ReferenceImage } from '@/utils/references'

const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ currentProjectId: string }>()
const emit = defineEmits<{ select: [reference: ReferenceImage] }>()
const message = useMessage()
const projects = ref<ProjectSummary[]>([])
const preview = ref<CharacterProject | null>(null)
const loading = ref(false)
const previewingId = ref('')
const available = computed(() => projects.value.filter(project => project.id !== props.currentProjectId && project.hasMaster))

watch(show, async value => {
  if (!value) return
  preview.value = null
  loading.value = true
  try {
    projects.value = await api.projects()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
})

async function previewMaster(project: ProjectSummary) {
  previewingId.value = project.id
  try {
    const detail = await api.project(project.id)
    if (!detail.master) throw new Error('这个角色还没有可用的待机母版')
    preview.value = detail
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    previewingId.value = ''
  }
}

function confirm() {
  if (!preview.value?.master) return
  emit('select', {
    dataUrl: preview.value.master,
    name: `${preview.value.name} · 待机母版`,
    origin: 'master',
    sourceProjectId: preview.value.id,
  })
  show.value = false
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    title="导入待机母版作为参考"
    class="master-import-modal"
    :style="{ width: 'min(820px, calc(100vw - 32px))' }"
  >
    <NAlert type="info" :bordered="false" class="import-note">
      母版只作为本次待机生成的参考，不会定稿当前角色。仍需生成当前角色待机，并在编辑页选择一帧定稿。
    </NAlert>
    <NSpin :show="loading">
      <div v-if="available.length" class="import-grid">
        <div class="master-list">
          <NScrollbar style="max-height: 360px">
            <button
              v-for="project in available"
              :key="project.id"
              type="button"
              class="master-option"
              :class="{ active: preview?.id === project.id }"
              @click="previewMaster(project)"
            >
              <span class="master-monogram">{{ project.name.slice(0, 1) }}</span>
              <span class="master-option-copy"><strong>{{ project.name }}</strong><small>{{ project.actions }} 个动作 · 已定稿母版</small></span>
              <NSpin v-if="previewingId === project.id" :size="16" />
              <NIcon v-else><ArrowForwardOutline /></NIcon>
            </button>
          </NScrollbar>
        </div>
        <div class="master-preview checkerboard">
          <img v-if="preview?.master" :src="preview.master" :alt="`${preview.name} 待机母版`" />
          <div v-else class="preview-placeholder">
            <NIcon size="30"><ImageOutline /></NIcon>
            <span>先选择一个角色，查看母版后再导入</span>
          </div>
        </div>
      </div>
      <NEmpty v-else description="其他角色还没有已定稿的待机母版" class="import-empty" />
    </NSpin>
    <template #footer>
      <div class="import-footer">
        <span>{{ preview ? `将使用「${preview.name}」的母版` : '选择参考母版' }}</span>
        <NButton :disabled="loading" @click="show = false">取消</NButton>
        <NButton type="primary" :disabled="!preview?.master" @click="confirm">使用这个参考母版</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.import-note { margin-bottom: 16px; }
.import-grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; }
.master-list { min-width: 0; }
.master-option { display: flex; align-items: center; gap: 11px; width: 100%; padding: 11px; border: 1px solid var(--line); border-radius: 11px; background: #fff; color: inherit; text-align: left; cursor: pointer; }
.master-option + .master-option { margin-top: 8px; }
.master-option:hover, .master-option.active { border-color: #a9c4b5; background: #f3f9f5; }
.master-monogram { display: grid; place-items: center; flex: 0 0 34px; width: 34px; height: 34px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); font-weight: 700; }
.master-option-copy { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; }
.master-option-copy strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.master-option-copy small { color: var(--muted); font-size: 10px; }
.master-preview { display: grid; place-items: center; min-height: 280px; overflow: hidden; border: 1px solid var(--line); border-radius: 13px; }
.master-preview img { width: 100%; max-height: 340px; object-fit: contain; }
.preview-placeholder { display: grid; place-items: center; gap: 12px; padding: 24px; color: var(--muted); font-size: 11px; text-align: center; }
.import-empty { padding: 30px 0; }
.import-footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.import-footer > span { margin-right: auto; color: var(--muted); font-size: 11px; }
@media (max-width: 680px) {
  .import-grid { grid-template-columns: 1fr; }
  .master-preview { min-height: 200px; }
  .import-footer { align-items: flex-start; flex-direction: column; }
  .import-footer > span { margin-right: 0; }
}
</style>
