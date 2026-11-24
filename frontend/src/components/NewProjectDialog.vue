<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArchiveOutline, DocumentTextOutline, ImageOutline, SparklesOutline } from '@vicons/ionicons5'
import { NAlert, NButton, NForm, NFormItem, NIcon, NInput, NModal, NRadioButton, NRadioGroup, NUpload, useMessage } from 'naive-ui'
import { api } from '@/services/api'
import { readFile } from '@/services/images'
import { useProjectStore } from '@/stores/project'
import { characterSheetPath } from '@/composables/useCharacterRoute'
import { createBlankProject, createDraftAction } from '@/utils/project'

const show = defineModel<boolean>('show', { required: true })
const router = useRouter()
const projectStore = useProjectStore()
const message = useMessage()
const name = ref('')
const kind = ref<'blank' | 'archer' | 'knight' | 'master'>('archer')
const masterFile = ref<File | null>(null)
const creating = ref(false)

const options = [
  { value: 'archer', label: '七方向弓箭手', description: '待机、行走与七个射击方向，已填好 8 帧分镜。', icon: SparklesOutline },
  { value: 'blank', label: '空白角色', description: '从一句角色想法开始，自由决定造型与动作。', icon: DocumentTextOutline },
  { value: 'knight', label: '女骑士样板', description: '载入仓库自带的八段完整动作，直接体验编辑与导出。', icon: ArchiveOutline },
  { value: 'master', label: '透明角色立绘', description: '上传透明 PNG，自动建立单帧待机与统一规格。', icon: ImageOutline },
] as const

const canCreate = computed(() => name.value.trim().length > 0 && (kind.value !== 'master' || !!masterFile.value))

watch(show, value => {
  if (!value) return
  name.value = ''
  kind.value = 'archer'
  masterFile.value = null
})

async function create() {
  if (!canCreate.value || creating.value) return
  creating.value = true
  try {
    let id: string
    if (kind.value === 'blank') {
      const value = createBlankProject(name.value)
      value.actions.idle = createDraftAction('待机母版', '原地待机循环，保持自然呼吸、稳定重心与支撑脚，衣摆轻微起伏，首尾姿势衔接。')
      const project = await projectStore.create(value)
      id = project.id!
    } else {
      const project = kind.value === 'archer'
        ? await api.createArcher(name.value.trim())
        : kind.value === 'knight'
          ? await api.createKnight()
          : await api.createMaster({
            name: name.value.trim(),
            master: await readFile(masterFile.value!),
            profile: 'custom',
          })
      id = project.id!
      await projectStore.open(id)
    }
    show.value = false
    const firstAction = projectStore.idleActionId || Object.keys(projectStore.project?.actions || {})[0]
    await router.push(firstAction ? characterSheetPath(id, firstAction) : `/projects/${id}/create`)
    message.success(kind.value === 'knight' ? '样板已载入，可以直接播放和导出' : '角色工程已创建')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    title="新建角色"
    class="new-project-modal"
    :style="{ width: 'min(620px, calc(100vw - 32px))' }"
  >
    <NForm label-placement="top">
      <NFormItem label="角色名称">
        <NInput v-model:value="name" placeholder="例如：绿兜帽弓箭手" :maxlength="80" autofocus />
      </NFormItem>
      <NFormItem label="从哪里开始">
        <NRadioGroup v-model:value="kind" class="template-options">
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            class="template-option"
            :class="{ selected: kind === option.value }"
            @click="kind = option.value"
          >
            <span class="template-icon"><NIcon><component :is="option.icon" /></NIcon></span>
            <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
            <NRadioButton :value="option.value" class="template-radio" />
          </button>
        </NRadioGroup>
      </NFormItem>
      <NFormItem v-if="kind === 'master'" label="透明角色 PNG">
        <NUpload
          :max="1"
          accept="image/png"
          file-list-length="never"
          @change="({ file }) => masterFile = file.file"
        >
          <NButton>选择透明背景角色图</NButton>
        </NUpload>
        <NAlert v-if="!masterFile" type="info" :bordered="false" class="upload-hint">
          图片必须带真实透明 Alpha，系统会保留完整人物并自动建立待机母版。
        </NAlert>
      </NFormItem>
    </NForm>
    <template #footer>
      <div class="modal-footer">
        <span>创建后仍可随时调整角色设定与动作。</span>
        <NButton :disabled="creating" @click="show = false">取消</NButton>
        <NButton type="primary" :loading="creating" :disabled="!canCreate" @click="create">创建并开始</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.template-options { display: grid; gap: 10px; width: 100%; }
.template-option { position: relative; display: flex; align-items: center; gap: 14px; width: 100%; min-height: 76px; padding: 14px 16px; border: 1px solid #dfe5de; border-radius: 12px; background: #fff; color: inherit; text-align: left; cursor: pointer; transition: border-color .16s, background .16s, transform .16s; }
.template-option:hover { border-color: #9eb9ad; transform: translateY(-1px); }
.template-option.selected { border-color: #176b55; background: #f1f8f4; box-shadow: 0 0 0 1px #176b5514; }
.template-icon { display: grid; place-items: center; flex: 0 0 38px; width: 38px; height: 38px; border-radius: 10px; background: #eaf1ed; color: #176b55; font-size: 20px; }
.template-option > span:nth-child(2) { display: flex; flex: 1; flex-direction: column; gap: 5px; }
.template-option strong { font-size: 14px; }
.template-option small { color: #768078; font-size: 12px; line-height: 1.5; }
.template-radio { position: absolute; top: 12px; right: 12px; }
.upload-hint { margin-top: 10px; }
.modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.modal-footer > span { margin-right: auto; color: #7c857f; font-size: 12px; }
</style>
