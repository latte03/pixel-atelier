<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CloudUploadOutline, ArrowForwardOutline } from '@vicons/ionicons5'
import { NButton, NCard, NEmpty, NIcon, NUpload, useMessage } from 'naive-ui'
import { useGenerationStore } from '@/stores/generation'
import { useReferenceStore } from '@/stores/reference'

const router = useRouter()
const referenceStore = useReferenceStore()
const generationStore = useGenerationStore()
const message = useMessage()
const uploading = ref(false)

onMounted(async () => {
  await Promise.allSettled([referenceStore.load(), generationStore.refresh()])
})

async function upload({ file }: { file: { file: File | null } }) {
  const value = file.file
  if (!value || uploading.value) return
  uploading.value = true
  try {
    await referenceStore.upload(value)
    message.success('参考图已收藏')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    uploading.value = false
  }
}

async function useReference(id: string) {
  const asset = referenceStore.assets.find(item => item.id === id)
  if (!asset) return
  await referenceStore.selectAsset(asset)
  await router.push('/works')
}

async function useGenerated(job: Parameters<typeof referenceStore.useGenerated>[0]) {
  await referenceStore.useGenerated(job)
  await router.push('/works')
}
</script>

<template>
  <div class="page references-page">
    <div class="page-heading">
      <div><span class="eyebrow">REFERENCE LIBRARY</span><h1>角色参考库</h1><p>先选参考图，再选择要使用它的角色与待制作动作。</p></div>
      <NUpload accept="image/png,image/jpeg" :max="1" :show-file-list="false" @change="upload"><NButton type="primary" :loading="uploading"><template #icon><NIcon><CloudUploadOutline /></NIcon></template>导入角色参考</NButton></NUpload>
    </div>
    <section>
      <div class="section-title"><h2>收藏的角色参考</h2><span class="muted">{{ referenceStore.assets.length }} 张</span></div>
      <div v-if="referenceStore.assets.length" class="reference-grid">
        <NCard v-for="asset in referenceStore.assets" :key="asset.id" class="reference-card">
          <div class="reference-image checkerboard"><img :src="asset.image_url" :alt="asset.name" /></div>
          <h3>{{ asset.name }}</h3>
          <p>{{ asset.size.join(' × ') }} px · {{ new Date(asset.created_at * 1000).toLocaleDateString() }}</p>
          <NButton size="small" block @click="useReference(asset.id)">选择角色并使用<template #icon><NIcon><ArrowForwardOutline /></NIcon></template></NButton>
        </NCard>
      </div>
      <NEmpty v-else description="还没有收藏的角色参考" />
    </section>
    <section class="generated-references">
      <div class="section-title"><h2>生成结果</h2><span class="muted">可直接复用</span></div>
      <div v-if="generationStore.jobs.some(job => job.status === 'completed')" class="reference-grid">
        <NCard v-for="job in generationStore.jobs.filter(job => job.status === 'completed')" :key="job.id" class="reference-card">
          <div class="reference-image checkerboard"><img :src="job.image_url" :alt="`${job.action} 生成结果`" /></div>
          <h3>{{ job.action }} · 生成版本</h3>
          <p>{{ job.kind === 'sheet' ? '动作图表' : '角色姿势' }} · {{ new Date(job.created_at * 1000).toLocaleDateString() }}</p>
          <NButton size="small" block @click="useGenerated(job)">选择角色并使用<template #icon><NIcon><ArrowForwardOutline /></NIcon></template></NButton>
        </NCard>
      </div>
      <NEmpty v-else description="生成完成后会出现在这里" />
    </section>
  </div>
</template>

<style scoped>
.reference-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.reference-card { padding: 14px; }
.reference-image { height: 190px; overflow: hidden; border-radius: 10px; }
.reference-image img { width: 100%; height: 100%; object-fit: contain; }
.reference-card h3 { margin: 13px 0 5px; font-size: 14px; }
.reference-card p { margin: 0 0 14px; color: var(--muted); font-size: 11px; }
.generated-references { margin-top: 30px; }
@media (max-width: 1050px) { .reference-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 760px) { .reference-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 520px) { .reference-grid { grid-template-columns: 1fr; } }
</style>
