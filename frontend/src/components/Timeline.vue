<script setup lang="ts">
import {
  ArrowBackOutline, ArrowForwardOutline, GridOutline, LayersOutline, PauseOutline, PlayOutline,
} from '@vicons/ionicons5'
import { NButton, NCheckbox, NIcon, NScrollbar, NSelect, NTooltip } from 'naive-ui'
import FrameThumbnail from '@/components/FrameThumbnail.vue'
import { usePlayback } from '@/composables/usePlayback'
import { useWorkspaceStore } from '@/stores/workspace'
import { formatDuration } from '@/utils/project'

const workspace = useWorkspaceStore()
const { toggle } = usePlayback()
</script>

<template>
  <section class="timeline-panel">
    <div class="timeline-toolbar">
      <div class="timeline-title"><strong>动作时间轴</strong><span>{{ workspace.frames.length }} 帧 · {{ formatDuration(workspace.duration) }}</span></div>
      <div class="transport-controls">
        <NButton quaternary size="small" aria-label="上一帧" :disabled="!workspace.frames.length" @click="workspace.selectFrame(workspace.currentIndex - 1)"><NIcon><ArrowBackOutline /></NIcon></NButton>
        <NButton quaternary size="small" :aria-label="workspace.playing ? '暂停动画' : '播放动画'" :disabled="!workspace.frames.length" @click="toggle"><NIcon><component :is="workspace.playing ? PauseOutline : PlayOutline" /></NIcon></NButton>
        <NButton quaternary size="small" aria-label="下一帧" :disabled="!workspace.frames.length" @click="workspace.selectFrame(workspace.currentIndex + 1)"><NIcon><ArrowForwardOutline /></NIcon></NButton>
        <NSelect v-model:value="workspace.playbackSpeed" :options="[{ label: '0.5×', value: .5 }, { label: '1×', value: 1 }, { label: '2×', value: 2 }]" size="small" style="width: 82px" />
        <NCheckbox v-model:checked="workspace.loop">循环</NCheckbox>
        <NTooltip><template #trigger><NButton quaternary size="small" :type="workspace.showOnion ? 'primary' : 'default'" aria-label="前帧叠影" @click="workspace.showOnion = !workspace.showOnion"><NIcon><LayersOutline /></NIcon></NButton></template>前帧叠影</NTooltip>
      </div>
    </div>
    <NScrollbar v-if="workspace.frames.length" x-scrollable>
      <div class="frame-strip">
      <button
        v-for="(frame, index) in workspace.frames"
        :key="index"
        type="button"
        class="frame-card"
        :class="{ selected: workspace.currentIndex === index }"
        :aria-label="`选择第 ${index + 1} 帧`"
        @click="workspace.selectFrame(index)"
      >
        <span class="frame-number">{{ String(index + 1).padStart(2, '0') }}</span>
        <span class="frame-image checkerboard"><FrameThumbnail :index="index" /></span>
        <span class="frame-duration">{{ frame.duration }} ms</span>
      </button>
      </div>
    </NScrollbar>
    <div v-else class="timeline-empty"><NIcon><GridOutline /></NIcon><span>生成或导入图表后，关键帧会出现在这里。</span></div>
  </section>
</template>

<style scoped>
.timeline-panel { border: 1px solid var(--line); border-radius: 14px; background: #fff; overflow: hidden; }
.timeline-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 54px; padding: 8px 14px; border-bottom: 1px solid var(--line); }
.timeline-title { display: flex; align-items: baseline; gap: 10px; }
.timeline-title strong { font-size: 13px; }
.timeline-title span { color: var(--muted); font-size: 11px; }
.transport-controls { display: flex; align-items: center; gap: 5px; }
.frame-strip { display: flex; gap: 8px; width: max-content; min-width: 100%; padding: 14px; }
.frame-card { display: flex; flex: 0 0 92px; flex-direction: column; gap: 6px; padding: 6px; border: 1px solid var(--line); border-radius: 9px; background: #fff; color: inherit; cursor: pointer; }
.frame-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px #176b5524; background: #f4faf6; }
.frame-number { align-self: flex-start; color: #849087; font: 9px "SFMono-Regular", Consolas, monospace; }
.frame-image { display: block; width: 100%; height: 66px; overflow: hidden; border-radius: 5px; }
.frame-duration { color: var(--muted); font: 9px "SFMono-Regular", Consolas, monospace; text-align: center; }
.timeline-empty { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 110px; color: var(--muted); font-size: 12px; }
@media (max-width: 760px) { .timeline-toolbar { align-items: flex-start; flex-direction: column; } .transport-controls { width: 100%; flex-wrap: wrap; } }
</style>
