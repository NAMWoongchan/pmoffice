<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { call, client } from './pms-client.js'
import NexpharmProjectEditor from './NexpharmProjectEditor.vue'

const center = '/pms/nexpharm/'
const selected = ref('')
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
function readAddress() {
  const slug = new URLSearchParams(location.search).get('project') || ''
  selected.value = /^nexpharm-[0-9a-f]{12}$/.test(slug) ? slug : ''
}
function onNavigate(event, slug) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  history.pushState(history.state, '', slug ? urlFor(slug) : center)
  addressChanged()
}
function addressChanged() {
  readAddress()
  canEdit.value = false
  editing.value = false
  savedNotice.value = ''
  detail.value = null
  catalog.value = null
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
      detail.value = result?.canRead ? result.project : null
      canEdit.value = result?.canManage === true
      if (!canEdit.value) editing.value = false
    }
    else catalog.value = result
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
async function register() {
  if (busy.value || !title.value.trim() || !catalog.value?.canManage) return
  busy.value = true
  try {
    const result = await call('nexpharm_create_project', { p_title: title.value.trim() })
    title.value = ''
    history.pushState(history.state, '', urlFor(result.slug))
    addressChanged()
  } catch (reason) { error.value = reason.message }
  finally { busy.value = false }
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
      session.value = next
    }
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => load(true), 0)
  }).data.subscription
  timer = setInterval(() => load(true), 30000)
})
onUnmounted(() => {
  ++epoch
  subscription?.unsubscribe()
  clearInterval(timer)
  clearTimeout(refreshTimer)
  window.removeEventListener('popstate', addressChanged)
})
</script>

<template>
  <main class="nex-portal">
    <header class="nex-heading">
      <div>
        <span class="nex-eyebrow">PMOFFICE · 넥스팜 PMS</span>
        <h1>{{ selected ? detail?.title || '프로젝트 상세' : '프로젝트 센터' }}</h1>
        <p>{{ selected ? '사업 일정과 마일스톤, 참고 자료를 확인하세요.' : '넥스팜 프로젝트의 공정표와 참고 자료를 한 곳에서 관리합니다.' }}</p>
      </div>
      <div class="nex-actions">
        <a v-if="selected" class="nex-button" :href="center" @click="onNavigate($event, '')">프로젝트 센터</a>
        <button v-if="session" type="button" class="nex-button" @click="logout">로그아웃</button>
        <a v-else class="nex-button nex-primary" :href="'/login.html?returnTo=' + encodeURIComponent(selected ? urlFor(selected) : center)">로그인</a>
      </div>
    </header>
    <p v-if="savedNotice" role="status">{{ savedNotice }}</p>
    <p v-if="loading" class="nex-notice" role="status">프로젝트 이용 권한을 확인하고 있습니다.</p>
    <p v-if="error" class="nex-notice" role="alert">{{ error }} <button class="nex-button" type="button" @click="load()">다시 확인</button></p>
    <template v-if="selected">
      <p v-if="detail?.description" class="nex-description">{{ detail.description }}</p>
      <button v-if="detail && canEdit && !editing" class="nex-button nex-edit" type="button"
        @click="editing=true;savedNotice=''">프로젝트 정보 수정</button>
      <NexpharmProjectEditor v-if="detail && canEdit && editing" :key="detail.slug" :project="detail"
        @saved="projectSaved" @cancel="editing=false" />
      <iframe v-if="detail" :key="detail.slug + '-' + (detail.version || 0)" class="nex-frame"
        :src="'/pms/app/index.html?project=' + encodeURIComponent(detail.slug)" title="넥스팜 프로젝트 일정과 자료"></iframe>
      <p v-else-if="!loading && !error" class="nex-notice">프로젝트를 열려면 지정 그룹 권한이 필요합니다.</p>
    </template>
    <template v-else-if="catalog?.canRead">
      <form v-if="catalog.canManage" class="nex-register" @submit.prevent="register">
        <div><h2>프로젝트 등록</h2><p>새 프로젝트를 만든 뒤 상세 화면에서 공정표를 올릴 수 있습니다.</p></div>
        <label for="nex-project-title">프로젝트 이름</label>
        <div class="nex-register-controls">
          <input id="nex-project-title" v-model="title" maxlength="160" required placeholder="프로젝트 이름 입력">
          <button class="nex-button nex-primary" type="submit" :disabled="busy || !title.trim()">{{ busy ? '등록 중…' : '프로젝트 등록' }}</button>
        </div>
      </form>
      <section class="nex-catalog" aria-label="등록 프로젝트">
        <header><h2>등록 프로젝트</h2><span>{{ catalog.projects.length }}건</span></header>
        <ul v-if="catalog.projects.length">
          <li v-for="project in catalog.projects" :key="project.slug">
            <a :href="urlFor(project.slug)" @click="onNavigate($event, project.slug)">
              <span class="nex-project-icon" aria-hidden="true">P</span>
              <strong>{{ project.title }}</strong><span aria-hidden="true">열기 →</span>
            </a>
          </li>
        </ul>
        <p v-else class="nex-empty">등록된 프로젝트가 없습니다.</p>
      </section>
    </template>
    <p v-else-if="!loading && !error" class="nex-notice">{{ session ? '넥스팜 PMS 지정 그룹에 등록된 계정으로 이용해 주세요.' : '넥스팜 PMS를 이용하려면 로그인해 주세요.' }}</p>
  </main>
