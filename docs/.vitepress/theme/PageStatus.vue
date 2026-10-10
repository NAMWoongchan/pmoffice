<script setup>
import { useData } from 'vitepress'
const { frontmatter } = useData()
</script>
<template>
  <p v-if="frontmatter.status" class="page-status" :class="frontmatter.status">
    {{ frontmatter.status === 'draft' ? '초안 · 분야 안내와 작성 예정 주제입니다.' : '검토 완료 · 본문에 명시한 실동작 검증 한계를 확인하십시오.' }}
  </p>
</template>
