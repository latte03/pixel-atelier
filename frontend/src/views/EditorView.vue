<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  DownloadOutline, ImagesOutline, ScanOutline,
} from '@vicons/ionicons5'
import { NAlert, NButton, NCard, NIcon, NModal, NSelect, NSpace, useMessage } from 'naive-ui'
import ActionList from '@/components/ActionList.vue'
import FrameInspector from '@/components/FrameInspector.vue'
import IdleFinalizeBar from '@/components/IdleFinalizeBar.vue'
import ProjectIdentity from '@/components/ProjectIdentity.vue'
import SpriteCanvas from '@/components/SpriteCanvas.vue'
import Timeline from '@/components/Timeline.vue'
import { useCharacterRoute } from '@/composables/useCharacterRoute'
import { useProjectStore } from '@/stores/project'
import { useWorkspaceStore } from '@/stores/workspace'
import type { ExportResult } from '@/types/models'
import { isIdleActionId } from '@/utils/project'

const router = useRouter()
const projectStore = useProjectStore()
const workspace = useWorkspaceStore()
const { actionId, action, sheetPath, editorPath } = useCharacterRoute()
const message = useMessage()
const loading = ref(false)
const exportResult = ref<ExportResult | null>(null)
const showExport = ref(false)
const isIdleAction = computed(() => isIdleActionId(actionId.value))
let loadVersion = 0

