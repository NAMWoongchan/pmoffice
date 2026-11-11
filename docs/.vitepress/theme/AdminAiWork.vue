<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { adminDate } from './admin-navigation.js'
import { matchesWork, workDraft, workPriorities, workPrompt, workStatuses } from './admin-ai-work.js'
import { client } from './pms-client.js'

const emit = defineEmits(['access-revoked'])
const items = ref([]), selected = ref(null), draft = ref(null), prompt = ref('')
const query = ref(''), status = ref(''), priority = ref(''), archived = ref(false)
const busy = ref(false), error = ref(''), notice = ref(''), conflict = ref(false)
const visibleItems = computed(() => items.value.filter(item => matchesWork(item, query.value, status.value, priority.value)))
const dirty = computed(() => draft.value && JSON.stringify(draft.value) !== JSON.stringify(workDraft(selected.value ?? {})))
const optionalFields = {
  expected_result: '기대 결과', references_text: '참고 링크', constraints_text: '제약 조건',
  acceptance_criteria: '완료 기준', development_plan: '검토한 개발 계획', next_step: '다음 조치',
}
let disposed = false
let accessTimer

async function rpc(action, args = {}) {
  const { data, error: failure } = await client().rpc('admin_ai_work', { p_action: action, ...args })
  if (failure) throw failure
  return data
}

async function run(task) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await task()
  } catch (failure) {
    if (disposed) return
    if (failure.code === '42501') {
      emit('access-revoked')
    } else if (failure.code === '40001') {
      conflict.value = true
      error.value = '다른 곳에서 먼저 수정했습니다. 작성 내용이 남아 있으니 필요한 내용을 복사한 뒤 최신 게시글을 다시 여세요.'
    } else {
      error.value = failure.message === 'missing-item'
        ? '게시글을 찾지 못했습니다.'
        : '요청을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'
    }
  } finally {
    busy.value = false
  }
}

async function loadList(view = archived.value) {
  const result = await rpc('list', { p_values: { archived: view } })
  if (disposed) return
  archived.value = view
  items.value = result
}

function showItem(item, editing = true, keepPrompt = false) {
  if (disposed) return
  selected.value = item
  draft.value = editing ? workDraft(item ?? {}) : null
  if (!keepPrompt) prompt.value = ''
  conflict.value = false
  const hash = item ? '#ai-work?item=' + item.id : '#ai-work'
  window.history.replaceState(window.history.state, '', hash)
}

function canLeave() {
  return !dirty.value || window.confirm('저장하지 않은 수정 내용을 버리시겠습니까?')
}

async function getItem(id) {
  const item = await rpc('get', { p_id: id })
  if (!item) throw Error('missing-item')
  return item
}

function openItem(id) {
  if (canLeave()) run(async () => showItem(await getItem(id)))
}

function newItem() {
  if (canLeave()) {
    error.value = ''
    notice.value = ''
    showItem(null)
  }
}

function switchList(view) {
  if (canLeave()) run(async () => {
    await loadList(view)
    showItem(null, false)
  })
}

function save() {
  if (!draft.value.title.trim() || !draft.value.problem.trim()) {
    error.value = '제목과 해결하려는 문제를 입력해 주세요.'
    return
  }
  run(async () => {
    const item = await rpc('save', {
      p_id: selected.value?.id ?? null, p_version: selected.value?.version ?? null,
      p_values: { ...draft.value },
    })
    showItem(item, true, true)
    notice.value = '게시글을 저장했습니다.'
    await loadList(item.archived)
  })
}

function toggleArchive() {
  const item = selected.value
  if (!canLeave() || (!item.archived && !window.confirm('게시글을 보관하시겠습니까?'))) return
  run(async () => {
    const updated = await rpc(item.archived ? 'restore' : 'archive', {
      p_id: item.id, p_version: item.version,
    })
    showItem(updated)
    notice.value = updated.archived ? '게시글을 보관했습니다.' : '게시글을 복원했습니다.'
    await loadList(updated.archived)
  })
}

function generatePrompt() {
  if (prompt.value && !window.confirm('작성 중인 요청문을 새로 만들겠습니까?')) return
  prompt.value = workPrompt(draft.value)
}

async function copyPrompt() {
  error.value = ''
  notice.value = ''
  try {
    await navigator.clipboard.writeText(prompt.value)
    notice.value = '개발 계획 요청문을 복사했습니다.'
  } catch {
    error.value = '자동 복사가 되지 않았습니다. 요청문을 선택해 직접 복사해 주세요.'
  }
}

