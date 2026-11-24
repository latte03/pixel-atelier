<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CloudUploadOutline, DocumentTextOutline, SparklesOutline } from '@vicons/ionicons5'
import { NAlert, NButton, NCard, NFormItem, NIcon, NInput, NScrollbar, NSelect, NSpin, NTag, NUpload, useMessage } from 'naive-ui'
import { readFile, fetchDataUrl } from '@/services/images'
import { useGenerationStore } from '@/stores/generation'
import { useProjectStore } from '@/stores/project'
import { useReferenceStore } from '@/stores/reference'
import { buildPrompt } from '@/utils/prompt'

const props = defineProps<{ actionId: string }>()
const emit = defineEmits<{ completed: [job: import('@/types/models').GenerationJob] }>()
const projectStore = useProjectStore()
const generationStore = useGenerationStore()
const referenceStore = useReferenceStore()
const message = useMessage()
const referenceData = ref('')
const referenceName = ref('')
const identity = ref('')
const weapon = ref('')
const style = ref('chibi')
const styleNote = ref('')
const keep = ref('')
const motion = ref('')
const frameCount = ref(8)
const handledJob = ref('')

const project = computed(() => projectStore.project!)
const action = computed(() => project.value.actions[props.actionId])
const isIdle = computed(() => /^idle(?:_v[0-9]+)?$/.test(props.actionId))
const follow = computed(() => !isIdle.value && projectStore.hasMaster)
const effectiveReference = computed(() => follow.value ? project.value.master || '' : referenceData.value)
const prompt = computed(() => buildPrompt({
  project: project.value,
  actionId: props.actionId,
  actionPrompt: motion.value,
  identity: identity.value,
  weapon: weapon.value,
  style: style.value,
  styleNote: styleNote.value,
  keep: keep.value,
  frameSize: project.value.spec.frameSize,
  colors: project.value.spec.paletteLimit,
  kind: 'sheet',
  layout: { cols: 4, rows: frameCount.value / 4, count: frameCount.value },
  presetFacing: ['idle', 'run', 'dash', 'light', 'heavy', 'jump', 'hurt', 'knockdown'].includes(props.actionId),
}))
const canSubmit = computed(() => !!prompt.value && (!!effectiveReference.value || isIdle.value) && !generationStore.busy)
const canResumeDownload = computed(() => generationStore.activeJob?.status === 'failed' && generationStore.activeJob.events.some(event =>
  event.type === 'download' && event.status === 'failed' && event.can_resume === true,
))

watch(() => props.actionId, () => initialize(), { immediate: true })
watch(() => generationStore.activeJob?.status, status => {
  const job = generationStore.activeJob
  if (status !== 'completed' || !job || job.action !== props.actionId || handledJob.value === job.id) return
  handledJob.value = job.id
  emit('completed', job)
})

async function initialize() {
  const p = projectStore.project
  if (!p) return
  if (generationStore.activeJob && generationStore.activeJob.action !== props.actionId) generationStore.setActive('')
  identity.value = p.spec.identity
  weapon.value = p.spec.weapon
  motion.value = p.actions[props.actionId]?.prompt || defaultMotion(props.actionId)
  if (p.spec.profile === 'bow') keep.value = '无箭袋，不画取箭；左手持弓、右手拉弦，弓臂与弓弦关系清楚。'
  const selected = referenceStore.selected
  if (selected && !follow.value) {
    referenceName.value = selected.name
    referenceData.value = await fetchDataUrl(selected.url)
    referenceStore.clear()
  }
  handledJob.value = ''
}

