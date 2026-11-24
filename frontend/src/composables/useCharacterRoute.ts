import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useProjectStore } from '@/stores/project'

export function characterSheetPath(projectId: string, actionId: string) {
  return `/projects/${projectId}/actions/${actionId}/create`
}

export function characterEditorPath(projectId: string, actionId: string) {
  return `/projects/${projectId}/actions/${actionId}/editor`
}

export function characterDeliveryPath(projectId: string) {
  return `/projects/${projectId}/delivery`
}

export function useCharacterRoute() {
  const route = useRoute()
  const projectStore = useProjectStore()
  const projectId = computed(() => String(route.params.projectId || ''))
  const actionId = computed(() => String(route.params.actionId || ''))
  const action = computed(() => projectId.value ? projectStore.project?.actions[actionId.value] || null : null)
  const defaultActionId = computed(() => projectStore.idleActionId || Object.keys(projectStore.project?.actions || {})[0] || '')

  function sheetPath(id = actionId.value || defaultActionId.value) {
    return characterSheetPath(projectId.value, id)
  }

  function editorPath(id = actionId.value || defaultActionId.value) {
    return characterEditorPath(projectId.value, id)
  }

  function deliveryPath() {
    return characterDeliveryPath(projectId.value)
  }

  return { projectId, actionId, action, defaultActionId, sheetPath, editorPath, deliveryPath }
}
