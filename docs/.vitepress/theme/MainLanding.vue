<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { withBase } from 'vitepress'
import slides from './home-slides.json'
import './home-landing.css'

const hero = ref(null)
const current = ref(0)
const paused = ref(false)
const reduced = ref(false)
const visible = ref(true)
const inView = ref(true)
const failed = ref(new Set())
const elapsed = ref(0)
const motionKey = ref(0)
const available = computed(() => slides.filter((_, i) => !failed.value.has(i)))
const playing = computed(() => !paused.value && !reduced.value && visible.value && inView.value && available.value.length > 1)
const progress = computed(() => `${Math.min(100, elapsed.value / 60)}%`)
let interval, observer, motion, previousTime = 0

function preload() {
  const next = nextIndex(1)
  if (next !== current.value) {
    const image = new Image()
    image.src = withBase(slides[next].src)
  }
}
function nextIndex(direction) {
  for (let offset = 1; offset <= slides.length; offset++) {
    const index = (current.value + direction * offset + slides.length * 2) % slides.length
    if (!failed.value.has(index)) return index
  }
  return current.value
}
function select(index) {
  if (failed.value.has(index)) return
  current.value = index
  elapsed.value = 0
  motionKey.value++
  if (typeof window !== 'undefined') preload()
}
function step(direction) { select(nextIndex(direction)) }
function onError(index) {
  failed.value = new Set([...failed.value, index])
  if (index === current.value) step(1)
}
function toggle() {
  if (reduced.value) {
    reduced.value = false
    paused.value = false
  } else paused.value = !paused.value
}
function visibility() { visible.value = !document.hidden; previousTime = performance.now() }
function preference(event) { reduced.value = event.matches; elapsed.value = 0 }
function keyboard(event) {
  if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
  if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
}

onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  reduced.value = motion.matches
  motion.addEventListener('change', preference)
  visibility()
  document.addEventListener('visibilitychange', visibility)
  observer = new IntersectionObserver(([entry]) => { inView.value = entry.isIntersecting; previousTime = performance.now() }, { threshold: 0.05 })
  observer.observe(hero.value)
  preload()
  previousTime = performance.now()
  interval = window.setInterval(() => {
    const now = performance.now()
    const delta = Math.min(250, now - previousTime)
    previousTime = now
    if (!playing.value) return
    elapsed.value += delta
    if (elapsed.value >= 6000) step(1)
  }, 100)
})
onUnmounted(() => {
  clearInterval(interval)
  observer?.disconnect()
  motion?.removeEventListener('change', preference)
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <div class="pm-home">
    <section ref="hero" class="pm-hero" :class="{ 'is-playing': playing, 'is-reduced': reduced }" aria-labelledby="page-title" aria-roledescription="슬라이드 쇼" @keydown="keyboard">
      <div class="pm-hero-photos" aria-hidden="true">
        <div v-for="(slide, i) in slides" :key="i" class="pm-photo-layer" :class="{ 'is-active': current === i }">
          <img v-if="!failed.has(i)" :key="`${i}-${current === i ? motionKey : 'idle'}`" :src="withBase(slide.src)" :srcset="slide.srcset.map(s => `${withBase(s.src)} ${s.width}w`).join(', ')" sizes="100vw" alt="" :width="slide.width" :height="slide.height" :style="{ '--photo-position': slide.position, '--mobile-position': slide.mobilePosition }" :loading="i === 0 ? 'eager' : 'lazy'" :fetchpriority="i === 0 ? 'high' : 'auto'" @error="onError(i)">
        </div>
      </div>
      <div class="pm-hero-shade" aria-hidden="true"></div>
      <div class="pm-hero-grain" aria-hidden="true"></div>
      <div class="pm-hero-content">
        <p class="pm-hero-eyebrow pm-enter" style="--enter-delay:0ms"><span></span> 풍부하고 오랜 경험을 갖춘</p>
        <h1 id="page-title" class="pm-hero-title pm-enter" style="--enter-delay:120ms"><span>AI 시대 최고의</span><span class="pm-title-core">프로젝트 관리</span><span class="pm-title-last">교육 &amp; 컨설팅 전문 기업</span></h1>
        <div class="pm-hero-claim pm-enter" style="--enter-delay:260ms"><span>기업 프로젝트 관리 교육 및 컨설팅</span><strong>국내 최다 출강 경력</strong></div>
        <div class="pm-hero-description pm-enter" style="--enter-delay:400ms">
          <p><span>피엠오피스는…</span> <strong>1,000여 기업과 공공기관에게</strong><br class="pm-wide-break"> 철저하게 고객의 관점에서 실무적인 프로젝트 관리 역량 강화와<br class="pm-wide-break"> 최상의 맞춤형 프로젝트 관리 솔루션을 제공해 왔습니다.</p>
          <p class="pm-hero-promise">앞으로도 항상 최선을 다해 충실하게 지원하겠습니다.</p>
        </div>
      </div>
      <div class="pm-hero-bottom">
        <a class="pm-explore" href="#core-services"><span>주요 사업 분야</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6" stroke="currentColor" stroke-width="1.5"/></svg></a>
        <div class="pm-slide-controls" role="group" aria-label="배경 사진 슬라이드 쇼 조작">
          <span class="pm-slide-count" aria-live="off"><strong>{{ String(current + 1).padStart(2, '0') }}</strong><span>/ {{ String(slides.length).padStart(2, '0') }}</span></span>
          <span class="pm-slide-track" aria-hidden="true"><span :style="{ width: progress }"></span></span>
          <button type="button" aria-label="이전 사진" @click="step(-1)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 6-6 6 6 6" stroke="currentColor" stroke-width="1.5"/></svg></button>
          <button type="button" :aria-label="paused || reduced ? '슬라이드 쇼 재생' : '슬라이드 쇼 일시정지'" :aria-pressed="paused || reduced" @click="toggle"><svg v-if="paused || reduced" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z" fill="currentColor"/></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14" stroke="currentColor" stroke-width="2"/></svg></button>
          <button type="button" aria-label="다음 사진" @click="step(1)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 6 6 6-6 6" stroke="currentColor" stroke-width="1.5"/></svg></button>
        </div>
      </div>
      <span class="pm-visually-hidden" aria-live="polite" aria-atomic="true">{{ paused || reduced ? `${current + 1} / ${slides.length}. ${slides[current].alt}` : '' }}</span>
    </section>
    <CoreServices title="주요 사업 분야" :show-intro="false" home />
  </div>
</template>