async function resumeDownload() {
  const job = generationStore.activeJob
  if (!job) return
  try {
    await generationStore.resumeDownload(job.id)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

function defaultMotion(id: string) {
  if (id === 'idle') return '原地待机循环，呼吸时肩部和衣物轻微起伏，支撑脚稳定，首尾姿势衔接。'
  if (id === 'run') return '原地行走循环，双腿交替蹬地，弓和装备随躯干自然滞后，不滑步。'
  return p()?.actions[id]?.prompt || '请描述预备、发力、主要姿势、释放或收势。'
}

function p() { return projectStore.project }

async function chooseFile(value: File | null) {
  if (!value) return
  if (!['image/png', 'image/jpeg'].includes(value.type)) return message.error('请选择 PNG 或 JPG')
  if (value.size > 12 * 1024 * 1024) return message.error('图片请小于 12MB')
  referenceData.value = await readFile(value)
  referenceName.value = value.name
}

async function submit() {
  if (!canSubmit.value) return
  try {
    handledJob.value = ''
    await generationStore.submit({
      prompt: prompt.value,
      action: props.actionId,
      kind: 'sheet',
      layout: { cols: 4, rows: frameCount.value / 4, count: frameCount.value },
      character_context: { id: project.value.id!, spec_version: project.value.spec.version },
      ...(effectiveReference.value ? { reference: effectiveReference.value } : { from_text: true }),
    })
    message.success('任务已提交，完成后会自动切帧并进入编辑')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <NCard class="generator-card" :bordered="true">
    <div class="generator-heading">
      <div>
        <span class="eyebrow">{{ isIdle ? 'IDLE MASTER' : 'ACTION SHEET' }}</span>
        <h2>{{ isIdle ? '制作待机母版' : `制作「${action?.label || actionId}」` }}</h2>
        <p>{{ isIdle ? '生成 8 帧连续待机。完成后自动切帧、保存并进入时间轴。' : '沿用已定稿的角色母版，生成这张动作图表。' }}</p>
      </div>
      <NTag :type="follow ? 'success' : 'info'" :bordered="false">{{ follow ? '使用角色母版' : isIdle ? '支持文字或参考图' : '需要母版' }}</NTag>
    </div>

    <div v-if="!follow" class="reference-section">
      <div class="reference-preview" :class="{ filled: referenceData }">
        <img v-if="referenceData" :src="referenceData" alt="角色参考图" />
        <template v-else>
          <NIcon><CloudUploadOutline /></NIcon>
          <strong>上传角色参考图</strong>
          <small>PNG / JPG · 最大 12MB</small>
        </template>
      </div>
      <div class="reference-copy">
        <h3>{{ referenceName || '也可以直接用文字制作' }}</h3>
        <p>有参考图时，人物比例、发型、服装和装备会严格沿用。没有参考图时，下方角色特征就是唯一造型依据。</p>
        <NUpload accept="image/png,image/jpeg" :max="1" :show-file-list="false" @change="({ file }) => chooseFile(file.file)">
          <NButton size="small"><template #icon><NIcon><CloudUploadOutline /></NIcon></template>{{ referenceData ? '更换参考图' : '选择参考图' }}</NButton>
        </NUpload>
      </div>
    </div>
    <div v-else class="master-reference">
      <img :src="project.master || ''" alt="已定稿角色母版" />
      <div><strong>角色母版已锁定</strong><small>后续动作会保持同一人物、装备与色板。</small></div>
      <NTag type="success" :bordered="false">母版 {{ project.masterBasis?.frame! + 1 }} 帧</NTag>
    </div>

    <div class="form-grid">
      <NFormItem label="角色特征" class="span-2">
        <NInput v-model:value="identity" type="textarea" :rows="3" :maxlength="1500" placeholder="发型、脸部、服装、识别点，以及需要保持的特征。" />
      </NFormItem>
      <NFormItem label="基础画风">
        <NSelect v-model:value="style" :options="[
          { label: '二至三头身 · 硬边像素', value: 'chibi' },
          { label: '经典像素 RPG · 三头身', value: 'classic' },
          { label: '自定义像素风格', value: 'custom' },
        ]" />
      </NFormItem>
      <NFormItem label="关键姿势">
        <NSelect v-model:value="frameCount" :options="[
          { label: '8 帧 · 4 × 2', value: 8 },
          { label: '16 帧 · 4 × 4', value: 16 },
        ]" />
      </NFormItem>
      <NFormItem label="补充画风规则">
        <NInput v-model:value="styleNote" type="textarea" :rows="2" :maxlength="1200" placeholder="例如：深色轮廓，少量分级明暗，不要平滑插画。" />
      </NFormItem>
      <NFormItem label="装备与握持规则">
        <NInput v-model:value="weapon" type="textarea" :rows="4" :maxlength="1500" />
      </NFormItem>
      <NFormItem label="必须保持的内容">
        <NInput v-model:value="keep" type="textarea" :rows="2" :maxlength="800" />
      </NFormItem>
      <NFormItem label="动作过程与力度" class="span-2">
        <NInput v-model:value="motion" type="textarea" :rows="6" :maxlength="2000" />
      </NFormItem>
    </div>

    <details class="prompt-preview">
      <summary><NIcon><DocumentTextOutline /></NIcon>查看实际提交的制作稿 <span>{{ prompt.length }} 字</span></summary>
      <NScrollbar class="prompt-preview-scroll" style="max-height: 260px">
        <pre>{{ prompt }}</pre>
      </NScrollbar>
    </details>

    <NAlert v-if="generationStore.activeJob?.status === 'failed'" type="error" :bordered="false" class="job-alert">
      <div class="job-error-copy">{{ generationStore.activeJob.error || '生成失败，请检查 API 设置后重试。' }}</div>
      <NButton v-if="canResumeDownload" size="small" :loading="generationStore.resuming" @click="resumeDownload">继续下载（不重新生图）</NButton>
    </NAlert>
    <div v-else-if="generationStore.activeJob" class="job-status" role="status">
      <NSpin v-if="generationStore.activeJob.status === 'queued' || generationStore.activeJob.status === 'running'" :size="18" />
      <NIcon v-else size="18"><SparklesOutline /></NIcon>
      <div>
        <strong>{{ generationStore.activeJob.status === 'queued' ? '等待生成' : generationStore.activeJob.status === 'running' ? '正在生成动作图表' : '生成完成，正在自动切帧' }}</strong>
        <small>完成后会直接进入动作编辑，不再弹出排版确认。</small>
      </div>
    </div>

    <div class="generator-footer">
      <span>透明 PNG · 统一比例 · 自动保存</span>
      <NButton type="primary" size="large" :loading="generationStore.submitting" :disabled="!canSubmit" @click="submit">
        <template #icon><NIcon><SparklesOutline /></NIcon></template>
        {{ generationStore.activeJob ? (canResumeDownload ? '重新生成（重新计费）' : '重新生成') : '开始生成' }}
      </NButton>
    </div>
  </NCard>
</template>

<style scoped>
.generator-card { padding: 24px; }
.generator-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.generator-heading h2 { margin: 7px 0 6px; font-size: 22px; letter-spacing: -.03em; }
.generator-heading p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.reference-section { display: flex; gap: 18px; padding: 16px; margin-bottom: 20px; border: 1px solid var(--line); border-radius: 14px; background: #f9fbf8; }
.reference-preview { display: grid; place-items: center; flex: 0 0 132px; height: 132px; overflow: hidden; border: 1px dashed #bdc9be; border-radius: 12px; color: #8b978e; background: #fff; }
.reference-preview.filled { border-style: solid; background: #fff; }
.reference-preview img { width: 100%; height: 100%; object-fit: contain; }
.reference-preview .n-icon { font-size: 26px; }
.reference-preview strong { margin-top: 8px; font-size: 12px; }
.reference-preview small { font-size: 10px; }
.reference-copy { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; }
.reference-copy h3 { margin: 0 0 7px; font-size: 14px; }
.reference-copy p { max-width: 540px; margin: 0 0 12px; color: var(--muted); font-size: 12px; line-height: 1.65; }
.master-reference { display: flex; align-items: center; gap: 14px; padding: 12px 16px; margin-bottom: 20px; border: 1px solid #cfe0d5; border-radius: 14px; background: #f2f8f4; }
.master-reference img { width: 56px; height: 56px; object-fit: contain; border-radius: 9px; background: #fff; }
.master-reference div { display: flex; flex: 1; flex-direction: column; gap: 4px; }
.master-reference strong { font-size: 13px; }
.master-reference small { color: var(--muted); font-size: 11px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; }
.span-2 { grid-column: span 2; }
.prompt-preview { margin: 14px 0 18px; border: 1px solid var(--line); border-radius: 12px; background: #fafbf8; }
.prompt-preview summary { display: flex; align-items: center; gap: 8px; padding: 12px 14px; cursor: pointer; color: #526159; font-size: 12px; list-style: none; }
.prompt-preview summary::-webkit-details-marker { display: none; }
.prompt-preview summary span { margin-left: auto; color: var(--faint); }
.prompt-preview pre { margin: 0; padding: 14px; border-top: 1px solid var(--line); color: #55635b; font: 11px/1.7 "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.job-alert, .job-status { margin: 16px 0; }
.job-alert { display: grid; justify-items: start; gap: 10px; }
.job-error-copy { line-height: 1.6; }
.job-status { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; background: var(--accent-soft); color: var(--accent-dark); }
.job-status div { display: flex; flex-direction: column; gap: 4px; }
.job-status strong { font-size: 13px; }
.job-status small { font-size: 11px; opacity: .75; }
.generator-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 18px; border-top: 1px solid var(--line); }
.generator-footer > span { color: var(--muted); font-size: 11px; }
@media (max-width: 820px) { .form-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } .reference-section { flex-direction: column; } .reference-preview { flex-basis: 160px; width: 100%; height: 160px; } }
</style>
