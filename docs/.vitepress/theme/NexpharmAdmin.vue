<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { call } from './pms-client.js'
import { memberApi } from './member-service.js'
import { projectPublicPath } from './project-address.js'
import NexpharmProjectEditor from './NexpharmProjectEditor.vue'

const props = defineProps({ initialProject: { type: String, default: '' } })
const projects = ref([])
const activeProject = ref(props.initialProject)
const edited = computed(() => projects.value.find(item => item.slug === activeProject.value))
const projectName = ref('')
const members = ref([])
const matches = ref([])
const search = ref('')
const searched = ref(false)
const selectedMember = ref(null)
const role = ref('staff')
const busy = ref(false)
const message = ref('')
const error = ref('')
const showNew = ref(false)
const fresh = () => ({ email: '', name: '', position: '', password: '', role: 'staff' })
const newMember = ref(fresh())
const pending = ref(null)
let requestId, requestEmail

const roleLabels = { manager: '넥스팜 관리자', staff: '넥스팜 직원' }
const states = { assigned: '지정됨', expired: '만료', group_inactive: '그룹 중지', account_inactive: '계정 중지' }
watch(() => props.initialProject, value => { activeProject.value = value })

async function run(work) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  error.value = ''
  try { await work() }
  catch (reason) { error.value = reason.message }
  finally { busy.value = false }
}
async function loadProjects() {
  projects.value = (await call('nexpharm_catalog')).projects
}
async function loadMembers() {
  members.value = await call('nexpharm_admin_members')
}
async function createProject() {
  await run(async () => {
    const result = await call('nexpharm_create_project', { p_title: projectName.value.trim() })
    projectName.value = ''
    await loadProjects()
    activeProject.value = result.slug
    message.value = '프로젝트를 등록했습니다.'
  })
}
function projectSaved(project) {
  projects.value = projects.value.map(item => item.slug === project.slug ? project : item)
  activeProject.value = ''
  message.value = '프로젝트 정보를 저장했습니다.'
}
async function find() {
  await run(async () => {
    selectedMember.value = null
    matches.value = await call('pms_find_members', { p_search: search.value.trim() })
    searched.value = true
  })
}
function selectMember(member) {
  selectedMember.value = { id: member.id || member.user_id, email: member.email, name: member.display_name }
  role.value = members.value.find(item => item.user_id === selectedMember.value.id)?.role || 'staff'
}
async function applyRole() {
  if (!selectedMember.value) return
  const chosen = selectedMember.value
  const nextRole = role.value
  await run(async () => {
    await call('nexpharm_set_member_role', { p_user: chosen.id, p_role: nextRole })
    selectedMember.value = null
    message.value = nextRole === 'none' ? '넥스팜 권한을 회수했습니다.' : roleLabels[nextRole] + ' 권한을 부여했습니다.'
    await loadMembers()
  })
}
async function createMember() {
  await run(async () => {
    if (!pending.value) {
      const { name, position, password, email, role: nextRole } = newMember.value
      const normalized = email.trim().toLowerCase()
      if (requestEmail !== normalized) {
        requestEmail = normalized
        requestId = crypto.randomUUID()
      }
      const result = await memberApi({ action: 'create', request_id: requestId,
        email: normalized, name: name.trim(), position: position.trim(), company: '넥스팜', kind: 'business', password })
      pending.value = { id: result.user_id, email: normalized, role: nextRole }
      newMember.value.password = ''
    }
    try {
      await call('nexpharm_set_member_role', { p_user: pending.value.id, p_role: pending.value.role })
    } catch (reason) {
      throw Error('회원 등록은 완료했습니다. 넥스팜 권한 부여를 다시 실행해 주세요. ' + reason.message)
    }
    message.value = '신규 회원을 등록하고 ' + roleLabels[pending.value.role] + ' 권한을 부여했습니다.'
    pending.value = null
    requestId = requestEmail = undefined
    newMember.value = fresh()
    showNew.value = false
    await loadMembers()
  })
}
onMounted(() => run(() => Promise.all([loadProjects(), loadMembers()])))
</script>

