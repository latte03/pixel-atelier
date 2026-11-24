export type Vec2 = [number, number]
export type FrameSize = 128 | 160 | 192 | 224 | 256 | 320
export type ActionEventMap = {
  strikes?: number[]
  releases?: number[]
}

export interface SpriteRecipe {
  cols: number
  rows: number
  count: number
  frameSize: FrameSize
  scale: number
  baseOffset: Vec2
  offsets: Vec2[]
  durations: number[]
  pivot: Vec2
  colors: number
  previewScale: number
  loop: boolean
  events?: ActionEventMap
}

export interface CharacterAction {
  label: string
  source: string
  prompt: string
  review: 'pending' | 'approved' | string
  draft?: boolean
  recipe?: SpriteRecipe
  overrides?: Record<string, string>
}

export interface CharacterSpec {
  frameSize: FrameSize
  pivot: Vec2
  paletteLimit: number
  palette: string[]
  frozen: boolean
  version: number
  profile: 'bow' | 'staff' | 'greatsword' | 'custom' | string
  identity: string
  weapon: string
  style: string
}

export interface CharacterTemplate {
  description?: string
  directions?: string[]
  excluded_directions?: string[]
  frame_count?: number
  layout?: { cols: number; rows: number; count?: number }
  recommended_frame_durations_ms?: number[]
  quick_release_frames_zero_based?: number[]
  charged_hold_loop_frames_zero_based?: number[]
  release_from_hold_frames_zero_based?: number[]
  strike_frame_zero_based?: number
  charge_jitter?: Record<string, string>
  review_status?: string
  [key: string]: unknown
}

export interface CharacterProject {
  format: 'pixel-atelier-character/1'
  id?: string
  name: string
  master: string | null
  masterBasis?: { action: string; frame: number }
  spec: CharacterSpec
  actions: Record<string, CharacterAction>
  revision?: number
  created_at?: number
  updated_at?: number
  parent_id?: string
  template_origin?: string
  template?: CharacterTemplate
  provenance?: Record<string, unknown>
}

export interface ProjectSummary {
  id: string
  name: string
  revision: number
  updated_at: number
  actions: number
  parent_id?: string
  frozen: boolean
  hasMaster: boolean
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface GenerationJob {
  id: string
  prompt: string
  parent_id?: string
  status: JobStatus
  created_at: number
  finished_at?: number
  events: Array<Record<string, unknown>>
  action: string
  kind: 'pose' | 'sheet'
  character_context?: { id: string; spec_version: number } | null
  layout?: { cols: number; rows: number; count: number } | null
  image_url?: string
  image_file?: string
  image_size?: [number, number]
  model?: string
  error?: string
  generation_completion?: string
}

export interface ReferenceAsset {
  id: string
  name: string
  size: [number, number]
  image_url: string
  created_at: number
}

export interface ExportResult {
  id: string
  gif_url: string
  zip_url: string
  atlas_url: string
  config_url: string
  frame_count: number
  duration_ms: number
  palette_size: number
}

export interface ImageAPISettings {
  base_url: string
  api_key: string
  model: string
  size: string
  response_format: string
  timeout: number
}

export interface LLMSettings {
  base_url: string
  api_key: string
  model: string
  polish_prompt: boolean
}

export interface AppConfig {
  provider: 'custom' | 'codex'
  image: ImageAPISettings
  llm: LLMSettings
}

export interface SpriteFrame {
  rect: { x: number; y: number; width: number; height: number }
  bounds: [number, number, number, number] | null
  duration: number
  offset: Vec2
  override?: string
  overrideImage?: HTMLImageElement
}

export interface WorkspaceSource {
  url: string
  label: string
  job?: GenerationJob
}
