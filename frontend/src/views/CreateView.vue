<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowForwardOutline } from '@vicons/ionicons5'
import { NAlert, NButton, NCard, NIcon, NInputNumber, useMessage } from 'naive-ui'
import ActionSheetPreview from '@/components/ActionSheetPreview.vue'
import GeneratorForm from '@/components/GeneratorForm.vue'
import ProjectIdentity from '@/components/ProjectIdentity.vue'
import ProjectWorkflow from '@/components/ProjectWorkflow.vue'
import { useCharacterRoute } from '@/composables/useCharacterRoute'
import { useProjectStore } from '@/stores/project'
import { useWorkspaceStore } from '@/stores/workspace'
import type { GenerationJob } from '@/types/models'
import { isIdleActionId } from '@/utils/project'
import { normalizeLayout } from '@/utils/sheet'

const router = useRouter()
const projectStore = useProjectStore()
const workspace = useWorkspaceStore()
const message = useMessage()
const { actionId, action: selectedAction, sheetPath, editorPath, deliveryPath } = useCharacterRoute()
const generationError = ref('')
const fallbackCols = ref(4)
const fallbackRows = ref(2)
const fallbackCount = ref(8)
const retryJob = ref<GenerationJob | null>(null)
const showGenerator = ref(false)

const pageHeading = computed(() => selectedAction.value && !selectedAction.value.draft && !showGenerator.value
  ? { title: '查看动作图表', copy: '核对生成时的完整图表，需要调整节奏或位置时再进入帧编辑。' }
  : { title: '把下一个动作做完整', copy: '左侧填写要求，右侧查看当前进度。生成结束后会自动进入时间轴。' })
const nextStep = computed(() => {
  if (!projectStore.idleActionId) return { title: '先制作待机', copy: '待机会成为后续所有动作的角色母版。', action: 'idle' }
  if (!projectStore.hasMaster) return { title: '定稿待机母版', copy: '打开待机，选一张最清楚的帧，锁定人物与装备。', action: 'open-idle' }
  if (projectStore.actionEntries.some(([, action]) => action.draft)) {
    return { title: '继续制作动作', copy: '从上方动作列表选择下一个待制作动作。', action: 'next' }
  }
  return { title: '检查并交付', copy: '所有动作都已制作，先检查母版、色板与导出内容。', action: 'delivery' }
})

watch(actionId, () => {
  showGenerator.value = false
  generationError.value = ''
})

onMounted(async () => {
  if (projectStore.project && Object.keys(projectStore.project.actions).length === 0) {
    const id = projectStore.addAction('待机母版', '原地待机循环，保持自然呼吸、稳定重心与支撑脚，衣摆轻微起伏，首尾姿势衔接。')
    await projectStore.save()
    await router.replace(sheetPath(id))
  }
})