<template>
  <section class="nex-admin" aria-label="넥스팜 프로젝트 센터 관리">
    <header><div><h2>넥스팜 프로젝트 센터</h2><p>프로젝트와 넥스팜 회원 역할을 관리합니다.</p></div>
      <a href="/pms/nexpharm/">프로젝트 센터 열기 →</a></header>
    <p v-if="message" role="status">{{ message }}</p><p v-if="error" role="alert">{{ error }}</p>
    <section>
      <h3>등록 프로젝트</h3>
      <form class="nex-inline" @submit.prevent="createProject">
        <label>새 프로젝트 이름<input v-model="projectName" required maxlength="160" :disabled="busy"></label>
        <button :disabled="busy || !projectName.trim()">프로젝트 등록</button>
      </form>
      <ul v-if="projects.length">
        <li v-for="project in projects" :key="project.slug"><strong>{{ project.title }}</strong>
          <button type="button" :disabled="busy" @click="activeProject=project.slug">정보 수정</button>
          <a :href="projectPublicPath(project.slug)">상세·파일 관리 →</a>
          <p v-if="project.description" class="nex-description">{{ project.description }}</p>
        </li>
      </ul>
      <p v-else-if="!busy">등록된 넥스팜 프로젝트가 없습니다.</p>
      <NexpharmProjectEditor v-if="edited" :key="edited.slug" :project="edited" @saved="projectSaved" @cancel="activeProject=''" />
    </section>
    <section>
      <h3>넥스팜 회원 권한</h3>
      <p><strong>넥스팜 관리자</strong>는 프로젝트를 등록·수정하고 파일을 관리합니다.
        <strong>넥스팜 직원</strong>은 프로젝트를 열람하고 원본을 내려받을 수 있습니다.</p>
      <form class="nex-inline" @submit.prevent="find">
        <label>기존 회원 검색<input v-model="search" minlength="2" maxlength="120" required placeholder="이메일, 이름, 회사명" :disabled="busy"></label>
        <button :disabled="busy || search.trim().length < 2">회원 찾기</button>
      </form>
      <p v-if="searched && !matches.length">검색 결과가 없습니다.</p>
      <ul v-if="matches.length">
        <li v-for="member in matches" :key="member.id">{{ member.display_name }} · {{ member.email }}
          <button type="button" :disabled="busy" @click="selectMember(member)">역할 지정</button>
        </li>
      </ul>
      <form v-if="selectedMember" class="nex-inline" @submit.prevent="applyRole">
        <p>{{ selectedMember.name }} · {{ selectedMember.email }}</p>
        <label>넥스팜 역할<select v-model="role" :disabled="busy">
          <option value="staff">넥스팜 직원</option><option value="manager">넥스팜 관리자</option>
          <option value="none">넥스팜 권한 회수</option>
        </select></label>
        <button :disabled="busy">역할 적용</button>
      </form>
      <button v-if="!showNew" type="button" :disabled="busy" @click="showNew=true">신규 회원 등록 및 권한 부여</button>
      <form v-if="showNew" class="nex-new" @submit.prevent="createMember">
        <template v-if="!pending">
          <h4>신규 넥스팜 회원</h4>
          <label>이름<input v-model="newMember.name" maxlength="120" required :disabled="busy"></label>
          <label>직함<input v-model="newMember.position" maxlength="120" required :disabled="busy"></label>
          <label>이메일<input v-model="newMember.email" type="email" maxlength="254" required :disabled="busy"></label>
          <label>초기 비밀번호<input v-model="newMember.password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required :disabled="busy"></label>
          <label>부여할 역할<select v-model="newMember.role" :disabled="busy">
            <option value="staff">넥스팜 직원</option><option value="manager">넥스팜 관리자</option>
          </select></label>
          <button :disabled="busy">회원 등록 및 역할 부여</button>
          <button type="button" :disabled="busy" @click="newMember=fresh();showNew=false">닫기</button>
        </template>
        <template v-else><p>{{ pending.email }} 회원의 역할 부여를 마무리해 주세요.</p><button :disabled="busy">역할 부여 다시 실행</button></template>
      </form>
      <h4>권한이 지정된 회원</h4>
      <ul v-if="members.length">
        <li v-for="member in members" :key="member.user_id">{{ member.display_name }} · {{ member.email }} · {{ roleLabels[member.role] }} · {{ states[member.state] }}
          <button type="button" :disabled="busy" @click="selectMember(member)">역할 변경</button>
        </li>
      </ul>
      <p v-else-if="!busy">권한을 지정한 회원이 없습니다.</p>
    </section>
  </section>
</template>

<style scoped>
.nex-admin{display:grid;gap:16px;color:#17314e}.nex-admin>header{margin:0;align-items:center}
.nex-admin>section{border:1px solid #d6e1ef;border-radius:10px;padding:18px;background:#fff}
h2,h3,h4{font-weight:730;margin:6px 0 9px}h2{font-size:23px}h3{font-size:19px}
ul{list-style:none;padding:0}li{border-top:1px solid #e1e8f1;padding:10px 0;overflow-wrap:anywhere}
li button,li a{margin-inline-start:8px}
.nex-inline,.nex-new{display:flex;align-items:end;gap:9px;flex-wrap:wrap;margin:12px 0}
.nex-new{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));align-items:end}
.nex-new h4,.nex-new p{grid-column:1/-1}
input,select{display:block;min-height:38px;padding:7px 10px;border:1px solid #b9cbdc;border-radius:6px;background:#fff;width:100%}
button{padding:7px 10px;border:1px solid #b9cbdc;border-radius:6px;background:#eef4fb}
button:disabled{opacity:.55}.nex-description{white-space:pre-wrap}
[role=alert]{color:#9a2529}
</style>
