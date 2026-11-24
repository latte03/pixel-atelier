import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import type { GenerationJob } from '@/types/models'

export const useGenerationStore = defineStore('generation', () => {
  const jobs = shallowRef<GenerationJob[]>([])
  const activeJobId = ref('')
  const submitting = ref(false)
  const resuming = ref(false)
  const polling = ref(false)
  const error = ref('')
  let timer: number | undefined

  const activeJob = computed(() => jobs.value.find(job => job.id === activeJobId.value) || null)
  const busy = computed(() => resuming.value || jobs.value.some(job => job.status === 'queued' || job.status === 'running'))

  async function refresh() {
    jobs.value = await api.jobs()
    return jobs.value
  }

  async function submit(payload: Parameters<typeof api.generate>[0]) {
    if (busy.value) throw new Error('已有生成任务运行中，请等待完成')
    submitting.value = true
    error.value = ''
    try {
      const job = await api.generate(payload)
      jobs.value.unshift(job)
      activeJobId.value = job.id
      startPolling()
      return job
    } finally {
      submitting.value = false
    }
  }

  async function resumeDownload(id: string) {
    resuming.value = true
    error.value = ''
    try {
      const job = await api.resumeDownload(id)
      const index = jobs.value.findIndex(item => item.id === id)
      jobs.value = index >= 0 ? jobs.value.map(item => item.id === id ? job : item) : [job, ...jobs.value]
      activeJobId.value = id
      return job
    } finally {
      resuming.value = false
    }
  }

  function setActive(id: string) {
    activeJobId.value = id
  }

  function startPolling() {
    if (timer) return
    polling.value = true
    timer = window.setInterval(async () => {
      try {
        await refresh()
        if (!busy.value) stopPolling()
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause)
      }
    }, 1500)
  }

  function stopPolling() {
    if (timer) window.clearInterval(timer)
    timer = undefined
    polling.value = false
  }

  return { jobs, activeJobId, activeJob, submitting, resuming, polling, busy, error, refresh, submit, resumeDownload, setActive, startPolling, stopPolling }
})
