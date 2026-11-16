<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { call, client } from './pms-client.js'
import NexpharmProjectEditor from './NexpharmProjectEditor.vue'
import NexpharmActivity from './NexpharmActivity.vue'
import { cleanComment, projectMonths, workbookRange, workbookRequest } from './nexpharm-center.js'
import './nexpharm-center.css'

const center = '/pms/nexpharm/'
const selected = ref('')
const board = ref(false)
const drawer = ref(null)
const rangeBySlug = ref({})
const timeline = computed(() => projectMonths(rangeBySlug.value))
const file = ref(null)
const fileInput = ref(null)
const registering = ref(false)
let rangeController, detailTrigger
const detail = ref(null)
const canEdit = ref(false)
const editing = ref(false)
const savedNotice = ref('')
const catalog = ref(null)
const session = ref(null)
const loading = ref(true)
const busy = ref(false)
const title = ref('')
const error = ref('')
let epoch = 0
let timer, subscription, refreshTimer

const urlFor = slug => center + '?project=' + encodeURIComponent(slug)
const boardUrl = center + '?view=board'
const address = computed(() => selected.value ? urlFor(selected.value) : board.value ? boardUrl : center)
function readAddress() {
  const params = new URLSearchParams(location.search)
  const slug = params.get('project') || ''
  selected.value = /^nexpharm-[0-9a-f]{12}$/.test(slug) ? slug : ''
  board.value = !selected.value && params.get('view') === 'board'
}
function onNavigate(event, href) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  if (href === address.value) return
  history.pushState(history.state, '', href)
  addressChanged()
}
function addressChanged() {
  readAddress()
  canEdit.value = false
  editing.value = false
  savedNotice.value = ''
  detail.value = null
  catalog.value = null
  drawer.value = null
  rangeController?.abort()
  load()
}
async function load(quiet = false) {
  const id = ++epoch
  if (quiet !== true) loading.value = true
  try {
    const { data, error: authError } = await client().auth.getSession()
    if (authError) throw authError
    if (id !== epoch) return
    session.value = data.session
    const slug = selected.value
    const result = session.value ? await (slug
      ? call('nexpharm_access', { p_slug: slug })
      : call('nexpharm_catalog')) : null
    if (id !== epoch) return
    if (slug) {
      detail.value = result?.canRead && result.project?.status !== 'draft' ? result.project : null
      canEdit.value = detail.value && result?.canManage === true
      if (!canEdit.value) editing.value = false
    }
    else {
      catalog.value = result
      if (!result?.canRead) drawer.value = null
      if (result?.canRead && !board.value) void loadRanges(result.projects, session.value)
    }
    error.value = ''
  } catch (reason) {
    if (id !== epoch) return
    detail.value = null
    catalog.value = null
    error.value = reason.message
  } finally {
    if (id === epoch) loading.value = false
  }
}
async function loadRanges(projects, currentSession) {
  rangeController?.abort()
  rangeController = new AbortController()
  const { signal } = rangeController
  const previous = rangeBySlug.value
  rangeBySlug.value = Object.fromEntries(projects.map(({ slug }) => [slug, previous[slug] ?? { pending: true }]))
  let index = 0
  async function readNext() {
    while (index < projects.length && !signal.aborted) {
      const { slug } = projects[index++]
      let range
      try {
        const { current } = await (await workbookRequest(currentSession, slug, 'meta', { signal })).json()
        if (!current) range = {}
        else if (previous[slug]?.etag === current.etag) range = previous[slug]
        else {
          const response = await workbookRequest(currentSession, slug, 'file', { signal })
          if (response.headers.get('ETag') !== current.etag) throw Error('공정표가 변경되었습니다.')
          range = { ...await workbookRange(await response.arrayBuffer(), current.name), etag: current.etag }
        }
      } catch { range = { failed: true } }
      if (!signal.aborted) rangeBySlug.value = { ...rangeBySlug.value, [slug]: range }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, projects.length) }, readNext))
}
function chooseFile(event) {
  file.value = event.target.files[0] ?? null
  if (file.value && !title.value.trim()) title.value = file.value.name.replace(/\.xlsx$/i, '').slice(0, 160)
}
async function register() {
  if (busy.value || !file.value || !title.value.trim() || !catalog.value?.canManage) return
  busy.value = true
  error.value = ''
  savedNotice.value = ''
  const currentSession = session.value
  try {
    const source = file.value
    if (source.size > 8 * 1024 * 1024) throw Error('xlsx 파일을 최대 8MiB까지 등록할 수 있습니다.')
    const body = await source.arrayBuffer()
    const range = await workbookRange(body, source.name)
    const { slug } = await call('nexpharm_prepare_project', { p_title: title.value.trim() })
    const { current } = await (await workbookRequest(currentSession, slug, 'meta')).json()
    const saved = await (await workbookRequest(currentSession, slug, 'publish', {
      method: 'POST', body, headers: {
        'If-Match': current?.etag ?? 'seed',
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(source.name),
      },
    })).json()
    if (!saved.etag || saved.audit_recorded !== true) throw Error('공정표 등록 기록을 확인하지 못했습니다. 같은 프로젝트 이름으로 다시 시도해 주세요.')
    await call('nexpharm_publish_project', { p_slug: slug, p_etag: saved.etag })
    if (session.value?.user.id !== currentSession.user.id) return
    rangeBySlug.value = { ...rangeBySlug.value, [slug]: { ...range, etag: saved.etag } }
    title.value = ''
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    registering.value = false
    await load(true)
    savedNotice.value = '프로젝트와 공정표를 등록했습니다.'
  } catch (reason) { error.value = reason.message }
  finally { busy.value = false }
}
async function openRegistration() {
  registering.value = !registering.value
  if (registering.value) { await nextTick(); fileInput.value?.focus() }
}
function openDetails(project, event) {
  detailTrigger = event.currentTarget
  drawer.value = project
}
async function closeDetails() {
  drawer.value = null
  await nextTick()
  detailTrigger?.focus()
}
function updateComment(slug, html) {
  const project = catalog.value?.projects.find(item => item.slug === slug)
  if (project) project.comment = html
}
function projectSaved(project) {
  detail.value = project
  editing.value = false
  savedNotice.value = '프로젝트 정보를 저장했습니다.'
}
async function logout() {
  const id = ++epoch
  detail.value = null
  catalog.value = null
  session.value = null
  drawer.value = null
  rangeController?.abort()
  rangeBySlug.value = {}
  title.value = ''
  file.value = null
  registering.value = false
  try {
    const { error: reason } = await client().auth.signOut()
    if (reason) throw reason
  } catch (reason) {
    if (id === epoch) error.value = reason.message
  }
}

