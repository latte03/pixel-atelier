<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NModal, NSelect, NSpace, NSwitch, useMessage } from 'naive-ui'
import { api } from '@/services/api'
import { useSettingsStore } from '@/stores/settings'
import type { AppConfig } from '@/types/models'

const show = defineModel<boolean>('show', { required: true })
const settingsStore = useSettingsStore()
const message = useMessage()
const provider = ref<'custom' | 'codex'>('custom')
const imageForm = ref({ base_url: '', api_key: '', model: '', size: '1536x1024', response_format: '', timeout: 300 })
const llmForm = ref({ base_url: '', api_key: '', model: '', polish_prompt: false })
const imageModels = ref<Array<{ label: string; value: string }>>([])
const llmModels = ref<Array<{ label: string; value: string }>>([])
const testing = ref<'image' | 'llm' | null>(null)
const canSave = computed(() => !!imageForm.value.base_url && !!imageForm.value.model)
const isSaving = computed(() => settingsStore.saving)

watch(show, async value => {
  if (!value) return
  await settingsStore.load()
  if (!settingsStore.config) return
  imageModels.value = []
  llmModels.value = []
  provider.value = settingsStore.config.provider
  imageForm.value = { ...settingsStore.config.image }
  llmForm.value = { ...settingsStore.config.llm }
})

watch(() => [imageForm.value.base_url, imageForm.value.api_key], () => { imageModels.value = [] })
watch(() => [llmForm.value.base_url, llmForm.value.api_key], () => { llmModels.value = [] })

async function fetchModels(kind: 'image' | 'llm') {
  testing.value = kind
  try {
    const section = kind === 'image' ? imageForm.value : llmForm.value
    const result = await api.testConfig(kind, section.base_url, section.api_key.startsWith('••••') ? '' : section.api_key)
    const models = result.models
    const options = models.map(model => ({ label: model, value: model }))
    if (kind === 'image') imageModels.value = options
    else llmModels.value = options
    message.success(`发现 ${models.length} 个模型`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    testing.value = null
  }
}

async function test(kind: 'image' | 'llm') {
  testing.value = kind
  try {
    const section = kind === 'image' ? imageForm.value : llmForm.value
    const result = await api.testConfig(kind, section.base_url, section.api_key.startsWith('••••') ? '' : section.api_key)
    message.success(result.message)
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    testing.value = null
  }
}

async function save() {
  try {
    const payload: AppConfig = {
      provider: provider.value,
      image: { ...imageForm.value },
      llm: { ...llmForm.value },
    }
    if (payload.image.api_key.startsWith('••••')) payload.image.api_key = '__KEEP__'
    if (payload.llm.api_key.startsWith('••••')) payload.llm.api_key = '__KEEP__'
    await settingsStore.save(payload)
    message.success('API 设置已保存到本机')
    show.value = false
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    title="API 设置"
    class="settings-modal"
    :style="{ width: 'min(780px, calc(100vw - 32px))' }"
  >
    <NAlert type="info" :bordered="false" class="settings-note">
      API Key 只保存在本机。测试时可以使用任意本地 Mock 服务与示例 Key，不会访问外部生图平台。
    </NAlert>
    <NForm label-placement="top" :disabled="settingsStore.loading">
      <NFormItem label="生成通道">
        <NSelect v-model:value="provider" :options="[{ label: '自定义生图 API', value: 'custom' }, { label: '本机 Codex CLI', value: 'codex' }]" />
      </NFormItem>
      <div class="settings-grid">
        <section class="settings-section">
          <h3>生图 API</h3>
          <NFormItem label="接口地址">
            <NInput v-model:value="imageForm.base_url" placeholder="http://127.0.0.1:8901/v1" />
          </NFormItem>
          <NFormItem label="API Key">
            <NInput v-model:value="imageForm.api_key" type="password" show-password-on="mousedown" placeholder="sk-mock-local" />
          </NFormItem>
          <NFormItem label="模型">
            <NSelect v-model:value="imageForm.model" filterable tag :options="imageModels" placeholder="输入或选择模型" />
          </NFormItem>
          <NSpace :size="12" wrap>
            <NFormItem label="输出尺寸">
              <NSelect v-model:value="imageForm.size" :options="['1024x1024', '1536x1024', '1024x1536', 'auto'].map(value => ({ label: value, value }))" style="width: 180px" />
            </NFormItem>
            <NFormItem label="返回格式">
              <NSelect v-model:value="imageForm.response_format" :options="[{ label: '自动', value: '' }, { label: 'url', value: 'url' }, { label: 'b64_json', value: 'b64_json' }]" style="width: 130px" />
            </NFormItem>
          </NSpace>
          <NSpace>
            <NButton size="small" :loading="testing === 'image'" @click="fetchModels('image')">拉取模型</NButton>
            <NButton size="small" :loading="testing === 'image'" @click="test('image')">测试连通</NButton>
          </NSpace>
        </section>
        <section class="settings-section">
          <h3>文本模型（可选）</h3>
          <NFormItem label="接口地址">
            <NInput v-model:value="llmForm.base_url" placeholder="http://127.0.0.1:8901/v1" />
          </NFormItem>
          <NFormItem label="API Key">
            <NInput v-model:value="llmForm.api_key" type="password" show-password-on="mousedown" placeholder="sk-mock-local" />
          </NFormItem>
          <NFormItem label="模型">
            <NSelect v-model:value="llmForm.model" filterable tag :options="llmModels" placeholder="输入或选择模型" />
          </NFormItem>
          <NFormItem label="生成前润色提示词">
            <NSwitch v-model:value="llmForm.polish_prompt" />
          </NFormItem>
          <NSpace>
            <NButton size="small" :loading="testing === 'llm'" @click="fetchModels('llm')">拉取模型</NButton>
            <NButton size="small" :loading="testing === 'llm'" @click="test('llm')">测试连通</NButton>
          </NSpace>
        </section>
      </div>
    </NForm>
    <template #footer>
      <div class="settings-footer">
        <span>留空已设置的 Key 可保留原值。</span>
        <NButton @click="show = false">取消</NButton>
        <NButton type="primary" :loading="isSaving" :disabled="!canSave" @click="save">保存设置</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.settings-note { margin-bottom: 18px; }
.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.settings-section { padding: 18px; border: 1px solid #e1e6df; border-radius: 14px; background: #fbfcfa; }
.settings-section h3 { margin: 0 0 16px; font-size: 14px; }
.settings-footer { display: flex; justify-content: flex-end; gap: 10px; }
.settings-footer span { margin-right: auto; color: #7d867f; font-size: 12px; align-self: center; }
@media (max-width: 720px) { .settings-grid { grid-template-columns: 1fr; } }
</style>