async function editAction(id: string) {
  try {
    await workspace.loadAction(id)
    await router.push(editorPath(id))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

function openAction(id: string) {
  showGenerator.value = false
  generationError.value = ''
  void router.push(sheetPath(id))
}

async function handleGenerated(job: GenerationJob) {
  retryJob.value = job
  generationError.value = ''
  try {
    const label = projectStore.project?.actions[job.action]?.label || job.action
    await workspace.loadSource(job.image_url!, `${label} · 生成结果`, job)
    await finishGenerated(job, normalizeLayout(job))
  } catch (error) {
    generationError.value = error instanceof Error ? error.message : String(error)
    fallbackCols.value = job.layout?.cols || 4
    fallbackRows.value = job.layout?.rows || 2
    fallbackCount.value = job.layout?.count || 8
    message.error('生成已完成，但自动切帧失败。可以在下方调整排版后重试。')
  }
}

async function finishGenerated(job: GenerationJob, layout: { cols: number; rows: number; count: number }) {
  if (!projectStore.project) throw new Error('角色工程已关闭，请重新打开')
  const label = projectStore.project.actions[job.action]?.label || job.action
  workspace.slice(layout, projectStore.project.spec.frameSize)
  const targetId = await workspace.commitGenerated(job.action, label, job.prompt)
  generationError.value = ''
  message.success(`已自动切出 ${layout.count} 帧并保存到角色工程`)
  await router.push(editorPath(targetId))
}

async function retrySlice() {
  if (!retryJob.value) return
  try {
    await finishGenerated(retryJob.value, { cols: fallbackCols.value, rows: fallbackRows.value, count: fallbackCount.value })
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function followNextStep() {
  if (nextStep.value.action === 'open-idle') return editAction(projectStore.idleActionId)
  if (nextStep.value.action === 'idle') {
    const idle = projectStore.actionEntries.find(([id, action]) => isIdleActionId(id) && action.draft)
    if (idle) openAction(idle[0])
    return
  }
  if (nextStep.value.action === 'delivery') {
    await router.push(deliveryPath())
    return
  }
  const draft = projectStore.actionEntries.find(([, action]) => action.draft)
  if (draft) openAction(draft[0])
}
</script>

<template>
  <div class="page create-page">
    <ProjectIdentity />
    <div class="page-heading">
      <div><span class="eyebrow">CREATE</span><h1>{{ pageHeading.title }}</h1><p>{{ pageHeading.copy }}</p></div>
    </div>
    <div class="create-grid">
      <main class="create-main">
        <ProjectWorkflow :action-id="actionId" @open="openAction" @create="openAction" />
        <NAlert v-if="generationError" type="warning" :bordered="false" class="slice-error" role="alert">
          <div class="slice-error-copy"><strong>图片已生成，但自动切帧没有成功</strong><span>{{ generationError }}</span></div>
          <div class="slice-controls">
            <NInputNumber v-model:value="fallbackCols" :min="1" :max="8" size="small" aria-label="列数" />
            <NInputNumber v-model:value="fallbackRows" :min="1" :max="8" size="small" aria-label="行数" />
            <NInputNumber v-model:value="fallbackCount" :min="1" :max="64" size="small" aria-label="帧数" />
            <NButton size="small" type="primary" @click="retrySlice">按此排版重新切帧</NButton>
          </div>
        </NAlert>
        <ActionSheetPreview
          v-if="selectedAction && !selectedAction.draft && !showGenerator"
          :action="selectedAction"
          @edit="editAction(actionId)"
          @regenerate="showGenerator = true"
        />
        <GeneratorForm v-else-if="actionId" :key="actionId" :action-id="actionId" @completed="handleGenerated" />
        <NCard v-else title="正在准备动作" subtitle="角色工程加载中。" />
      </main>
      <aside class="create-aside">
        <NCard class="next-card">
          <span class="eyebrow">NEXT STEP</span>
          <h2>{{ nextStep.title }}</h2>
          <p>{{ nextStep.copy }}</p>
          <NButton type="primary" block @click="followNextStep">{{ nextStep.title }}<template #icon><NIcon><ArrowForwardOutline /></NIcon></template></NButton>
        </NCard>
        <NCard title="当前角色规格" class="spec-card">
          <dl>
            <div><dt>画布</dt><dd>{{ projectStore.project?.spec.frameSize || 224 }} × {{ projectStore.project?.spec.frameSize || 224 }}</dd></div>
            <div><dt>锚点</dt><dd class="mono">{{ projectStore.project?.spec.pivot.join(', ') || '—' }}</dd></div>
            <div><dt>色板</dt><dd>{{ projectStore.project?.spec.frozen ? projectStore.project.spec.palette.length + ' 色 · 已冻结' : '最多 ' + (projectStore.project?.spec.paletteLimit || 64) + ' 色' }}</dd></div>
            <div><dt>动作</dt><dd>{{ projectStore.completedActions }} 已完成 / {{ projectStore.actionEntries.length }} 总计</dd></div>
          </dl>
        </NCard>
        <NAlert type="info" :bordered="false">
          生成图只负责给出关键姿势。切帧不会自动修补关节，播放后仍需检查动作连续性。
        </NAlert>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.create-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; align-items: start; }
.create-main { display: grid; gap: 18px; min-width: 0; }
.create-aside { display: grid; gap: 16px; position: sticky; top: 18px; }
.next-card { background: #173f35; color: #f5f7f1; }
.next-card .eyebrow { color: #9fd2b8; }
.next-card h2 { margin: 10px 0 8px; font-size: 21px; }
.next-card p { margin: 0 0 18px; color: #bed0c4; font-size: 12px; line-height: 1.65; }
.next-card .n-button--primary-type { color: #173f35; background: #dcebe0; }
.next-card .n-button--primary-type:hover { background: #eaf4ed; }
.spec-card dl { display: grid; gap: 12px; margin: 0; }
.spec-card dl div { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
.spec-card dt { color: var(--muted); }
.spec-card dd { margin: 0; text-align: right; }
.slice-error { display: grid; gap: 14px; }
.slice-error-copy { display: flex; flex-direction: column; gap: 5px; }
.slice-error-copy span { font-size: 12px; }
.slice-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.slice-controls .n-input-number { width: 84px; }
@media (max-width: 1060px) { .create-grid { grid-template-columns: 1fr; } .create-aside { position: static; grid-template-columns: 1fr 1fr; } .create-aside .n-alert { grid-column: span 2; } }
@media (max-width: 820px) { .create-aside { grid-template-columns: 1fr; } .create-aside .n-alert { grid-column: auto; } }
</style>
