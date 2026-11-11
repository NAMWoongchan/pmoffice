<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { workPrompt } from './admin-ai-work.js'
import { client } from './pms-client.js'

const props = defineProps({
  itemId: { type: String, required: true },
  draft: { type: Object, required: true },
  archived: Boolean,
  disabled: Boolean,
})
const emit = defineEmits(['dirty', 'access-revoked'])
const drafts = ref([]), saved = ref([]), busy = ref(false), loaded = ref(false)
const message = ref(''), error = ref('')
const entries = computed(() => [...drafts.value, ...saved.value].sort((a, b) =>
  Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id)))
const promptDate = value => new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  second: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
}).format(new Date(value))
const dirty = computed(() => drafts.value.length > 0
  || saved.value.some(item => item.body !== item.savedBody || item.memo !== item.savedMemo))
watch(dirty, value => emit('dirty', value), { flush: 'sync' })

let autoSaveTimer
let saving = Promise.resolve(true)

const editable = item => ({ ...item, savedBody: item.body, savedMemo: item.memo })

async function request(action, args = {}) {
  const { data, error: failure } = await client().rpc('admin_ai_work_prompts', {
    p_action: action, p_item_id: props.itemId, ...args,
  })
  if (failure) throw failure
  return data
}

async function run(task) {
  if (busy.value) return false
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await task()
    return true
  } catch (failure) {
    if (failure.code === '42501') emit('access-revoked')
    else error.value = failure.code === '40001'
      ? '다른 곳에서 요청문이 변경되었습니다. 작성 내용을 복사한 뒤 게시글을 다시 열어 주세요.'
      : '요청문을 불러오거나 저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'
    return false
  } finally {
    busy.value = false
  }
}

function load() {
  return run(async () => {
    saved.value = (await request('list')).map(editable)
    loaded.value = true
  })
}

function generate() {
  const item = {
    id: crypto.randomUUID(), body: workPrompt(props.draft), memo: '', created_at: new Date().toISOString(),
  }
  drafts.value.unshift(item)
  save(item)
}

function save(item) {
  clearTimeout(autoSaveTimer)
  if (busy.value) return saving
  saving = run(async () => {
    const result = await request('save', {
      p_id: item.id, p_version: item.version ?? null, p_body: item.body, p_memo: item.memo, p_created_at: item.created_at,
    })
    const existing = saved.value.findIndex(row => row.id === item.id)
    if (existing >= 0) saved.value.splice(existing, 1, editable(result))
    else saved.value.unshift(editable(result))
    drafts.value = drafts.value.filter(row => row.id !== item.id)
    message.value = '요청문과 메모를 저장했습니다.'
  })
  return saving
}

async function flush() {
  clearTimeout(autoSaveTimer)
  await saving
  const changed = [...drafts.value, ...saved.value.filter(item =>
    item.body !== item.savedBody || item.memo !== item.savedMemo)]
  for (const item of changed) {
    if (!item.body.trim()) {
      error.value = '요청문 본문을 입력해 주세요.'
      return false
    }
    if (!await save(item)) return false
  }
  return !dirty.value
}

function scheduleSave() {
  clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(flush, 800)
}
defineExpose({ flush })

async function copy(item) {
  error.value = ''
  message.value = ''
  try {
    await navigator.clipboard.writeText(item.body)
    message.value = '개발 계획 요청문을 복사했습니다.'
  } catch {
    error.value = '자동 복사가 되지 않았습니다. 요청문을 선택해 직접 복사해 주세요.'
  }
}

onMounted(load)
onUnmounted(() => clearTimeout(autoSaveTimer))
</script>

<template>
  <section class="work-prompt" aria-label="개발 계획 요청문" :aria-busy="busy">
    <header class="prompt-actions">
      <h2>개발 계획 요청문</h2>
      <button v-if="!archived" type="button" :disabled="disabled || busy || !loaded || !draft.title.trim() || !draft.problem.trim()" @click="generate">
        요청문 만들기
      </button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="busy" role="status">처리 중…</p>
    <button v-if="!loaded && !busy" type="button" @click="load">다시 불러오기</button>
    <p v-if="loaded && !drafts.length && !saved.length">저장된 요청문이 없습니다.</p>
    <article v-for="(item, index) in entries" :key="item.id" class="prompt-entry">
      <header class="prompt-actions">
        <h3 :id="'prompt-heading-' + item.id">요청문 {{ entries.length - index }} · <time :datetime="item.created_at">{{ promptDate(item.created_at) }} (KST)</time></h3>
        <span v-if="item.version == null">미저장</span>
      </header>
      <label><span class="sr-only">요청문 본문</span>
        <textarea v-model="item.body" @input="scheduleSave" :aria-labelledby="'prompt-heading-' + item.id" rows="8" maxlength="160000" :readonly="archived || disabled || busy"></textarea>
      </label>
      <label>사용자 메모<textarea placeholder="이 요청문에 대한 메모를 입력하세요." v-model="item.memo" @input="scheduleSave" rows="3" maxlength="20000" :readonly="archived || disabled || busy"></textarea></label>
      <div class="prompt-actions">
        <button type="button" :disabled="!item.body.trim()" @click="copy(item)">요청문 복사</button>
        <button v-if="!archived" type="button" :disabled="disabled || busy || !item.body.trim()" @click="save(item)">요청문 저장</button>
        <button v-if="item.version == null" type="button" :disabled="disabled || busy" @click="drafts = drafts.filter(row => row.id !== item.id)">초안 취소</button>
      </div>
    </article>
  </section>
</template>

<style scoped>
.work-prompt { border-top: 1px solid var(--vp-c-divider); margin-top: 1rem; padding-top: 1rem; }
h2 { font-size: 1.1rem; font-weight: 700; }
h3 { font-size: .95rem; font-weight: 650; }
.prompt-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .6rem; }
.prompt-entry { display: grid; gap: .65rem; padding: .8rem; margin-top: .8rem; border: 1px solid var(--vp-c-divider); border-radius: .45rem; }
label { display: grid; gap: .25rem; font-size: .9rem; font-weight: 600; }
textarea, button { border: 1px solid var(--vp-c-divider); border-radius: .4rem; padding: .45rem .65rem; }
textarea { width: 100%; min-width: 0; resize: vertical; background: var(--vp-c-bg); font-weight: 400; }
button { background: var(--vp-c-bg-soft); }
button:disabled { opacity: .55; }
:where(button, textarea):focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
[role="alert"] { color: var(--vp-c-danger-1); }
</style>