function eventLabel(event) {
  if (event.event_type === 'status') {
    return workStatuses[event.previous_status] + ' → ' + workStatuses[event.status]
  }
  return { created: '게시글 등록', archived: '보관', restored: '복원' }[event.event_type]
}

async function checkAccess() {
  try {
    const { data, error: failure } = await client().rpc('is_admin')
    if (!disposed && !failure && !data) emit('access-revoked')
  } catch {
    // A connection failure leaves edits available for retry.
  }
}

onMounted(() => {
  run(async () => {
    const id = new URLSearchParams(location.hash.split('?')[1]).get('item')
    const item = id && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ? await getItem(id) : null
    await loadList(item?.archived)
    if (item) showItem(item)
  })
  accessTimer = window.setInterval(checkAccess, 30000)
  window.addEventListener('focus', checkAccess)
})

onUnmounted(() => {
  disposed = true
  window.clearInterval(accessTimer)
  window.removeEventListener('focus', checkAccess)
})
</script>

<template>
  <main class="ai-work" :aria-busy="busy">
    <header class="work-header">
      <h1>AI 작업 관리</h1>
      <button type="button" class="primary" :disabled="busy" @click="newItem">새 아이디어</button>
    </header>
    <p v-if="error" role="alert" class="work-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="busy" role="status">처리 중…</p>

    <section class="work-list" aria-label="게시글 목록">
      <div class="work-actions">
        <button type="button" :aria-pressed="!archived" :disabled="busy" @click="switchList(false)">진행 목록</button>
        <button type="button" :aria-pressed="archived" :disabled="busy" @click="switchList(true)">보관 목록</button>
        <button type="button" :disabled="busy" @click="run(() => loadList())">목록 새로고침</button>
      </div>
      <div class="work-filters">
        <label>검색<input v-model="query" type="search" placeholder="제목·본문 검색"></label>
        <label>상태<select v-model="status"><option value="">전체</option>
          <option v-for="(label, key) in workStatuses" :key="key" :value="key">{{ label }}</option>
        </select></label>
        <label>우선순위<select v-model="priority"><option value="">전체</option>
          <option v-for="(label, key) in workPriorities" :key="key" :value="key">{{ label }}</option>
        </select></label>
      </div>
      <p v-if="!busy && !visibleItems.length">표시할 게시글이 없습니다.</p>
      <ul v-if="visibleItems.length" class="work-items">
        <li v-for="item in visibleItems" :key="item.id">
          <button type="button" :aria-pressed="selected?.id === item.id" :disabled="busy" @click="openItem(item.id)">
            <strong>{{ item.title }}</strong>
            <span>{{ workStatuses[item.status] }} · 우선순위 {{ workPriorities[item.priority] }} · {{ adminDate(item.updated_at) }}</span>
          </button>
        </li>
      </ul>
    </section>

    <div v-if="draft" class="work-detail" :class="{ 'has-summary': selected }">
      <section class="work-panel" aria-label="게시글 본문">
        <h2>{{ selected ? (selected.archived ? '보관된 게시글' : '게시글 편집') : '새 아이디어' }}</h2>
        <form @submit.prevent="save">
          <fieldset :disabled="busy || selected?.archived">
            <label>제목<input v-model="draft.title" maxlength="200" required></label>
            <label>해결하려는 문제<textarea v-model="draft.problem" maxlength="20000" rows="4" required></textarea></label>
            <div class="work-filters">
              <label>상태<select v-model="draft.status">
                <option v-for="(label, key) in workStatuses" :key="key" :value="key">{{ label }}</option>
              </select></label>
              <label>우선순위<select v-model="draft.priority">
                <option v-for="(label, key) in workPriorities" :key="key" :value="key">{{ label }}</option>
              </select></label>
            </div>
            <label v-for="(label, key) in optionalFields" :key="key">
              {{ label }}<textarea v-model="draft[key]" maxlength="20000" rows="3"></textarea>
            </label>
          </fieldset>
          <div class="work-actions">
            <button v-if="!selected?.archived" type="submit" class="primary" :disabled="busy || conflict">저장</button>
            <button v-if="conflict && selected" type="button" :disabled="busy" @click="openItem(selected.id)">최신 게시글 열기</button>
            <button v-if="selected" type="button" :disabled="busy || conflict" @click="toggleArchive">
              {{ selected.archived ? '복원' : '보관' }}
            </button>
          </div>
        </form>

        <section class="work-prompt" aria-label="개발 계획 요청문">
          <h2>개발 계획 요청문</h2>
          <div class="work-actions">
            <button type="button" :disabled="busy || !draft.title.trim() || !draft.problem.trim()" @click="generatePrompt">요청문 만들기</button>
            <button v-if="prompt" type="button" :disabled="busy || !prompt.trim()" @click="copyPrompt">요청문 복사</button>
          </div>
          <label v-if="prompt" class="prompt-editor">
            ChatGPT·Copilot에 붙여넣을 요청문
            <textarea v-model="prompt" rows="10"></textarea>
          </label>
        </section>
      </section>

      <aside v-if="selected" class="work-panel work-summary" aria-label="게시글 요약 및 이력">
        <section>
          <h2>요약 정보</h2>
          <dl>
            <dt>제목</dt><dd>{{ selected.title }}</dd>
            <dt>현재 상태</dt><dd>{{ workStatuses[selected.status] }}{{ selected.archived ? ' · 보관' : '' }}</dd>
            <dt>우선순위</dt><dd>{{ workPriorities[selected.priority] }}</dd>
            <dt>다음 조치</dt><dd>{{ selected.next_step || '미등록' }}</dd>
          </dl>
        </section>
        <section><h2>게시글 생성일</h2><time :datetime="selected.created_at">{{ adminDate(selected.created_at) }} (KST)</time></section>
        <section>
          <h2>업데이트 현황</h2>
          <dl>
            <dt>마지막 수정</dt><dd><time :datetime="selected.updated_at">{{ adminDate(selected.updated_at) }} (KST)</time></dd>
            <dt>수정자</dt><dd>{{ selected.updated_by_name }}</dd>
          </dl>
          <h3>상태 변경 이력</h3>
          <ol>
            <li v-for="event in selected.events" :key="event.version">
              <strong>{{ eventLabel(event) }}</strong>
              <small><time :datetime="event.occurred_at">{{ adminDate(event.occurred_at) }} (KST)</time> · {{ event.actor_name }}</small>
            </li>
          </ol>
        </section>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.ai-work { display: grid; gap: 1rem; min-width: 0; padding: 1rem .65rem 2rem; }
