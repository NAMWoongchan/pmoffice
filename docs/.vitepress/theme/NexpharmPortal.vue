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
const detailFrame = ref(null)
const frameHeight = ref(null)
const canEdit = ref(false)
const editing = ref(false)
const savedNotice = ref('')
const catalog = ref(null)
const session = ref(null)
const loading = ref(true)
const busy = ref(false)
const title = ref('')
const template = ref('rd')
const titleLoading = ref(false)
let titleEdited = false
let fileRevision = 0
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
  frameHeight.value = null
  catalog.value = null
  drawer.value = null
  rangeController?.abort()
  load()
}

function resizeScheduleFrame(event) {
  const message = event.data
  if (event.origin !== window.location.origin || event.source !== detailFrame.value?.contentWindow
      || message?.type !== 'pmoffice-nexpharm-schedule-height' || message.project !== selected.value
      || message.project !== 'nexpharm-8088c44595a3') return
  if (message.height === null) frameHeight.value = null
  else if (Number.isInteger(message.height) && message.height > 0 && message.height <= 1000000)
    frameHeight.value = message.height + 2
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
    const [projects, result] = session.value ? await Promise.all([
      call('nexpharm_catalog'),
      slug ? call('nexpharm_access', { p_slug: slug }) : null,
    ]) : [null, null]
    if (id !== epoch) return
    catalog.value = projects
    if (slug) {
      detail.value = result?.canRead && result.project?.status !== 'draft' ? result.project : null
      canEdit.value = detail.value && result?.canManage === true
      if (!canEdit.value) editing.value = false
    }
    else {
      if (!projects?.canRead) drawer.value = null
      if (projects?.canRead && !board.value) void loadRanges(projects.projects, session.value)
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
      const { slug, template } = projects[index++]
      let range
      try {
        const { current } = await (await workbookRequest(currentSession, slug, 'meta', { signal })).json()
        if (!current) range = {}
        else if (previous[slug]?.etag === current.etag) range = previous[slug]
        else if (template === 'production_outsourcing') range = { start: current.start, finish: current.finish, etag: current.etag }
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
async function chooseFile(event) {
  file.value = event.target.files[0] ?? null
  titleEdited = false
  const source = file.value
  const revision = ++fileRevision
  titleLoading.value = !!source
  if (!source) { title.value = ''; return }
  title.value = filenameTitle(source)
  if (/\.xlsm$/i.test(source.name)) template.value = 'production_outsourcing'
  try {
    const schedule = await productionSchedule(source)
    if (revision !== fileRevision) return
    template.value = 'production_outsourcing'
    if (!titleEdited) title.value = schedule.title || filenameTitle(source)
  } catch {
    // The selected template is validated when the user registers the file.
  } finally {
    if (revision === fileRevision) titleLoading.value = false
  }
}
const filenameTitle = source => source.name.replace(/\.(xlsx|xlsm)$/i, '').slice(0, 160)
async function productionSchedule(source, body) {
  if (source.size > 8 * 1024 * 1024) throw Error('Excel 파일을 최대 8MiB까지 등록할 수 있습니다.')
  const { parseProductionWorkbook } = await import('../../../pms-app/lib/nexpharm-production.ts')
  return parseProductionWorkbook(new Uint8Array(body ?? await source.arrayBuffer()), source.name)
}
async function chooseTemplate() {
  const source = file.value
  const revision = ++fileRevision
  titleLoading.value = false
  if (!source || titleEdited) return
  title.value = filenameTitle(source)
  if (template.value !== 'production_outsourcing') return
  titleLoading.value = true
  try {
    const schedule = await productionSchedule(source)
    if (revision === fileRevision && !titleEdited && schedule.title) title.value = schedule.title
  } catch {
    // Filename fallback stays visible until format validation on submission.
  } finally {
    if (revision === fileRevision) titleLoading.value = false
  }
}
async function register() {
  if (busy.value || titleLoading.value || !file.value || !title.value.trim() || !catalog.value?.canManage) return
  busy.value = true
  error.value = ''
  savedNotice.value = ''
  const currentSession = session.value
  try {
    const source = file.value
    if (source.size > 8 * 1024 * 1024) throw Error('Excel 파일을 최대 8MiB까지 등록할 수 있습니다.')
    const body = await source.arrayBuffer()
    const chosen = template.value
    if (chosen === 'production_outsourcing') await productionSchedule(source, body)
    else await workbookRange(body, source.name)
    const digest = await crypto.subtle.digest('SHA-256', body)
    const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    const { slug, published } = await call('nexpharm_prepare_typed_project', {
      p_title: title.value.trim(), p_template: chosen, p_sha256: sha,
    })
    const { current } = await (await workbookRequest(currentSession, slug, 'meta')).json()
    if (published && current?.sha256 !== sha) throw Error('현재 게시된 공정표가 다릅니다. 프로젝트의 파일 관리에서 교체하거나 다른 이름으로 등록해 주세요.')
    let etag = current?.etag
    if (!published) {
      const saved = await (await workbookRequest(currentSession, slug, 'publish', {
        method: 'POST', body, headers: {
          'If-Match': etag ?? 'seed',
          'Content-Type': 'application/octet-stream',
          'X-Filename': encodeURIComponent(source.name),
        },
      })).json()
      if (!saved.etag || saved.audit_recorded !== true) throw Error('공정표 등록 기록을 확인하지 못했습니다. 같은 파일로 다시 시도해 주세요.')
      etag = saved.etag
      await call('nexpharm_publish_project', { p_slug: slug, p_etag: etag })
    }
    const [access, stored] = await Promise.all([
      call('nexpharm_access', { p_slug: slug }),
      workbookRequest(currentSession, slug, 'meta').then(response => response.json()),
    ])
    if (!etag || stored.current?.etag !== etag || !access.canRead || access.project?.status !== 'published' || access.project?.template !== chosen) {
      throw Error('등록한 프로젝트를 다시 읽지 못했습니다. 같은 파일로 다시 시도해 주세요.')
    }
    if (session.value?.user.id !== currentSession.user.id) return
    title.value = ''
    titleEdited = false
    template.value = 'rd'
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    registering.value = false
    history.pushState(history.state, '', urlFor(slug))
    addressChanged()
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
  window.addEventListener('message', resizeScheduleFrame)
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
  window.removeEventListener('message', resizeScheduleFrame)
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
        <details v-if="catalog?.canRead" class="nex-schedule-menu" :open="!!selected">
          <summary>프로젝트 일정</summary>
          <a v-for="project in catalog.projects" :key="project.slug" :href="urlFor(project.slug)"
            :aria-current="selected === project.slug ? 'page' : undefined" @click="onNavigate($event, urlFor(project.slug))">{{ project.title }}</a>
          <span v-if="!catalog.projects.length">등록된 프로젝트 없음</span>
        </details>
        <a :href="boardUrl" :aria-current="board ? 'page' : undefined" @click="onNavigate($event, boardUrl)">자유 게시판</a>
      </nav>
    </aside>
    <div class="nex-main">
      <header class="nex-heading">
        <div>
          <img v-if="!selected && !board" class="nex-company-logo" src="/images/nexpharm-korea.png" alt="넥스팜코리아" width="150" height="69">
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
        <iframe v-if="detail" ref="detailFrame" :key="detail.slug + '-' + (detail.version || 0)" class="nex-frame"
          :style="frameHeight ? {height: frameHeight + 'px'} : undefined"
          :src="'/pms/app/index.html?project=' + encodeURIComponent(detail.slug) + '&embed=1'
            + (detail.slug === 'nexpharm-8088c44595a3' ? '&layout=page-scroll' : '')" title="넥스팜 프로젝트 일정과 자료"></iframe>
        <p v-else-if="!loading && !error" class="nex-notice">프로젝트를 열려면 지정 그룹 권한이 필요합니다.</p>
      </template>
      <template v-else-if="catalog?.canRead">
        <NexpharmActivity v-if="board" />
        <template v-else>
          <form v-if="catalog.canManage && registering" class="nex-register" @submit.prevent="register">
            <h2>새 프로젝트 등록</h2>
            <div class="nex-register-controls">
              <label>공정표<input ref="fileInput" type="file" accept=".xlsx,.xlsm" required :disabled="busy" @change="chooseFile"></label>
              <label>프로젝트 이름<input v-model="title" maxlength="160" required :disabled="busy" @input="titleEdited = true"></label>
              <label>프로젝트 템플릿 (Project Template)
                <select v-model="template" :disabled="busy" @change="chooseTemplate">
                  <option value="rd">R&D</option>
                  <option value="production_outsourcing">생산위수탁관리</option>
                </select>
              </label>
              <button class="nex-button nex-primary" type="submit" :disabled="busy || titleLoading || !file || !title.trim()">{{ busy ? '등록 중…' : '프로젝트 등록' }}</button>
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