async function load(id = actionId.value) {
  if (!id) return
  const version = ++loadVersion
  loading.value = true
  try {
    await workspace.loadAction(id)
    if (version !== loadVersion) return
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

async function exportCurrent() {
  try {
    const result = await workspace.exportCurrent(action.value?.label || projectStore.project?.name || '像素动作')
    exportResult.value = result
    showExport.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

function openAction(id: string) {
  const target = projectStore.project?.actions[id]
  if (!target) return
  void router.push(target.draft ? sheetPath(id) : editorPath(id))
}

function viewSheet() {
  void router.push(sheetPath())
}

function keydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.matches('input, textarea, select, [contenteditable="true"]')) return
  if (event.code === 'Space') { event.preventDefault(); workspace.playing = !workspace.playing }
  if (event.altKey && workspace.currentFrame && event.key.startsWith('Arrow')) {
    event.preventDefault()
    const offset: [number, number] = [workspace.currentFrame.offset[0], workspace.currentFrame.offset[1]]
    if (event.key === 'ArrowLeft') offset[0]--
    if (event.key === 'ArrowRight') offset[0]++
    if (event.key === 'ArrowUp') offset[1]--
    if (event.key === 'ArrowDown') offset[1]++
    workspace.updateCurrentFrame(actionId.value, { offset })
    return
  }
  if (event.key === 'ArrowLeft') { event.preventDefault(); workspace.selectFrame(workspace.currentIndex - 1) }
  if (event.key === 'ArrowRight') { event.preventDefault(); workspace.selectFrame(workspace.currentIndex + 1) }
}

watch(actionId, id => {
  if (!id) return
  if (projectStore.project?.actions[id]?.draft) void router.replace(sheetPath(id))
  else void load(id)
})

onMounted(() => {
  window.addEventListener('keydown', keydown)
  if (action.value?.draft) void router.replace(sheetPath())
  else if (actionId.value) void load()
})
onBeforeUnmount(() => window.removeEventListener('keydown', keydown))
</script>

<template>
  <div class="page editor-page" :class="{ 'finalizing-idle': isIdleAction }" :aria-busy="loading">
    <ProjectIdentity v-if="projectStore.project" />
    <template v-if="!projectStore.project || !action">
      <div class="empty-state">
        <NIcon size="34"><ImagesOutline /></NIcon>
        <h3>这个动作不存在</h3>
        <p>角色工程可能已更新，请从作品页重新打开。</p>
        <NButton type="primary" @click="router.push('/works')">查看作品</NButton>
      </div>
    </template>
    <template v-else>
      <div class="editor-heading">
        <div>
          <span class="eyebrow">ACTION EDITOR</span>
          <h1>{{ action.label || actionId }}</h1>
          <p>{{ workspace.frames.length }} 帧 · {{ workspace.recipe?.frameSize }}² · {{ projectStore.project.name }}</p>
        </div>
        <NSpace :size="8">
          <NButton @click="viewSheet"><template #icon><NIcon><ImagesOutline /></NIcon></template>查看动作图表</NButton>
          <NButton type="primary" :disabled="!workspace.hasFrames" @click="exportCurrent"><template #icon><NIcon><DownloadOutline /></NIcon></template>导出当前动作</NButton>
        </NSpace>
      </div>
      <IdleFinalizeBar v-if="isIdleAction" :action-id="actionId" />
      <NAlert v-if="projectStore.conflict" type="error" :bordered="false" class="editor-alert">
        工程保存冲突。当前帧仍保留在本机，请先下载工程备份，避免覆盖其他页面的修改。
      </NAlert>
      <section class="editor-actionbar">
        <ActionList :active-action-id="actionId" @open="openAction" @create="openAction" />
      </section>
      <div class="editor-grid">
        <main class="editor-main">
          <NCard class="canvas-card" size="small">
            <div class="canvas-toolbar">
              <div class="document-title"><strong>{{ action.label }}</strong><span>{{ workspace.frames.length ? `${workspace.frames.length} 帧` : '尚未切帧' }}</span></div>
              <NSpace :size="6">
                <NSelect v-model:value="workspace.background" :options="[{ label: '棋盘格', value: 'checker' }, { label: '深色', value: 'dark' }, { label: '白色', value: 'light' }]" size="small" style="width: 96px" />
                <NButton quaternary size="small" aria-label="适应画布" @click="workspace.zoom = null; workspace.pan = [0, 0]"><NIcon><ScanOutline /></NIcon></NButton>
              </NSpace>
            </div>
            <SpriteCanvas />
          </NCard>
          <Timeline />
        </main>
        <aside class="editor-inspector">
          <FrameInspector v-if="workspace.recipe" :action-id="actionId" @exported="exportCurrent" />
        </aside>
      </div>
    </template>
    <NModal v-model:show="showExport" preset="card" title="动作已导出" :style="{ width: 'min(560px, calc(100vw - 32px))' }">
      <div v-if="exportResult" class="export-result">
        <img :src="exportResult.gif_url" alt="导出的透明 GIF" />
        <div class="export-stats">
          <strong>{{ exportResult.frame_count }} 帧 · {{ exportResult.duration_ms }} ms · {{ exportResult.palette_size }} 色</strong>
          <p>透明 GIF、PNG 帧、图集、锚点与时长配置已经保存到本机。</p>
          <NSpace>
            <NButton type="primary" tag="a" :href="exportResult.gif_url" download="pixel-animation.gif">下载 GIF</NButton>
            <NButton tag="a" :href="exportResult.zip_url" download="pixel-animation-assets.zip">下载完整资源包</NButton>
          </NSpace>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.editor-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.editor-page.finalizing-idle { padding-top: 20px; }
.editor-page.finalizing-idle :deep(.sprite-stage) { height: clamp(240px, 28vh, 440px); }
.editor-heading h1 { margin: 7px 0 5px; font-size: 25px; letter-spacing: -.035em; }
.editor-heading p { margin: 0; color: var(--muted); font-size: 12px; }
.editor-alert { margin-bottom: 14px; }
.editor-actionbar { margin-bottom: 14px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: #fff; }
.editor-grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; align-items: start; }
.editor-inspector { position: sticky; top: 16px; }
.editor-main { display: grid; gap: 14px; min-width: 0; }
.canvas-card { padding: 0; overflow: hidden; }
.canvas-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 8px 14px; border-bottom: 1px solid var(--line); }
.document-title { display: flex; align-items: baseline; gap: 9px; min-width: 0; }
.document-title strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.document-title span { color: var(--muted); font-size: 10px; white-space: nowrap; }
.export-result { display: grid; gap: 18px; }
.export-result img { width: 100%; max-height: 260px; object-fit: contain; border-radius: 12px; background: #eef1eb; }
.export-stats strong { font-size: 14px; }
.export-stats p { color: var(--muted); font-size: 12px; line-height: 1.6; }
.empty-state { display: grid; place-items: center; gap: 12px; min-height: 360px; color: var(--muted); text-align: center; }
.empty-state h3, .empty-state p { margin: 0; }
@media (max-width: 1100px) { .editor-grid { grid-template-columns: 1fr; } .editor-inspector { position: static; } }
@media (max-width: 820px) { .editor-heading { align-items: flex-start; flex-direction: column; } .editor-actionbar { padding: 10px; } }
</style>
