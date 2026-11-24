<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CloseOutline, CloudUploadOutline, ImagesOutline } from '@vicons/ionicons5'
import { NButton, NIcon, useMessage } from 'naive-ui'
import MasterImportDialog from '@/components/MasterImportDialog.vue'
import { fetchDataUrl, readFile } from '@/services/images'
import { useReferenceStore } from '@/stores/reference'
import type { ReferenceImage } from '@/utils/references'

const props = defineProps<{ projectId: string; modelValue: ReferenceImage[]; allowMasterImport?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [references: ReferenceImage[]] }>()
const message = useMessage()
const referenceStore = useReferenceStore()
const showImport = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const reading = ref(false)
const remaining = computed(() => Math.max(0, 4 - props.modelValue.length))

function originLabel(origin: ReferenceImage['origin']) {
  if (origin === 'master') return '其他角色母版'
  if (origin === 'library') return '参考库'
  return '本地上传'
}

function update(references: ReferenceImage[]) {
  emit('update:modelValue', references)
}

function addReference(reference: ReferenceImage) {
  if (!remaining.value) return message.warning('最多使用 4 张参考图')
  update([...props.modelValue, reference])
}

async function addFiles(candidates: File[]) {
  if (!candidates.length) return
  if (candidates.length > remaining.value) message.warning(`最多使用 4 张参考图，本次添加前 ${remaining.value} 张`)
  reading.value = true
  try {
    const loaded: ReferenceImage[] = []
    for (const file of candidates.slice(0, remaining.value)) {
      if (!['image/png', 'image/jpeg'].includes(file.type)) {
        message.error(`${file.name} 不是 PNG 或 JPG`)
        continue
      }
      if (file.size > 12 * 1024 * 1024) {
        message.error(`${file.name} 超过 12MB`)
        continue
      }
      try {
        loaded.push({ dataUrl: await readFile(file), name: file.name, origin: 'upload' })
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error))
      }
    }
    if (loaded.length) update([...props.modelValue, ...loaded])
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    reading.value = false
  }
}

function remove(index: number) {
  update(props.modelValue.filter((_, itemIndex) => itemIndex !== index))
}

function clearReferences() {
  update([])
}

function chooseFiles() {
  const files = Array.from(fileInput.value?.files || [])
  if (fileInput.value) fileInput.value.value = ''
  void addFiles(files)
}

onMounted(async () => {
  const selected = referenceStore.selected
  if (!selected) return
  try {
    addReference({ dataUrl: await fetchDataUrl(selected.url), name: selected.name, origin: 'library' })
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    referenceStore.clear()
  }
})
</script>

<template>
  <section class="idle-reference" aria-label="待机参考图">
    <div class="reference-heading">
      <div><h3>角色参考图 <span>{{ modelValue.length }} / 4</span></h3><p>可上传多张图，或导入其他角色已定稿母版作为参考。导入后仍需生成并定稿当前角色待机。</p></div>
      <NButton v-if="modelValue.length" size="tiny" quaternary @click="clearReferences">清空</NButton>
    </div>
    <div v-if="modelValue.length" class="reference-grid">
      <article v-for="(reference, index) in modelValue" :key="`${reference.origin}-${reference.sourceProjectId || 'local'}-${index}`" class="reference-thumb">
        <div class="reference-image checkerboard"><img :src="reference.dataUrl" :alt="reference.name" /></div>
        <div class="reference-meta"><strong :title="reference.name">{{ reference.name }}</strong><small>{{ originLabel(reference.origin) }}</small></div>
        <NButton quaternary size="tiny" :aria-label="`移除参考图 ${reference.name}`" @click="remove(index)"><NIcon><CloseOutline /></NIcon></NButton>
      </article>
    </div>
    <div v-else class="reference-empty">
      <NIcon size="25"><ImagesOutline /></NIcon>
      <span>还没有参考图，可以继续用文字制作</span>
    </div>
    <div class="reference-actions">
      <div class="reference-upload">
        <input ref="fileInput" type="file" accept="image/png,image/jpeg" multiple aria-label="上传待机参考图" @change="chooseFiles" />
        <NButton size="small" :loading="reading" :disabled="!remaining" @click="fileInput?.click()"><template #icon><NIcon><CloudUploadOutline /></NIcon></template>上传参考图</NButton>
      </div>
      <NButton v-if="allowMasterImport" size="small" @click="showImport = true"><template #icon><NIcon><ImagesOutline /></NIcon></template>导入母版作为参考</NButton>
      <span>PNG / JPG · 单张最大 12MB · 提交时合成参考表</span>
    </div>
    <MasterImportDialog v-model:show="showImport" :current-project-id="projectId" @select="addReference" />
  </section>
</template>

<style scoped>
.idle-reference { display: grid; gap: 13px; margin-bottom: 20px; padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: #f9fbf8; }
.reference-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.reference-heading h3 { margin: 0 0 5px; font-size: 14px; }
.reference-heading h3 span { margin-left: 5px; color: var(--muted); font: 10px "SFMono-Regular", Consolas, monospace; }
.reference-heading p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
.reference-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.reference-thumb { position: relative; min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 11px; background: #fff; }
.reference-image { display: grid; place-items: center; height: 96px; overflow: hidden; }
.reference-image img { width: 100%; height: 100%; object-fit: contain; }
.reference-meta { display: flex; flex-direction: column; gap: 3px; padding: 8px 30px 8px 9px; }
.reference-meta strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.reference-meta small { color: var(--muted); font-size: 9px; }
.reference-thumb > .n-button { position: absolute; right: 4px; bottom: 7px; }
.reference-empty { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 70px; border: 1px dashed #c7d2c9; border-radius: 10px; color: var(--muted); background: #fff; font-size: 11px; }
.reference-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.reference-upload input { display: none; }
.reference-actions > span { color: var(--muted); font-size: 10px; }
@media (max-width: 980px) { .reference-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .reference-actions > span { width: 100%; } }
</style>
