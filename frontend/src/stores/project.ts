import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import type { CharacterAction, CharacterProject, ProjectSummary } from '@/types/models'
import { createDraftAction, insertActionAfter, moveAction, uniqueActionId } from '@/utils/project'

export const useProjectStore = defineStore('project', () => {
  const projects = shallowRef<ProjectSummary[]>([])
  const project = shallowRef<CharacterProject | null>(null)
  const saving = ref(false)
  const dirty = ref(false)
  const conflict = ref(false)
  const error = ref('')
  const mutationId = ref(0)
  const savedMutationId = ref(0)
  let saveChain: Promise<void> = Promise.resolve()

  const actionEntries = computed(() => Object.entries(project.value?.actions || {}))
  const idleActionId = computed(() => {
    const p = project.value
    if (!p) return ''
    return p.masterBasis?.action
      || Object.keys(p.actions).filter(id => /^idle(?:_v[0-9]+)?$/.test(id) && !p.actions[id].draft).at(-1)
      || ''
  })
  const hasMaster = computed(() => !!project.value?.masterBasis && !!project.value?.master)
  const completedActions = computed(() => actionEntries.value.filter(([, action]) => !action.draft).length)

  async function list() {
    projects.value = await api.projects()
    return projects.value
  }

  async function open(id: string) {
    if (project.value && project.value.id !== id && dirty.value) await save()
    const next = await api.project(id)
    project.value = next
    conflict.value = false
    error.value = ''
    dirty.value = false
    mutationId.value = 0
    savedMutationId.value = 0
    return next
  }

  async function create(value: CharacterProject) {
    const created = await api.createProject(value)
    project.value = created
    projects.value = await list()
    dirty.value = false
    mutationId.value = 0
    savedMutationId.value = 0
    return created
  }

  function markDirty() {
    mutationId.value++
    dirty.value = true
    error.value = ''
  }

  function updateSpec(patch: Partial<CharacterProject['spec']>) {
    if (!project.value) return
    Object.assign(project.value.spec, patch)
    project.value.spec.version++
    markDirty()
  }

  function updateName(name: string) {
    if (!project.value) return
    project.value.name = name.slice(0, 80)
    markDirty()
  }

  function putAction(id: string, action: CharacterAction) {
    if (!project.value) return
    project.value.actions[id] = action
    markDirty()
  }

  function addAction(label: string, prompt = '') {
    if (!project.value) return ''
    if (Object.keys(project.value.actions).length >= 16) throw new Error('一个角色工程最多保存 16 个动作')
    const id = uniqueActionId(project.value.actions, label)
    putAction(id, createDraftAction(label, prompt))
    return id
  }

  function copyAction(id: string) {
    if (!project.value) return ''
    const source = project.value.actions[id]
    if (!source) return ''
    if (Object.keys(project.value.actions).length >= 16) throw new Error('一个角色工程最多保存 16 个动作')
    const copyId = uniqueActionId(project.value.actions, source.label || id, id)
    project.value.actions = insertActionAfter(project.value.actions, id, copyId, {
      ...structuredClone(source),
      label: `${source.label || id} · 副本`.slice(0, 80),
    })
    markDirty()
    return copyId
  }

  function reorderAction(id: string, delta: -1 | 1) {
    if (!project.value) return
    project.value.actions = moveAction(project.value.actions, id, delta)
    markDirty()
  }

  function removeAction(id: string) {
    if (!project.value) return
    if (project.value.masterBasis?.action === id) throw new Error('待机母版来源动作不能删除，请先更换母版')
    delete project.value.actions[id]
    markDirty()
  }

  async function save() {
    if (!project.value || saving.value || conflict.value) return
    const snapshot = structuredClone(project.value)
    const targetMutation = mutationId.value
    saving.value = true
    error.value = ''
    const run = saveChain.catch(() => {}).then(async () => {
      try {
        const saved = await api.saveProject(snapshot, snapshot.revision || 0)
        if (project.value?.id !== saved.id) return
        project.value = saved
        savedMutationId.value = Math.max(savedMutationId.value, targetMutation)
        dirty.value = mutationId.value !== savedMutationId.value
        projects.value = await list()
      } catch (cause) {
        conflict.value = cause instanceof Error && cause.message.includes('其他页面')
        error.value = cause instanceof Error ? cause.message : String(cause)
        throw cause
      } finally {
        saving.value = false
      }
    })
    saveChain = run
    return run
  }

  async function freeze() {
    if (!project.value) throw new Error('先打开角色工程')
    const snapshot = structuredClone(project.value)
    const saved = await api.freezeProject(snapshot, snapshot.revision || 0)
    project.value = saved
    savedMutationId.value = mutationId.value
    dirty.value = false
    projects.value = await list()
    return saved
  }

  async function clone() {
    if (!project.value) throw new Error('先打开角色工程')
    const created = await api.cloneProject(project.value.id!, `${project.value.name} · 副本`)
    project.value = created
    projects.value = await list()
    return created
  }

  return {
    projects, project, saving, dirty, conflict, error, mutationId,
    actionEntries, idleActionId, hasMaster, completedActions,
    list, open, create, save, freeze, clone, markDirty, updateSpec, updateName,
    putAction, addAction, copyAction, reorderAction, removeAction,
  }
})
