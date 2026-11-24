<script setup lang="ts">
import { ConstructOutline, RefreshOutline } from '@vicons/ionicons5'
import { NButton, NCard, NIcon, NScrollbar, NSpace, NTag } from 'naive-ui'
import type { CharacterAction } from '@/types/models'

defineProps<{ action: CharacterAction }>()
const emit = defineEmits<{
  edit: []
  regenerate: []
}>()
</script>

<template>
  <NCard class="sheet-card" :bordered="true">
    <div class="sheet-heading">
      <div>
        <span class="eyebrow">ACTION SHEET</span>
        <h2>{{ action.label }} · 原始动作图表</h2>
        <p>这里保留生成时的完整图表；帧编辑保存的是切帧后的时序、偏移与单帧替换。</p>
      </div>
      <NSpace :size="8">
        <NButton @click="emit('regenerate')"><template #icon><NIcon><RefreshOutline /></NIcon></template>重新生成</NButton>
        <NButton type="primary" @click="emit('edit')"><template #icon><NIcon><ConstructOutline /></NIcon></template>编辑帧</NButton>
      </NSpace>
    </div>
    <div class="sheet-layout">
      <div class="sheet-preview checkerboard">
        <img :src="action.source" :alt="`${action.label} 原始动作图表`" />
      </div>
      <aside class="sheet-facts">
        <NTag :bordered="false">{{ action.recipe?.count || 0 }} 帧</NTag>
        <NTag :bordered="false">{{ action.recipe?.cols || 0 }} × {{ action.recipe?.rows || 0 }}</NTag>
        <NTag :bordered="false">{{ action.recipe?.frameSize || 0 }}²</NTag>
        <dl>
          <div><dt>总时长</dt><dd>{{ action.recipe?.durations.reduce((total, value) => total + value, 0) || 0 }} ms</dd></div>
          <div><dt>导出色数</dt><dd>{{ action.recipe?.colors || 0 }} 色</dd></div>
          <div><dt>根节点</dt><dd class="mono">{{ action.recipe?.pivot.join(', ') || '—' }}</dd></div>
        </dl>
      </aside>
    </div>
    <details v-if="action.prompt" class="sheet-prompt">
      <summary>查看生成时的制作稿</summary>
      <NScrollbar class="sheet-prompt-scroll" style="max-height: 280px">
        <pre>{{ action.prompt }}</pre>
      </NScrollbar>
    </details>
  </NCard>
</template>

<style scoped>
.sheet-card { padding: 22px; }
.sheet-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
.sheet-heading h2 { margin: 7px 0 6px; font-size: 20px; letter-spacing: -.03em; }
.sheet-heading p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.sheet-layout { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 16px; align-items: start; }
.sheet-preview { display: grid; place-items: center; min-height: 280px; overflow: hidden; border: 1px solid var(--line); border-radius: 14px; }
.sheet-preview img { display: block; width: 100%; max-height: 520px; object-fit: contain; }
.sheet-facts { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: #fafbf8; }
.sheet-facts dl { display: grid; gap: 13px; width: 100%; margin: 8px 0 0; }
.sheet-facts dl div { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; }
.sheet-facts dt { color: var(--muted); }
.sheet-facts dd { margin: 0; text-align: right; }
.sheet-prompt { margin-top: 16px; border: 1px solid var(--line); border-radius: 12px; background: #fafbf8; }
.sheet-prompt summary { padding: 12px 14px; color: #526159; font-size: 12px; cursor: pointer; }
.sheet-prompt pre { margin: 0; padding: 14px; border-top: 1px solid var(--line); color: #55635b; font: 11px/1.7 "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 860px) {
  .sheet-heading { flex-direction: column; }
  .sheet-layout { grid-template-columns: 1fr; }
  .sheet-facts { align-items: center; }
}
</style>
