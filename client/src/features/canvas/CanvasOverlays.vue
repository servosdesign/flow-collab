<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import { useCanvasOverlayContext } from '../../app/flowEditorContext'

const { errorMessage, hasError, isFlowLoading, isLoggedIn } = useCanvasOverlayContext()
</script>

<template>
  <div
    v-if="hasError"
    class="error-bar"
  >
    {{ errorMessage }}
  </div>
  <div
    v-if="isFlowLoading"
    class="loading-mask"
  >
    <LoaderCircle
      class="spin"
      :size="22"
      aria-hidden="true"
    />
  </div>

  <div
    v-if="!isLoggedIn"
    class="logged-out-cover"
  >
    <div class="lod-overview">
      <LoaderCircle
        v-if="isFlowLoading"
        class="spin"
        :size="22"
        aria-hidden="true"
      />
      <div
        class="lod-grid"
        aria-hidden="true"
      >
        <span
          v-for="index in 42"
          :key="index"
        />
      </div>
    </div>
  </div>
</template>