</template>

<style scoped>
.nex-portal{max-width:1440px;margin:auto;padding:52px 24px;color:#17314e}
.nex-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:32px}
.nex-eyebrow{font-size:12px;letter-spacing:.12em;font-weight:650;color:#496784}
.nex-heading h1{font-size:clamp(26px,4vw,36px);font-weight:760;line-height:1.3;margin:10px 0;overflow-wrap:anywhere}
.nex-heading p,.nex-register p{color:#4c637a}
.nex-actions,.nex-register-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.nex-actions{flex-shrink:0}
.nex-button,.nex-register input{display:inline-flex;justify-content:center;align-items:center;min-height:42px;padding:8px 14px;background:#fff;color:#17314e;border:1px solid #b9cbdc;border-radius:7px;font-weight:650}
.nex-primary{background:#1d52a3;color:#fff;border-color:#1d52a3}.nex-button:disabled{opacity:.55}
.nex-button:focus-visible,.nex-catalog a:focus-visible,.nex-register input:focus-visible{outline:3px solid #2978d1;outline-offset:3px}
.nex-catalog,.nex-register,.nex-notice{background:#f4f7fb;border:1px solid #d6e1ef;border-radius:12px;padding:24px;margin:0 0 22px}
.nex-register label{display:block;font-weight:650;margin-top:14px;margin-bottom:5px}
.nex-register input{flex:1;min-width:min(100%,220px);font-weight:400}
.nex-catalog header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d6e1ef;padding-bottom:12px}
.nex-catalog h2,.nex-register h2{font-size:21px;font-weight:730}.nex-catalog ul{list-style:none;padding:0;margin:12px 0 0}
.nex-catalog li+li{margin-top:9px}.nex-catalog li a{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:13px;padding:14px;background:#fff;border:1px solid #d6e1ef;border-radius:8px;color:#17314e}
.nex-catalog li a:hover{border-color:#266bc5}.nex-catalog strong{overflow-wrap:anywhere}
.nex-project-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:#e5efff;color:#1d52a3;font-weight:800}
.nex-edit{margin:0 0 14px}.nex-description{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 14px}.nex-empty{padding-top:12px}.nex-frame{width:100%;height:max(720px,calc(100vh - 160px));border:1px solid #d6e1ef;border-radius:10px}
@media(max-width:700px){.nex-portal{padding:30px 14px}.nex-heading{display:block}.nex-actions{margin-top:15px}.nex-register,.nex-catalog,.nex-notice{padding:15px}}
</style>
