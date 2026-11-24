import { onBeforeUnmount, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useProjectStore } from '@/stores/project'

export function useProjectAutosave() {
  const projectStore = useProjectStore()
  const message = useMessage()
  let timer: number | undefined

  function schedule() {
    if (!projectStore.project || !projectStore.dirty || projectStore.saving || projectStore.conflict) return
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      projectStore.save().catch((error: unknown) => message.error(error instanceof Error ? error.message : String(error)))
    }, 800)
  }

  function flush() {
    if (timer) window.clearTimeout(timer)
    if (projectStore.dirty && !projectStore.conflict) return projectStore.save()
    return Promise.resolve()
  }

  watch(() => projectStore.mutationId, schedule)
  watch(() => projectStore.saving, saving => { if (!saving) schedule() })
  onBeforeUnmount(flush)

  return { flush }
}
