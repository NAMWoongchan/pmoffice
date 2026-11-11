<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { adminDate } from './admin-navigation.js'
import { fieldKey, matchesWork, ratingLabel, workDraft, workRating, workRatings, workStatuses } from './admin-ai-work.js'
import AdminAiWorkPrompts from './AdminAiWorkPrompts.vue'
import { client } from './pms-client.js'

const emit = defineEmits(['access-revoked'])
const items = ref([]), selected = ref(null), draft = ref(null), promptDirty = ref(false)
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
    if (routePending) {
      routePending = false
      syncWorkRoute()
    }
  }
}

async function loadList(view = archived.value) {
  const result = await rpc('list', { p_values: { archived: view } })
  if (disposed) return
  archived.value = view
  items.value = result
}

const listRoute = '#ai-work'
const newRoute = '#ai-work?new=1'
const itemRoute = id => listRoute + '?item=' + encodeURIComponent(id)
const route = ref(listRoute)
const fieldCatalog = ref([]), fieldInput = ref(''), archiveConfirmation = ref(false)
const fieldChoices = computed(() => [...new Map(
  [...fieldCatalog.value, ...(draft.value?.fields ?? [])].map(label => [fieldKey(label), label])
).values()])
let routePending = false

function showItem(item) {
  if (disposed) return
  selected.value = item
  draft.value = workDraft(item ?? {})
  fieldInput.value = ''
  archiveConfirmation.value = false
  conflict.value = false
}

function canLeave() {
  return (!dirty.value && !promptDirty.value) || window.confirm('저장하지 않은 수정 내용을 버리시겠습니까?')
}

async function getItem(id) {
  const item = await rpc('get', { p_id: id })
  if (!item) throw Error('missing-item')
  return item
}

function navigate(hash) {
  if (busy.value || hash === route.value) return
  window.history.pushState({ ...window.history.state, aiWorkFromList: route.value === listRoute }, '', hash)
  syncWorkRoute()
}

function returnToList() {
  if (busy.value) return
  if (window.history.state?.aiWorkFromList) window.history.back()
  else {
    window.history.replaceState(window.history.state, '', listRoute)
    syncWorkRoute()
  }
}

function syncWorkRoute() {
  if (disposed || !location.hash.startsWith(listRoute)) return
  if (busy.value) {
    routePending = true
    return
  }

  const params = new URLSearchParams(location.hash.split('?')[1])
  const id = params.get('item')
  const next = id ? itemRoute(id) : params.get('new') === '1' ? newRoute : listRoute
  if (next !== route.value && !canLeave()) {
    window.history.pushState(window.history.state, '', route.value)
    return
  }

  if (next === route.value && (draft.value || listLoaded)) return
  route.value = next
  selected.value = null
  draft.value = null
  promptDirty.value = false
  archiveConfirmation.value = false
  run(async () => {
    if (next === listRoute) {
      await loadList()
      listLoaded = true
      return
    }

    listLoaded = false
    if (id && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) throw Error('missing-item')
    const [item, labels] = await Promise.all([id ? getItem(id) : null, rpc('fields')])
    if (disposed || location.hash !== next) return
    fieldCatalog.value = labels
    showItem(item)
  })
}
let listLoaded = false

function reloadItem() {
  if (canLeave()) run(async () => showItem(await getItem(selected.value.id)))
}

function addField() {
  const label = fieldInput.value.trim()
  if (!label) return
  const known = fieldChoices.value.find(field => fieldKey(field) === fieldKey(label)) ?? label
  if (!draft.value.fields.includes(known)) {
    if (draft.value.fields.length >= 50) {
      error.value = '분야는 최대 50개까지 선택할 수 있습니다.'
      return
    }
    draft.value.fields.push(known)
  }
  fieldInput.value = ''
  error.value = ''
}

function save() {
  if (!draft.value.title.trim() || !draft.value.problem.trim()) {
    error.value = '제목과 해결하려는 문제를 입력해 주세요.'
    return
  }
  if (draft.value.fields.length > 50) {
    error.value = '분야는 최대 50개까지 선택할 수 있습니다.'
    return
  }
  run(async () => {
    const item = await rpc('save', {
      p_id: selected.value?.id ?? null, p_version: selected.value?.version ?? null,
      p_values: { ...draft.value },
    })
    if (disposed || location.hash !== route.value) return
    const hash = itemRoute(item.id)
    if (hash !== route.value) window.history.replaceState(window.history.state, '', hash)
    route.value = hash
    showItem(item)
    fieldCatalog.value = [...new Map([...fieldCatalog.value, ...item.fields].map(label => [fieldKey(label), label])).values()]
    notice.value = '게시글을 저장했습니다.'
  })
}

