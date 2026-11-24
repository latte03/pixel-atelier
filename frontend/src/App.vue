<script setup lang="ts">
import { onMounted } from 'vue'
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider } from 'naive-ui'
import AppShell from '@/components/AppShell.vue'
import { useBootstrap } from '@/composables/useBootstrap'

useBootstrap()
onMounted(() => document.body.classList.add('vue-app'))
</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides">
    <NMessageProvider>
      <NNotificationProvider>
        <NDialogProvider>
          <AppShell />
        </NDialogProvider>
      </NNotificationProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<script lang="ts">
const themeOverrides = {
  common: {
    primaryColor: '#176b55',
    primaryColorHover: '#125644',
    primaryColorPressed: '#0d4738',
    successColor: '#176b55',
    warningColor: '#b7791f',
    errorColor: '#c2413b',
    infoColor: '#3b6f8f',
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    fontFamily: '"SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  Card: { borderRadius: '16px' },
  Button: { borderRadiusMedium: '10px' },
  Input: { borderRadiusMedium: '10px' },
}
</script>
