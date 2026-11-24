<script setup lang="ts">
import { computed } from 'vue'
import { CheckmarkCircleOutline, EllipseOutline } from '@vicons/ionicons5'
import { NCard, NIcon, NSpace, NTag } from 'naive-ui'
import ActionList from '@/components/ActionList.vue'
import { useProjectStore } from '@/stores/project'

const props = defineProps<{ actionId: string }>()
const emit = defineEmits<{
  open: [id: string]
  create: [id: string]
  changed: []
}>()
const projectStore = useProjectStore()
const stage = computed(() => !projectStore.idleActionId ? 0 : !projectStore.hasMaster ? 1 : 2)
const stages = [
  { title: '创建角色', description: '确定工程与角色设定' },
  { title: '制作待机', description: '生成连续待机并自动切帧' },
  { title: '定稿母版', description: '选一帧锁定人物与装备' },
  { title: '扩展动作', description: '沿用母版制作其余动作' },
]
</script>

<template>
  <NCard class="workflow-card" :bordered="true">
    <div class="workflow-heading">
      <div>
        <span class="eyebrow">CHARACTER WORKFLOW</span>
        <h2>{{ projectStore.project?.name }}</h2>
        <p>每一步都会自动保存。生成完成后直接进入时间轴，不需要再手动确认排版。</p>
      </div>
      <NSpace :size="8">
        <NTag :type="projectStore.project?.spec.frozen ? 'success' : 'warning'" :bordered="false">
          {{ projectStore.project?.spec.frozen ? '色板已冻结' : '色板待冻结' }}
        </NTag>
        <NTag :bordered="false">修订 {{ projectStore.project?.revision || 1 }}</NTag>
      </NSpace>
    </div>
    <div class="workflow-steps">
      <div v-for="(item, index) in stages" :key="item.title" class="workflow-step" :class="{ done: index < stage, active: index === stage }">
        <span class="step-marker"><NIcon><CheckmarkCircleOutline v-if="index < stage" /><EllipseOutline v-else /></NIcon></span>
        <span><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span>
      </div>
    </div>
    <div class="workflow-body">
      <ActionList :active-action-id="props.actionId" @open="emit('open', $event)" @create="emit('create', $event)" @changed="emit('changed')" />
    </div>
  </NCard>
</template>

<style scoped>
.workflow-card { padding: 22px; }
.workflow-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.workflow-heading h2 { margin: 7px 0 6px; font-size: 22px; letter-spacing: -.03em; }
.workflow-heading p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.workflow-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 22px 0; }
.workflow-step { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 11px; background: #f6f8f4; color: #8a938c; }
.workflow-step.active { background: var(--accent-soft); color: var(--accent-dark); }
.workflow-step.done { color: #4f6e5d; }
.step-marker { display: grid; place-items: center; width: 25px; height: 25px; font-size: 18px; }
.workflow-step > span:last-child { display: flex; flex-direction: column; gap: 3px; }
.workflow-step strong { font-size: 12px; }
.workflow-step small { font-size: 10px; opacity: .78; }
.workflow-body { border-top: 1px solid var(--line); padding-top: 16px; }
@media (max-width: 860px) { .workflow-steps { grid-template-columns: 1fr 1fr; } .workflow-heading { flex-direction: column; } }
</style>