function toggleArchive() {
  const item = selected.value
  if (!item.archived && !archiveConfirmation.value) {
    if (canLeave()) archiveConfirmation.value = true
    return
  }
  run(async () => {
    const updated = await rpc(item.archived ? 'restore' : 'archive', {
      p_id: item.id, p_version: item.version,
    })
    if (disposed || location.hash !== route.value) return
    showItem(updated)
    notice.value = updated.archived ? '게시글을 보관했습니다.' : '게시글을 복원했습니다.'
  })
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
  syncWorkRoute()
  window.addEventListener('hashchange', syncWorkRoute)
  window.addEventListener('popstate', syncWorkRoute)
  accessTimer = window.setInterval(checkAccess, 30000)
  window.addEventListener('focus', checkAccess)
})

onUnmounted(() => {
  disposed = true
  window.clearInterval(accessTimer)
  window.removeEventListener('focus', checkAccess)
  window.removeEventListener('hashchange', syncWorkRoute)
  window.removeEventListener('popstate', syncWorkRoute)
})
</script>

<template>
  <main class="ai-work" :aria-busy="busy">
    <header class="work-header">
      <h1>AI 작업 관리</h1>
      <button v-if="route === listRoute" type="button" class="primary" :disabled="busy" @click="navigate(newRoute)">새 아이디어</button>
      <button v-else type="button" :disabled="busy" @click="returnToList">목록으로</button>
    </header>
    <p v-if="error" role="alert" class="work-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="busy" role="status">처리 중…</p>

    <section v-if="route === listRoute" class="work-list" aria-label="게시글 목록">
      <div class="work-actions">
        <button type="button" :aria-pressed="!archived" :disabled="busy" @click="run(() => loadList(false))">진행 목록</button>
        <button type="button" :aria-pressed="archived" :disabled="busy" @click="run(() => loadList(true))">보관 목록</button>
        <button type="button" :disabled="busy" @click="run(() => loadList())">목록 새로고침</button>
      </div>
      <div class="work-filters">
        <label>검색<input v-model="query" type="search" placeholder="제목·본문 검색"></label>
        <label>상태<select v-model="status"><option value="">전체</option>
          <option v-for="(label, key) in workStatuses" :key="key" :value="key">{{ label }}</option>
        </select></label>
        <label>우선순위<select v-model="priority"><option value="">전체</option>
          <option v-for="rating in workRatings" :key="rating" :value="rating">{{ ratingLabel(rating) }}</option>
        </select></label>
      </div>
      <p v-if="!busy && !visibleItems.length">표시할 게시글이 없습니다.</p>
      <div class="work-table" role="region" aria-label="게시글 표" tabindex="0">
        <table>
          <thead><tr>
            <th scope="col">제목</th><th scope="col">분야</th><th scope="col">상태</th>
            <th scope="col">우선순위</th><th scope="col">생성일시</th>
          </tr></thead>
          <tbody>
            <tr v-for="item in visibleItems" :key="item.id">
              <td><a :href="itemRoute(item.id)" @click.exact.prevent="navigate(itemRoute(item.id))">{{ item.title }}</a></td>
              <td>{{ item.fields?.join(', ') || '—' }}</td>
              <td>{{ workStatuses[item.status] }}</td>
              <td>{{ ratingLabel(workRating(item)) }}</td>
              <td><time :datetime="item.created_at">{{ adminDate(item.created_at) }} (KST)</time></td>
            </tr>
          </tbody>
        </table>
      </div>
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
              <label>우선순위<select v-model="draft.priority_rating">
                <option v-for="rating in workRatings" :key="rating" :value="rating">{{ ratingLabel(rating) }}</option>
              </select></label>
            </div>
            <fieldset class="work-fields">
              <legend>분야</legend>
              <div v-if="fieldChoices.length" class="field-choices">
                <label v-for="field in fieldChoices" :key="fieldKey(field)">
                  <input v-model="draft.fields" type="checkbox" :value="field">
                  {{ field }}
                </label>
              </div>
              <div class="field-add">
                <label>새 분야<input v-model="fieldInput" maxlength="80" @keydown.enter.prevent="addField"></label>
                <button type="button" :disabled="!fieldInput.trim()" @click="addField">추가</button>
              </div>
            </fieldset>
            <label v-for="(label, key) in optionalFields" :key="key">
              {{ label }}<textarea v-model="draft[key]" maxlength="20000" rows="3"></textarea>
            </label>
          </fieldset>
          <div class="work-actions">
            <button v-if="!selected?.archived" type="submit" class="primary" :disabled="busy || conflict">저장</button>
            <button v-if="conflict && selected" type="button" :disabled="busy" @click="reloadItem">최신 게시글 열기</button>
            <button v-if="selected && !archiveConfirmation" type="button" :disabled="busy || conflict" @click="toggleArchive">
              {{ selected.archived ? '복원' : '보관' }}
            </button>
            <div v-if="archiveConfirmation" class="work-actions" role="group" aria-label="보관 확인">
              <span>게시글을 보관하시겠습니까?</span>
              <button type="button" :disabled="busy || conflict" @click="toggleArchive">보관 확인</button>
              <button type="button" :disabled="busy" @click="archiveConfirmation = false">취소</button>
            </div>
          </div>
        </form>

        <AdminAiWorkPrompts
          v-if="selected" :key="selected.id" :item-id="selected.id" :draft="draft"
          :archived="selected.archived" :disabled="busy"
          @dirty="promptDirty = $event" @access-revoked="emit('access-revoked')"
        />
        <p v-else>게시글을 저장하면 개발 계획 요청문을 만들고 저장할 수 있습니다.</p>
      </section>

      <aside v-if="selected" class="work-panel work-summary" aria-label="게시글 요약 및 이력">
        <section>
          <h2>요약 정보</h2>
          <dl>
            <dt>제목</dt><dd>{{ selected.title }}</dd>
            <dt>현재 상태</dt><dd>{{ workStatuses[selected.status] }}{{ selected.archived ? ' · 보관' : '' }}</dd>
            <dt>분야</dt><dd>{{ selected.fields?.join(', ') || '—' }}</dd>
            <dt>우선순위</dt><dd>{{ ratingLabel(workRating(selected)) }}</dd>
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
.work-table { overflow-x: auto; max-width: 100%; }
.work-table table { border-collapse: collapse; width: 100%; min-width: 36rem; text-align: left; }
.work-table th, .work-table td { padding: .65rem .55rem; border-bottom: 1px solid var(--vp-c-divider); }
.work-table th { white-space: nowrap; background: var(--vp-c-bg-soft); }
.work-table td:nth-child(n+3) { white-space: nowrap; }
.work-table td:first-child { width: 34%; }
.work-table td:nth-child(-n+2) { overflow-wrap: anywhere; }
.work-table a { color: var(--vp-c-brand-1); font-weight: 650; text-decoration: underline; text-underline-offset: .15em; }
.work-table a:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px; }
.work-fields { margin: .4rem 0 .75rem; border: 1px solid var(--vp-c-divider); border-radius: .4rem; padding: .5rem .7rem; }
.work-fields legend { padding: 0 .3rem; font-size: .9rem; font-weight: 650; }
.field-choices, .field-add { display: flex; flex-wrap: wrap; gap: .4rem .8rem; }
.field-choices label { display: flex; align-items: baseline; gap: .4rem; overflow-wrap: anywhere; }
.field-choices input { width: auto; }
.field-add { align-items: end; }
.field-add label { flex: 1 1 12rem; margin: 0; }
small { color: var(--vp-c-text-2); font-size: .8rem; }
.work-detail { display: grid; gap: .85rem; align-items: start; min-width: 0; }
@media (min-width: 1000px) { .work-detail.has-summary { grid-template-columns: minmax(0, 1fr) minmax(14rem, 30%); } }
.work-summary { overflow-wrap: anywhere; }
.work-summary section + section { border-top: 1px solid var(--vp-c-divider); margin-top: 1rem; padding-top: 1rem; }
dt { color: var(--vp-c-text-2); font-size: .8rem; }
dd { margin: 0 0 .5rem; white-space: pre-wrap; }
small { display: block; }
.work-summary li { margin-bottom: .5rem; }
.work-error { color: var(--vp-c-danger-1); }
</style>
