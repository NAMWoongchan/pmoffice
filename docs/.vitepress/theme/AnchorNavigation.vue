<script setup>
import { onMounted, onUnmounted } from 'vue'

function closeMenuAfterAnchor(event) {
  const link = event.target?.closest?.('.VPSidebar a[href*="#part-"]')
  if (!link || !document.querySelector('.VPSidebar.open')) return
  requestAnimationFrame(() => document.querySelector('.VPBackdrop')?.click())
}

onMounted(() => document.addEventListener('click', closeMenuAfterAnchor, true))
onUnmounted(() => document.removeEventListener('click', closeMenuAfterAnchor, true))
</script>

<template><span aria-hidden="true" hidden /></template>
