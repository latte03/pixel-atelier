import { request } from './http'
import type {
  AppConfig,
  CharacterProject,
  ExportResult,
  GenerationJob,
  ProjectSummary,
  ReferenceAsset,
  SpriteRecipe,
} from '@/types/models'

export interface GeneratePayload {
  prompt: string
  action: string
  kind: 'pose' | 'sheet'
  layout?: { cols: number; rows: number; count: number } | null
  character_context?: { id: string; spec_version: number } | null
  reference?: string
  reference_id?: string
  parent_id?: string
  from_text?: boolean
}

export interface ExportPayload {
  name: string
  frames: Array<{ image: string; duration_ms: number; offset: [number, number] }>
  pivot: [number, number]
  colors: number
  preview_scale: number
  loop: boolean
  source?: string
  recipe: SpriteRecipe
  fixed_palette?: string[]
}

export const api = {
  health: () => request<{ service: string; ready: boolean; transport: string }>('/health'),
  projects: () => request<ProjectSummary[]>('/projects'),
  project: (id: string) => request<CharacterProject>(`/project/${id}`),
  createProject: (project: CharacterProject) => request<CharacterProject>('/projects', {
    method: 'POST', body: JSON.stringify(project),
  }),
  saveProject: (project: CharacterProject, expectedRevision: number) => request<CharacterProject>('/projects/save', {
    method: 'POST', body: JSON.stringify({ project, expected_revision: expectedRevision }),
  }),
  cloneProject: (id: string, name?: string) => request<CharacterProject>('/projects/clone', {
    method: 'POST', body: JSON.stringify({ id, name }),
  }),
  freezeProject: (project: CharacterProject, expectedRevision: number) => request<CharacterProject>('/projects/freeze', {
    method: 'POST', body: JSON.stringify({ project, expected_revision: expectedRevision }),
  }),
  exportProject: (id: string) => request<{ zip_url: string; actions: number }>('/projects/export', {
    method: 'POST', body: JSON.stringify({ id }),
  }),
  createArcher: (name: string) => request<CharacterProject>('/projects/archer', {
    method: 'POST', body: JSON.stringify({ name }),
  }),
  createKnight: () => request<CharacterProject>('/projects/knight', {
    method: 'POST', body: JSON.stringify({}),
  }),
  createMaster: (data: { name: string; master: string; profile: string; weapon?: string }) => request<CharacterProject>('/projects/master', {
    method: 'POST', body: JSON.stringify(data),
  }),
  jobs: () => request<GenerationJob[]>('/jobs'),
  generate: (payload: GeneratePayload) => request<GenerationJob>('/jobs', {
    method: 'POST', body: JSON.stringify(payload),
  }),
  resumeDownload: (id: string) => request<GenerationJob>(`/jobs/${id}/resume-download`, {
    method: 'POST', body: JSON.stringify({}),
  }),
  references: () => request<ReferenceAsset[]>('/references'),
  saveReference: (image: string, name: string) => request<ReferenceAsset>('/references', {
    method: 'POST', body: JSON.stringify({ image, name }),
  }),
  gifFrames: (image: string) => request<{ count: number; frames: Array<{ index: number; image: string }> }>('/references/gif-frames', {
    method: 'POST', body: JSON.stringify({ image }),
  }),
  saveIdleGif: (id: string, image: string, index: number, expectedRevision: number) => request<{ project: CharacterProject; action: string; reference_index: number }>('/projects/idle-gif', {
    method: 'POST', body: JSON.stringify({ id, image, index, expected_revision: expectedRevision }),
  }),
  exportAnimation: (payload: ExportPayload) => request<ExportResult>('/exports', {
    method: 'POST', body: JSON.stringify(payload),
  }),
  config: () => request<AppConfig>('/config'),
  saveConfig: (config: Partial<AppConfig>) => request<AppConfig>('/config', {
    method: 'POST', body: JSON.stringify(config),
  }),
  testConfig: (target: 'image' | 'llm', base_url: string, api_key: string) => request<{ ok: boolean; message: string; models: string[] }>('/config/test', {
    method: 'POST', body: JSON.stringify({ target, base_url, api_key }),
  }),
}
