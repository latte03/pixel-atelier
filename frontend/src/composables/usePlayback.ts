import { onBeforeUnmount, onMounted } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'

export function usePlayback() {
  const workspace = useWorkspaceStore()
  let frameRequest = 0
  let lastTime = 0
  let elapsed = 0

  function tick(time: number) {
    if (workspace.playing && workspace.frames.length && workspace.recipe) {
      const delta = lastTime ? Math.min(100, time - lastTime) : 0
      elapsed += delta * workspace.playbackSpeed
      let moved = false
      while (elapsed >= workspace.frames[workspace.currentIndex].duration) {
        elapsed -= workspace.frames[workspace.currentIndex].duration
        if (workspace.currentIndex === workspace.frames.length - 1 && !workspace.loop) {
          workspace.playing = false
          workspace.currentIndex = 0
          moved = true
          break
        }
        workspace.currentIndex = (workspace.currentIndex + 1) % workspace.frames.length
        moved = true
      }
      if (moved) workspace.selectFrame(workspace.currentIndex, false)
    }
    lastTime = time
    frameRequest = requestAnimationFrame(tick)
  }

  function toggle() {
    if (!workspace.frames.length) return
    if (!workspace.playing && workspace.currentIndex === workspace.frames.length - 1 && !workspace.loop) {
      workspace.currentIndex = 0
    }
    elapsed = 0
    workspace.playing = !workspace.playing
  }

  onMounted(() => { frameRequest = requestAnimationFrame(tick) })
  onBeforeUnmount(() => cancelAnimationFrame(frameRequest))

  return { toggle }
}
