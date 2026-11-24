<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CopyOutline, DownloadOutline, FolderOpenOutline, RefreshOutline, SearchOutline } from '@vicons/ionicons5'
import { NButton, NCard, NEmpty, NIcon, NInput, NSpin, useMessage } from 'naive-ui'
import { api } from '@/services/api'
import { useGenerationStore } from '@/stores/generation'
import { useProjectStore } from '@/stores/project'
import { useReferenceStore } from '@/stores/reference'
import NewProjectDialog from '@/components/NewProjectDialog.vue'
import { characterSheetPath } from '@/composables/useCharacterRoute'

const router = useRouter()
const projectStore = useProjectStore()
const referenceStore = useReferenceStore()
const generationStore = useGenerationStore()
const message = useMessage()
const search = ref('')
const loading = ref(false)
const showNewProject = ref(false)

const projects = computed(() => projectStore.projects.filter(project => project.name.toLowerCase().includes(search.value.toLowerCase())))
const completedJobs = computed(() => generationStore.jobs.filter(job => job.status === 'completed'))

onMounted(() => projectStore.list())

async function open(id: string) {
  loading.value = true
  try {
    await projectStore.open(id)
    if (referenceStore.hasSelected && projectStore.hasMaster) {
      message.info('这个角色已使用母版，参考图请用于待机或新角色')
      return
    }
    const draft = projectStore.actionEntries.find(([, action]) => action.draft)
    if (referenceStore.hasSelected && !draft) {
      message.info('这个角色没有待制作动作，暂时无法使用参考图')
      return
    }
    const first = referenceStore.hasSelected ? draft?.[0] : projectStore.idleActionId || Object.keys(projectStore.project?.actions || {})[0]
    if (!first) {
      message.info('这个角色还没有动作，请先新增一个动作')
      return
    }
    await router.push(characterSheetPath(id, first))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

async function clone(id: string) {
  try {
    await projectStore.open(id)
    await projectStore.clone()
    message.success('已创建独立副本')
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function exportProject(id: string) {
  try {
    const result = await api.exportProject(id)
    const anchor = document.createElement('a')
    anchor.href = result.zip_url
    anchor.download = 'character-assets.zip'
    anchor.click()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function openJob(id: string) {
  const job = generationStore.jobs.find(item => item.id === id)
  const projectId = job?.character_context?.id
  if (!job?.image_url || !projectId) {
    message.warning('这条生成记录没有关联角色工程，请在参考库中查看图片')
    return
  }
  loading.value = true
  try {
    await projectStore.open(projectId)
    const actionId = projectStore.project?.actions[job.action] ? job.action : projectStore.idleActionId || Object.keys(projectStore.project?.actions || {})[0]
    if (!actionId) {
      message.info('所属角色还没有动作')
      return
    }
    await router.push(characterSheetPath(projectId, actionId))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page works-page">
    <div class="page-heading">
      <div><span class="eyebrow">YOUR WORKS</span><h1>作品与生成记录</h1><p>角色工程保存全部动作与规格；生成记录保留每一次尝试。</p></div>
      <NInput v-model:value="search" placeholder="搜索角色" clearable style="width: 260px"><template #prefix><NIcon><SearchOutline /></NIcon></template></NInput>
    </div>
    <NSpin :show="loading">
      <div v-if="projects.length" class="project-grid">
        <NCard v-for="project in projects" :key="project.id" class="project-card">
          <div class="project-card-top"><span class="project-monogram">{{ project.name.slice(0, 1) }}</span><span class="project-state">{{ project.frozen ? '规格已冻结' : '设计中' }}</span></div>
          <h2>{{ project.name }}</h2>
          <p>{{ project.actions }} 个动作 · 修订 {{ project.revision }} · {{ new Date(project.updated_at * 1000).toLocaleDateString() }}</p>
          <div class="project-card-actions">
            <NButton size="small" type="primary" @click="open(project.id)"><template #icon><NIcon><FolderOpenOutline /></NIcon></template>打开</NButton>
            <NButton size="small" @click="clone(project.id)"><template #icon><NIcon><CopyOutline /></NIcon></template>复制</NButton>
            <NButton size="small" quaternary aria-label="导出角色资源" @click="exportProject(project.id)"><NIcon><DownloadOutline /></NIcon></NButton>
          </div>
        </NCard>
      </div>
      <NEmpty v-else description="还没有匹配的角色工程" class="works-empty"><NButton type="primary" @click="showNewProject = true">创建第一个角色</NButton></NEmpty>
    </NSpin>
    <section class="generated-section">
      <div class="section-title"><div><h2>生成结果</h2><p>在所属角色中查看原始图表或继续编辑帧。</p></div><NButton size="small" quaternary @click="generationStore.refresh()"><template #icon><NIcon><RefreshOutline /></NIcon></template>刷新</NButton></div>
      <div v-if="completedJobs.length" class="job-grid">
        <NCard v-for="job in completedJobs" :key="job.id" class="job-card">
          <button class="job-image checkerboard" type="button" @click="openJob(job.id)"><img :src="job.image_url" :alt="`${job.action} 生成结果`" /></button>
          <div class="job-copy"><strong>{{ job.action }} · {{ job.kind === 'sheet' ? '动作图表' : '角色姿势' }}</strong><small>{{ new Date(job.created_at * 1000).toLocaleString() }}</small></div>
          <NButton size="small" block @click="openJob(job.id)">查看动作图表</NButton>
        </NCard>
      </div>
      <NEmpty v-else description="还没有已完成的生成结果" />
    </section>
    <NewProjectDialog v-model:show="showNewProject" />
  </div>
</template>

<style scoped>
.project-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.project-card { padding: 20px; }
.project-card-top { display: flex; align-items: center; justify-content: space-between; }
.project-monogram { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); font-size: 20px; font-weight: 750; }
.project-state { color: var(--muted); font-size: 10px; }
.project-card h2 { margin: 16px 0 7px; font-size: 17px; letter-spacing: -.025em; }
.project-card p { margin: 0; color: var(--muted); font-size: 11px; }
.project-card-actions { display: flex; align-items: center; gap: 7px; margin-top: 18px; }
.works-empty { padding: 50px 0; }
.generated-section { margin-top: 30px; }
.job-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.job-card { padding: 14px; }
.job-image { display: block; width: 100%; height: 150px; overflow: hidden; padding: 0; border: 0; border-radius: 10px; cursor: pointer; }
.job-image img { width: 100%; height: 100%; object-fit: contain; }
.job-copy { display: flex; flex-direction: column; gap: 5px; margin: 12px 0; }
.job-copy strong { font-size: 12px; }
.job-copy small { color: var(--muted); font-size: 10px; }
@media (max-width: 1050px) { .project-grid { grid-template-columns: 1fr 1fr; } .job-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 640px) { .project-grid, .job-grid { grid-template-columns: 1fr; } }
</style>