.work-header, .work-actions, .work-filters { display: flex; align-items: center; flex-wrap: wrap; gap: .65rem; }
.work-header { justify-content: space-between; }
h1 { font-size: 1.85rem; font-weight: 750; line-height: 1.2; }
h2 { font-size: 1.1rem; font-weight: 700; margin-bottom: .65rem; }
h3 { font-size: .95rem; font-weight: 700; margin: .9rem 0 .5rem; }
.work-panel, .work-list { background: var(--vp-c-bg); border: 1px solid var(--vp-c-divider); border-radius: .65rem; padding: 1rem; min-width: 0; }
.work-filters { margin: .65rem 0; align-items: end; }
.work-filters > label { flex: 1 1 8rem; }
label { display: grid; gap: .28rem; font-size: .9rem; font-weight: 600; margin-bottom: .7rem; }
input, select, textarea, button { border: 1px solid var(--vp-c-divider); border-radius: .4rem; padding: .45rem .65rem; }
input, select, textarea { width: 100%; min-width: 0; background: var(--vp-c-bg); color: var(--vp-c-text-1); font-weight: 400; }
textarea { resize: vertical; }
button { background: var(--vp-c-bg-soft); }
button[aria-pressed="true"] { border-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1); }
button.primary { background: var(--vp-c-brand-3); border-color: var(--vp-c-brand-3); color: white; }
button:disabled { opacity: .55; cursor: default; }
:where(button, input, select, textarea):focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px; }
.work-items { display: grid; gap: .35rem; max-height: 22rem; overflow-y: auto; padding: .2rem; }
.work-items button { text-align: left; display: flex; justify-content: space-between; flex-wrap: wrap; gap: .25rem .8rem; width: 100%; overflow-wrap: anywhere; }
.work-items span, small { color: var(--vp-c-text-2); font-size: .8rem; }
.work-detail { display: grid; gap: .85rem; align-items: start; min-width: 0; }
@media (min-width: 1000px) { .work-detail.has-summary { grid-template-columns: minmax(0, 1fr) minmax(14rem, 30%); } }
.work-summary { overflow-wrap: anywhere; }
.work-summary section + section, .work-prompt { border-top: 1px solid var(--vp-c-divider); margin-top: 1rem; padding-top: 1rem; }
dt { color: var(--vp-c-text-2); font-size: .8rem; }
dd { margin: 0 0 .5rem; white-space: pre-wrap; }
small { display: block; }
.work-summary li { margin-bottom: .5rem; }
.prompt-editor { margin-top: .75rem; }
.work-error { color: var(--vp-c-danger-1); }
</style>
