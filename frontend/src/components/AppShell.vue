<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AddOutline, ArchiveOutline, ConstructOutline, FolderOpenOutline,
  ImagesOutline, SettingsOutline, SparklesOutline,
} from '@vicons/ionicons5'
import { NButton, NIcon, NLayout, NLayoutContent, NLayoutHeader, NScrollbar, type ScrollbarInst } from 'naive-ui'
import ApiSettingsDialog from '@/components/ApiSettingsDialog.vue'
import NewProjectDialog from '@/components/NewProjectDialog.vue'
import { useProjectAutosave } from '@/composables/useProjectAutosave'
import { useCharacterRoute } from '@/composables/useCharacterRoute'
import { useProjectStore } from '@/stores/project'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const { sheetPath, editorPath, deliveryPath } = useCharacterRoute()
const currentProject = computed(() => route.params.projectId ? projectStore.project : null)
useProjectAutosave()
const showNewProject = ref(false)
const showSettings = ref(false)
const contentScroll = ref<ScrollbarInst | null>(null)
let currentPage = route.name === 'create-action' ? 'create' : String(route.name || '')

watch(() => route.name, async name => {
  const page = name === 'create-action' ? 'create' : String(name || '')
  if (page === currentPage) return
  currentPage = page
  await nextTick()
  contentScroll.value?.scrollTo({ top: 0, left: 0 })
}, { flush: 'post' })
</script>

<template>
  <NLayout class="app-layout">
    <NLayoutHeader class="app-header" bordered>
      <div class="brand-block">
        <span class="brand-mark">P</span>
        <div>
          <strong>Pixel Atelier</strong>
          <small>角色动作工作室</small>
        </div>
      </div>
      <div class="header-actions">
        <NButton size="small" quaternary @click="showSettings = true">
          <template #icon><NIcon><SettingsOutline /></NIcon></template>
          API 设置
        </NButton>
        <NButton size="small" type="primary" @click="showNewProject = true">
          <template #icon><NIcon><AddOutline /></NIcon></template>
          新建角色
        </NButton>
      </div>
    </NLayoutHeader>
    <div class="workspace-nav">
      <nav class="global-nav" aria-label="全局导航">
        <button type="button" :class="{ active: route.name === 'works' }" :aria-current="route.name === 'works' ? 'page' : undefined" @click="router.push('/works')">
          <NIcon><FolderOpenOutline /></NIcon><span>作品</span>
        </button>
        <button type="button" :class="{ active: route.name === 'references' }" :aria-current="route.name === 'references' ? 'page' : undefined" @click="router.push('/references')">
          <NIcon><ImagesOutline /></NIcon><span>参考库</span>
        </button>
      </nav>
      <nav v-if="currentProject" class="character-context" aria-label="当前角色导航">
        <span class="context-label">当前角色</span>
        <div class="character-tabs">
          <button type="button" :class="{ active: route.name === 'create' }" :aria-current="route.name === 'create' ? 'page' : undefined" @click="router.push(sheetPath())">
            <NIcon><SparklesOutline /></NIcon><span>创作</span>
          </button>
          <button type="button" :class="{ active: route.name === 'editor' }" :aria-current="route.name === 'editor' ? 'page' : undefined" @click="router.push(editorPath())">
            <NIcon><ConstructOutline /></NIcon><span>动作编辑</span>
          </button>
          <button type="button" :class="{ active: route.name === 'delivery' }" :aria-current="route.name === 'delivery' ? 'page' : undefined" @click="router.push(deliveryPath())">
            <NIcon><ArchiveOutline /></NIcon><span>交付检查</span>
          </button>
        </div>
        <div class="nav-project-meta">
          <span>{{ currentProject ? projectStore.completedActions : 0 }} / {{ currentProject ? projectStore.actionEntries.length : 0 }} 动作</span>
          <span>{{ currentProject?.spec.frozen ? '色板已冻结' : '色板待冻结' }}</span>
        </div>
      </nav>
    </div>
    <NLayoutContent class="app-content">
      <NScrollbar ref="contentScroll" class="app-content-scroll">
        <RouterView />
      </NScrollbar>
    </NLayoutContent>
  </NLayout>
  <NewProjectDialog v-model:show="showNewProject" />
  <ApiSettingsDialog v-model:show="showSettings" />
</template>

<style scoped>
.app-layout { display: flex; flex-direction: column; height: 100dvh; overflow: hidden; }
.app-layout :deep(.n-layout-scroll-container) { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.app-header { display: flex; align-items: center; justify-content: space-between; gap: 28px; width: 100%; height: 68px; padding: 0 28px; background: rgba(250, 251, 248, .94); }
.brand-block { display: flex; align-items: center; gap: 11px; min-width: 210px; }
.brand-mark { display: grid; place-items: center; flex: 0 0 34px; width: 34px; height: 34px; border-radius: 10px; background: #173f35; color: #f7f5eb; font-weight: 800; font-size: 19px; box-shadow: inset 0 0 0 1px #ffffff1c; }
.brand-block div { display: flex; flex-direction: column; line-height: 1.15; }
.brand-block strong { font-size: 15px; }
.brand-block small { margin-top: 4px; color: #7c847e; font-size: 10px; letter-spacing: .12em; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.app-header, .workspace-nav { flex: none; }
.workspace-nav { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 52px; padding: 0 28px; border-bottom: 1px solid #e3e7e1; background: #fff; }
.global-nav, .character-tabs { display: flex; align-items: center; gap: 3px; }
.global-nav button, .character-tabs button { display: flex; align-items: center; gap: 7px; padding: 8px 11px; border: 0; border-radius: 8px; background: transparent; color: #738078; font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.global-nav button:hover, .character-tabs button:hover { background: #f3f6f1; color: #31483c; }
.global-nav button.active { background: var(--accent-soft); color: var(--accent-dark); font-weight: 650; }
.character-context { display: flex; align-items: center; justify-content: flex-end; gap: 14px; min-width: 0; }
.context-label { color: #9aa29c; font-size: 10px; letter-spacing: .08em; white-space: nowrap; }
.character-tabs { padding: 3px; border-radius: 11px; background: #f1f4ef; }
.character-tabs button.active { background: #fff; color: var(--accent-dark); font-weight: 650; box-shadow: 0 1px 4px #1c352314; }
.nav-project-meta { display: flex; gap: 12px; color: #7b847e; font-size: 10px; white-space: nowrap; }
.app-content { flex: 1; min-height: 0; overflow: hidden; background: #f4f5f1; }
.app-content-scroll { height: 100%; }
@media (max-width: 1100px) { .nav-project-meta, .context-label { display: none; } }
@media (max-width: 980px) {
  .app-header { gap: 14px; padding: 0 16px; }
  .brand-block { min-width: auto; }
  .brand-block div { display: none; }
  .header-actions .n-button:first-child { display: none; }
  .workspace-nav { gap: 10px; padding: 0 12px; }
  .global-nav button, .character-tabs button { padding: 8px; }
}
@media (max-width: 680px) {
  .workspace-nav { align-items: flex-start; flex-direction: column; gap: 7px; padding: 8px 12px; }
  .character-context { width: 100%; justify-content: flex-start; }
  .character-tabs { width: 100%; }
  .character-tabs button { flex: 1; justify-content: center; }
}
</style>
