<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CheckmarkCircleOutline, DownloadOutline, WarningOutline } from '@vicons/ionicons5'
import { NAlert, NButton, NCard, NCheckbox, NEmpty, NIcon, NSpace, useMessage } from 'naive-ui'
import ProjectIdentity from '@/components/ProjectIdentity.vue'
import { api } from '@/services/api'
import { downloadBlob } from '@/services/http'
import { useProjectStore } from '@/stores/project'
import { useWorkspaceStore } from '@/stores/workspace'
import { frameOverflow } from '@/utils/sheet'
import { useCharacterRoute } from '@/composables/useCharacterRoute'

const router = useRouter()
const projectStore = useProjectStore()
const workspace = useWorkspaceStore()
const { editorPath } = useCharacterRoute()
const message = useMessage()
const exporting = ref(false)
const checklist = ref({ visual: false, timing: false, engine: false })

const checks = computed(() => {
  const project = projectStore.project
  if (!project) return []
  const result: Array<{ ok: boolean; label: string; detail: string }> = [
    { ok: !!project.masterBasis, label: '待机母版', detail: project.masterBasis ? '已从待机帧定稿' : '还没有定稿角色母版' },
    { ok: project.spec.frozen, label: '统一色板', detail: project.spec.frozen ? `${project.spec.palette.length} 色已冻结` : '尚未冻结色板' },
    { ok: projectStore.completedActions > 0, label: '可交付动作', detail: `${projectStore.completedActions} 个动作已保存帧` },
  ]
  if (workspace.recipe && workspace.frames.length) {
    const overflow = workspace.frames.some(frame => frameOverflow(frame, workspace.recipe!))
    result.push({ ok: !overflow, label: '当前动作画布', detail: overflow ? '有帧超出画布' : '所有帧都在画布内' })
  }
  return result
})
const ready = computed(() => checks.value.length > 0 && checks.value.every(check => check.ok))

async function exportAll() {
  if (!projectStore.project) return
  exporting.value = true
  try {
    await projectStore.save()
    const result = await api.exportProject(projectStore.project.id!)
    const anchor = document.createElement('a')
    anchor.href = result.zip_url
    anchor.download = `${projectStore.project.name}-assets.zip`
    anchor.click()
    message.success(`已打包 ${result.actions} 个动作`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    exporting.value = false
  }
}

function backup() {
  if (!projectStore.project) return
  downloadBlob(new Blob([JSON.stringify(projectStore.project, null, 2)], { type: 'application/json' }), `${projectStore.project.name}-角色工程.json`)
}
</script>

<template>
  <div class="page delivery-page">
    <ProjectIdentity v-if="projectStore.project" />
    <div class="page-heading">
      <div><span class="eyebrow">DELIVERY CHECK</span><h1>交付检查</h1><p>技术检查负责发现明显问题，动作观感与游戏手感仍需实际试玩。</p></div>
      <NSpace :size="8">
        <NButton :disabled="!projectStore.project" @click="backup">下载工程 JSON</NButton>
        <NButton type="primary" :loading="exporting" :disabled="!projectStore.project" @click="exportAll"><template #icon><NIcon><DownloadOutline /></NIcon></template>导出整套角色资源</NButton>
      </NSpace>
    </div>
    <template v-if="!projectStore.project">
      <NEmpty description="还没有打开角色工程"><NButton type="primary" @click="router.push('/works')">查看作品</NButton></NEmpty>
    </template>
    <template v-else>
      <NAlert :type="ready ? 'success' : 'warning'" :bordered="false" class="delivery-summary">
        <template #icon><NIcon><component :is="ready ? CheckmarkCircleOutline : WarningOutline" /></NIcon></template>
        {{ ready ? '技术检查已通过，可以导出并进入实机验收。' : '还有项目未完成，导出前建议先处理下面的提醒。' }}
      </NAlert>
      <div class="delivery-grid">
        <NCard title="自动检查" subtitle="检查工程结构、母版、色板与当前动作画布。">
          <div class="check-list">
            <div v-for="check in checks" :key="check.label" class="check-row" :class="{ ok: check.ok }">
              <NIcon size="20"><component :is="check.ok ? CheckmarkCircleOutline : WarningOutline" /></NIcon>
              <div><strong>{{ check.label }}</strong><small>{{ check.detail }}</small></div>
            </div>
          </div>
        </NCard>
        <NCard title="人工验收" subtitle="这三项需要你在实际游戏或目标画面中确认。">
          <div class="manual-checks">
            <NCheckbox v-model:checked="checklist.visual">角色比例、装备与动作连续性符合预期</NCheckbox>
            <NCheckbox v-model:checked="checklist.timing">射击频率、蓄力抖动与释放节奏合适</NCheckbox>
            <NCheckbox v-model:checked="checklist.engine">锚点、碰撞与游戏内绘制倍率已复核</NCheckbox>
          </div>
          <NButton block style="margin-top: 18px" @click="router.push(editorPath())">打开动作编辑器</NButton>
        </NCard>
        <NCard title="工程信息">
          <dl class="project-facts">
            <div><dt>角色</dt><dd>{{ projectStore.project.name }}</dd></div>
            <div><dt>动作</dt><dd>{{ projectStore.completedActions }} / {{ projectStore.actionEntries.length }}</dd></div>
            <div><dt>画布</dt><dd>{{ projectStore.project.spec.frameSize }}²</dd></div>
            <div><dt>锚点</dt><dd class="mono">{{ projectStore.project.spec.pivot.join(', ') }}</dd></div>
            <div><dt>修订</dt><dd>{{ projectStore.project.revision }}</dd></div>
          </dl>
        </NCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.delivery-summary { margin-bottom: 18px; }
.delivery-grid { display: grid; grid-template-columns: 1.2fr 1fr .8fr; gap: 16px; align-items: start; }
.check-list { display: grid; gap: 14px; }
.check-row { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 10px; background: #fbf6ec; color: #9a6a24; }
.check-row.ok { background: #f0f7f2; color: var(--accent); }
.check-row div { display: flex; flex-direction: column; gap: 4px; }
.check-row strong { font-size: 13px; }
.check-row small { color: var(--muted); font-size: 11px; }
.manual-checks { display: grid; gap: 16px; }
.project-facts { display: grid; gap: 13px; margin: 0; }
.project-facts div { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
.project-facts dt { color: var(--muted); }
.project-facts dd { margin: 0; text-align: right; }
@media (max-width: 980px) { .delivery-grid { grid-template-columns: 1fr 1fr; } .delivery-grid .n-card:last-child { grid-column: span 2; } }
@media (max-width: 640px) { .delivery-grid { grid-template-columns: 1fr; } .delivery-grid .n-card:last-child { grid-column: auto; } }
</style>