onMounted(() => {
  addressChanged()
  window.addEventListener('popstate', addressChanged)
  subscription = client().auth.onAuthStateChange((event, next) => {
    if (session.value?.user.id !== next?.user.id || event === 'SIGNED_OUT') {
      ++epoch
      detail.value = null
      catalog.value = null
      drawer.value = null
      rangeController?.abort()
      rangeBySlug.value = {}
      session.value = next
    }
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => load(true), 0)
  }).data.subscription
  timer = setInterval(() => load(true), 30000)
})
onUnmounted(() => {
  ++epoch
  rangeController?.abort()
  subscription?.unsubscribe()
  clearInterval(timer)
  clearTimeout(refreshTimer)
  window.removeEventListener('popstate', addressChanged)
})
</script>

<template>
  <main class="nex-portal">
    <aside class="nex-sidebar">
      <strong>넥스팜 PMS</strong>
      <nav aria-label="넥스팜 PMS 메뉴">
        <a :href="center" :aria-current="!board && !selected ? 'page' : undefined" @click="onNavigate($event, center)">프로젝트 센터</a>
        <a :href="boardUrl" :aria-current="board ? 'page' : undefined" @click="onNavigate($event, boardUrl)">자유 게시판</a>
      </nav>
    </aside>
    <div class="nex-main">
      <header class="nex-heading">
        <div>
          <h1>{{ selected ? '프로젝트 일정' : board ? '자유 게시판' : '프로젝트 센터' }}</h1>
          <p v-if="selected && detail">{{ detail.title }}</p>
        </div>
        <div class="nex-actions">
          <button v-if="!selected && !board && catalog?.canManage" class="nex-button nex-primary" type="button"
            :aria-expanded="registering" :disabled="busy" @click="openRegistration">엑셀로 등록</button>
          <button v-if="session" type="button" class="nex-button" @click="logout">로그아웃</button>
          <a v-else class="nex-button nex-primary" :href="'/login.html?returnTo=' + encodeURIComponent(address)">로그인</a>
        </div>
      </header>
      <p v-if="savedNotice" class="nex-notice" role="status">{{ savedNotice }}</p>
      <p v-if="loading" class="nex-notice" role="status">프로젝트 이용 권한을 확인하고 있습니다.</p>
      <p v-if="error" class="nex-notice" role="alert">{{ error }} <button class="nex-button" type="button" @click="load()">다시 확인</button></p>
      <template v-if="selected">
        <p v-if="detail?.description" class="nex-description">{{ detail.description }}</p>
        <button v-if="detail && canEdit && !editing" class="nex-button nex-edit" type="button"
          @click="editing=true;savedNotice=''">프로젝트 정보 수정</button>
        <NexpharmProjectEditor v-if="detail && canEdit && editing" :key="detail.slug" :project="detail"
          @saved="projectSaved" @cancel="editing=false" />
        <iframe v-if="detail" :key="detail.slug + '-' + (detail.version || 0)" class="nex-frame"
          :src="'/pms/app/index.html?project=' + encodeURIComponent(detail.slug) + '&embed=1'" title="넥스팜 프로젝트 일정과 자료"></iframe>
        <p v-else-if="!loading && !error" class="nex-notice">프로젝트를 열려면 지정 그룹 권한이 필요합니다.</p>
      </template>
      <template v-else-if="catalog?.canRead">
        <NexpharmActivity v-if="board" />
        <template v-else>
          <form v-if="catalog.canManage && registering" class="nex-register" @submit.prevent="register">
            <h2>새 프로젝트 등록</h2>
            <div class="nex-register-controls">
              <label>공정표 (.xlsx)<input ref="fileInput" type="file" accept=".xlsx" required :disabled="busy" @change="chooseFile"></label>
              <label>프로젝트 이름<input v-model="title" maxlength="160" required :disabled="busy"></label>
              <button class="nex-button nex-primary" type="submit" :disabled="busy || !file || !title.trim()">{{ busy ? '등록 중…' : '프로젝트 등록' }}</button>
            </div>
          </form>
          <div v-if="catalog.projects.length" class="nex-catalog" role="region" aria-label="등록 프로젝트 월별 일정" tabindex="0">
            <table class="nex-table" :style="{ '--months': Math.max(timeline.labels.length, 1) }">
              <thead><tr>
                <th scope="col">프로젝트 이름</th><th scope="col">시작</th><th scope="col">완료</th><th scope="col">코멘트</th>
                <th scope="col" class="nex-timeline" aria-label="일정 막대 차트">
                  <div v-if="timeline.labels.length" class="nex-month-grid"><span v-for="(month, index) in timeline.labels" :key="index">{{ month }}</span></div>
                  <span v-else>월별 일정</span>
                </th>
                <th scope="col" class="nex-detail-cell">상세</th>
              </tr></thead>
              <tbody><tr v-for="project in catalog.projects" :key="project.slug">
                <th scope="row"><a :href="urlFor(project.slug)" @click="onNavigate($event, urlFor(project.slug))">{{ project.title }}</a></th>
                <td class="nex-date">{{ rangeBySlug[project.slug]?.start || '—' }}</td>
                <td class="nex-date">{{ rangeBySlug[project.slug]?.finish || '—' }}</td>
                <td><span class="nex-comment-preview">{{ cleanComment(project.comment).text || '—' }}</span></td>
                <td class="nex-timeline">
                  <div v-if="timeline.spans[project.slug]" class="nex-month-grid nex-track">
                    <span class="nex-bar"
                      :style="{ gridColumn: timeline.spans[project.slug][0] + ' / span ' + timeline.spans[project.slug][1] }"
                      :aria-label="'일정 ' + timeline.spans[project.slug][1] + '개월'" role="img"></span>
                  </div>
                  <span v-else class="nex-range-status">{{ rangeBySlug[project.slug]?.failed ? '공정표 조회 실패' : rangeBySlug[project.slug]?.pending || !rangeBySlug[project.slug] ? '조회 중…' : '공정표 없음' }}</span>
                </td>
                <td class="nex-detail-cell"><button class="nex-button" type="button" :aria-expanded="drawer?.slug === project.slug"
                  :aria-label="project.title + ' 상세 정보'" @click="openDetails(project, $event)">상세 정보</button></td>
              </tr></tbody>
            </table>
          </div>
          <p v-else class="nex-notice">등록된 프로젝트가 없습니다.</p>
        </template>
      </template>
      <p v-else-if="!loading && !error" class="nex-notice">{{ session ? '넥스팜 PMS 지정 그룹에 등록된 계정으로 이용해 주세요.' : '넥스팜 PMS를 이용하려면 로그인해 주세요.' }}</p>
    </div>
    <NexpharmActivity v-if="drawer && catalog?.canRead" :key="drawer.slug" :project="drawer" @close="closeDetails" @posted="updateComment" />
  </main>
</template>
