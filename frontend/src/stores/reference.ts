import { computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import { readFile } from '@/services/images'
import type { ReferenceAsset } from '@/types/models'

export interface SelectedReference {
  url: string
  name: string
  referenceId?: string
}

export const useReferenceStore = defineStore('reference', () => {
  const assets = shallowRef<ReferenceAsset[]>([])
  const selected = shallowRef<SelectedReference | null>(null)

  async function load() {
    assets.value = await api.references()
    return assets.value
  }

  async function upload(file: File) {
    if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('请选择 PNG 或 JPG')
    if (file.size > 12 * 1024 * 1024) throw new Error('图片请小于 12MB')
    const image = await readFile(file)
    const asset = await api.saveReference(image, file.name.replace(/\.[^.]+$/, ''))
    assets.value.unshift(asset)
    return asset
  }

  function select(reference: SelectedReference) {
    selected.value = reference
  }

  async function selectAsset(asset: ReferenceAsset) {
    selected.value = { url: asset.image_url, name: asset.name, referenceId: asset.id }
  }

  async function useGenerated(job: { id: string; image_url?: string; action: string }) {
    if (!job.image_url) throw new Error('生成结果还没有图片')
    selected.value = { url: job.image_url, name: `${job.action} · 生成版本` }
  }

  function clear() {
    selected.value = null
  }

  const hasSelected = computed(() => !!selected.value)

  return { assets, selected, hasSelected, load, upload, select, selectAsset, useGenerated, clear }
})
