<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { withBase } from 'vitepress'
import slides from './ai-education-slides.json'
import './ai-education-slideshow.css'

const hero = ref(null)
const requested = ref(new Set([0]))
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
  requested.value = new Set([...requested.value, current.value, nextIndex(1)])
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
  requested.value = new Set([...requested.value, index])
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
  // An SSR image can fail before Vue attaches its error listener.
  for (const image of hero.value.querySelectorAll('img[data-slide-index]')) {
    if (image.complete && image.naturalWidth === 0) onError(Number(image.dataset.slideIndex))
  }
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
  <section ref="hero" class="aa-slideshow" :class="{ 'is-reduced': reduced }" aria-labelledby="page-title" aria-roledescription="슬라이드 쇼" @keydown="keyboard">
    <h1 id="page-title" class="aa-slide-sr">기업·공공기관 맞춤형 AI 교육</h1>
    <div class="aa-slide-images">
      <div v-for="(slide,i) in slides" :key="slide.id" class="aa-slide-layer" :class="{'is-active':current===i}" :aria-hidden="current!==i">
        <img v-if="requested.has(i) && !failed.has(i)" :data-slide-index="i" :src="withBase(slide.src)" :srcset="slide.srcset.map(s=>withBase(s.src)+' '+s.width+'w').join(', ')" sizes="100vw" :alt="slide.alt" :width="slide.width" :height="slide.height" :style="{'--slide-position':slide.position,'--slide-mobile-position':slide.mobilePosition}" :fetchpriority="i===0?'high':'auto'" decoding="async" @error="onError(i)">
      </div>
    </div>
    <p v-if="!available.length" class="aa-slide-error" role="status">이미지를 불러오지 못했습니다. 아래에서 교육 과정을 확인하십시오.</p>
    <div class="aa-slide-bottom">
      <a class="aa-slide-explore" href="#courses">AI 교육 과정 살펴보기 <span aria-hidden="true">↓</span></a>
      <div class="aa-slide-controls" role="group" aria-label="AI 교육 슬라이드 쇼 조작">
        <span class="aa-slide-count"><strong>{{String(current+1).padStart(2,'0')}}</strong><span>/ {{String(slides.length).padStart(2,'0')}}</span></span>
        <span class="aa-slide-track" aria-hidden="true"><span :style="{width:progress}"></span></span>
        <button type="button" aria-label="이전 슬라이드" :disabled="available.length<2" @click="step(-1)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 6-6 6 6 6" stroke="currentColor" stroke-width="1.5"/></svg></button>
        <button type="button" :aria-label="paused||reduced?'슬라이드 쇼 재생':'슬라이드 쇼 일시정지'" :aria-pressed="paused||reduced" :disabled="available.length<2" @click="toggle"><svg v-if="paused||reduced" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z" fill="currentColor"/></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14" stroke="currentColor" stroke-width="2"/></svg></button>
        <button type="button" aria-label="다음 슬라이드" :disabled="available.length<2" @click="step(1)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 6 6 6-6 6" stroke="currentColor" stroke-width="1.5"/></svg></button>
      </div>
    </div>
    <span class="aa-slide-sr" aria-live="polite" aria-atomic="true">{{paused||reduced ? (current+1)+' / '+slides.length+'. '+slides[current].alt:''}}</span>
  </section>
</template>
