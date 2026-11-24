import { createRouter, createWebHashHistory } from 'vue-router'
import CreateView from '@/views/CreateView.vue'
import EditorView from '@/views/EditorView.vue'
import WorksView from '@/views/WorksView.vue'
import ReferencesView from '@/views/ReferencesView.vue'
import DeliveryView from '@/views/DeliveryView.vue'
import { useProjectStore } from '@/stores/project'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/works' },
    { path: '/works', name: 'works', component: WorksView, meta: { title: '作品' } },
    { path: '/references', name: 'references', component: ReferencesView, meta: { title: '参考库' } },
    { path: '/projects/:projectId/create', name: 'create', component: CreateView, meta: { title: '创作', projectContext: true } },
    { path: '/projects/:projectId/actions/:actionId/create', name: 'create-action', component: CreateView, meta: { title: '创作', projectContext: true } },
    { path: '/projects/:projectId/actions/:actionId/editor', name: 'editor', component: EditorView, meta: { title: '动作编辑', projectContext: true } },
    { path: '/projects/:projectId/delivery', name: 'delivery', component: DeliveryView, meta: { title: '交付检查', projectContext: true } },
  ],
})

router.beforeEach(async to => {
  const projectId = String(to.params.projectId || '')
  if (!projectId) return true
  const projectStore = useProjectStore()
  try {
    if (projectStore.project?.id !== projectId) await projectStore.open(projectId)
    const actionId = String(to.params.actionId || '')
    if (actionId && !projectStore.project?.actions[actionId]) {
      const fallback = projectStore.idleActionId || Object.keys(projectStore.project?.actions || {})[0]
      return fallback
        ? { name: 'create-action', params: { projectId, actionId: fallback }, replace: true }
        : { name: 'create', params: { projectId }, replace: true }
    }
    return true
  } catch {
    return { name: 'works', replace: true }
  }
})

router.afterEach(to => {
  document.title = `${to.meta.title || 'Pixel Atelier'} · Pixel Atelier`
})
