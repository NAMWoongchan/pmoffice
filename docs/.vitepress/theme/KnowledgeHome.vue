<script setup>
import { ref, computed } from 'vue'
import { withBase } from 'vitepress'
const categories = ['전체', '프로젝트 관리', 'MS Project', '실전 AI', '테크']
const selected = ref('전체')
const entries = [
  { title: '프로젝트 관리 패러다임 시프트', category: '프로젝트 관리', description: 'AI 시대의 방법론·도구·리더십과 제조업 적용, 8가지 실습을 학습하는 심층 교재입니다.', path: '/project-management/paradigm-shift.html', status: 'published' },
  { title: '프로젝트 관리', category: '프로젝트 관리', description: '범위·WBS·일정·원가·위험·품질의 분야 안내와 작성 예정 주제입니다.', path: '/project-management.html', status: 'draft' },
  { title: 'MS Project', category: 'MS Project', description: '일정 작성·자원 배정·기준선의 학습 주제와 검증 원칙을 안내합니다.', path: '/microsoft-project.html', status: 'draft' },
  { title: '실전 AI', category: '실전 AI', description: '프롬프트·컨텍스트·RAG·에이전트를 프로젝트 업무에 적용하기 위한 분야 안내입니다.', path: '/generative-ai.html', status: 'draft' },
  { title: '테크', category: '테크', description: '전원·성능·작업 보존에 관한 문서와 확인된 검증 범위를 안내합니다.', path: '/pc-management/README.html', status: 'reviewed_with_limits' },
  { title: '고성능 전원 관리: 연속 작업과 배터리 보호', category: '테크', description: 'AC/DC 전원 정책, CPU·배터리 설정, 복원과 실제 동작 검증의 한계를 설명합니다.', path: '/pc-management/high-performance-power.html', status: 'reviewed_with_limits' }
]
const filtered = computed(() => entries.filter(entry => selected.value === '전체' || entry.category === selected.value))
</script>
<template>
  <div class="wiki-home">
    <header class="wiki-intro">
      <h1 id="page-title" class="knowledge-title">기업·공공기관 프로젝트 관리 실무 자료</h1>
      <p>공정표 작성, 사업 진도 보고와 AI 업무 적용에 참고할 교재·실무 해설을 확인하십시오.</p>
    </header>
    <nav class="category-filter" aria-label="분야별 문서 필터">
      <button v-for="category in categories" :key="category" :aria-pressed="selected === category" :class="{ selected: selected === category }" @click="selected = category">{{ category }}</button>
    </nav>
    <section class="document-list" aria-labelledby="documents-heading">
      <h2 id="documents-heading">분야별 문서</h2>
      <p class="sr-only" role="status" aria-live="polite">{{ selected }} 분야 문서 {{ filtered.length }}개</p>
      <article v-for="entry in filtered" :key="entry.path" class="document-row">
        <svg aria-hidden="true" class="document-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h6"/></svg>
        <div class="document-text">
          <h3><a :href="withBase(entry.path)">{{ entry.title }}</a></h3>
          <p>{{ entry.description }}</p>
        </div>
        <span class="document-category">{{ entry.category }}</span>
        <span class="document-status" :class="entry.status">{{ entry.status === 'published' ? '학습 교재' : entry.status === 'draft' ? '초안' : '검토·한계 명시' }}</span>
      </article>
    </section>
    <footer class="wiki-footer"><span>PMOffice 지식 공간</span><span>각 문서에서 출처와 검증 범위를 확인하실 수 있습니다.</span></footer>
  </div>
</template>
