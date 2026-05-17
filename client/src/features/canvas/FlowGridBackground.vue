<template>
  <div
    class="flow-grid-background"
    aria-hidden="true"
  />
</template>

<style scoped>
.flow-grid-background {
  position: absolute;
  z-index: 0;
  inset: -100000px;
  pointer-events: none;
  contain: layout paint style;
  background: #eef3f8;
}
</style>
