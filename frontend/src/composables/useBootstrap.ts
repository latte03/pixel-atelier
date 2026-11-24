import { onMounted } from 'vue'
import { useGenerationStore } from '@/stores/generation'
import { useProjectStore } from '@/stores/project'

export function useBootstrap() {
  const projectStore = useProjectStore()
  const generationStore = useGenerationStore()

  onMounted(() => {
    void Promise.allSettled([projectStore.list(), generationStore.refresh()])
  })
}
