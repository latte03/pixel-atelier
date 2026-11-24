import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import type { AppConfig } from '@/types/models'

export const useSettingsStore = defineStore('settings', () => {
  const config = shallowRef<AppConfig | null>(null)
  const loading = ref(false)
  const saving = ref(false)

  async function load() {
    loading.value = true
    try {
      config.value = await api.config()
      return config.value
    } finally {
      loading.value = false
    }
  }

  async function save(value: AppConfig) {
    saving.value = true
    try {
      config.value = await api.saveConfig(value)
      return config.value
    } finally {
      saving.value = false
    }
  }

  return { config, loading, saving, load, save }
})
