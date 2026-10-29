<script setup>
import {ref,onMounted} from 'vue'
import {call} from './pms-client.js'
const props=defineProps({project:{type:String,default:''}})
const groups=ref([]),grants=ref([]),people=ref([]),matches=ref([]),group=ref(''),name=ref(''),active=ref(true),search=ref(''),role=ref('viewer'),expires=ref(''),busy=ref(false),message=ref('')
async function run(fn){if(busy.value)return;busy.value=true;message.value='';try{await fn()}catch(e){message.value=e.message}finally{busy.value=false}}
async function refresh(){[groups.value,grants.value]=await Promise.all([call('pms_groups_list'),props.project?call('pms_project_groups',{p_slug:props.project}):Promise.resolve([])])}
async function choose(){people.value=[];matches.value=[];const g=groups.value.find(g=>g.id===group.value);name.value=g?.name||'';active.value=g?.active??true;if(g){people.value=await call('pms_group_people',{p_group:g.id});people.value.forEach(p=>{p.expiryInput=p.expires_at?new Date(new Date(p.expires_at).getTime()-new Date(p.expires_at).getTimezoneOffset()*60000).toISOString().slice(0,16):''})}}
async function save(){await run(async()=>{group.value=await call('pms_save_group',{p_id:group.value||null,p_name:name.value,p_active:active.value});await refresh();await choose();message.value='그룹을 저장했습니다.'})}
async function saveExpiry(person){await run(async()=>{await call('member_group_expiry',{p_group:group.value,p_user:person.user_id,p_expires:person.expiryInput?new Date(person.expiryInput).toISOString():null});await choose();message.value='구성원 만료 일시를 저장했습니다.'})}
async function find(){await run(async()=>{matches.value=await call('pms_find_members',{p_search:search.value})})}
async function member(id,enabled){await run(async()=>{await call('pms_set_group_person',{p_group:group.value,p_user:id,p_active:enabled});await choose();message.value='그룹 구성원을 변경했습니다. 이 그룹에 연결된 모든 프로젝트에 적용됩니다.'})}
async function grant(id,enabled,chosenRole=role.value){await run(async()=>{await call('pms_set_group_grant',{p_slug:props.project,p_group:id,p_role:chosenRole,p_active:enabled,p_expires:expires.value?new Date(expires.value).toISOString():null});await refresh();message.value='프로젝트 그룹 권한을 저장했습니다.'})}
onMounted(()=>run(refresh))
</script>
<template>
<section class="pms-groups">
<h2>그룹과 프로젝트 권한</h2><p role="status">{{message}}</p>
<label>관리할 그룹<select v-model="group" @change="run(choose)" :disabled="busy"><option value="">새 그룹 만들기</option><option v-for="g in groups" :key="g.id" :value="g.id">{{g.name}} {{g.active?'':'(사용 중지)'}}</option></select></label>
<form @submit.prevent="save"><label>그룹 이름<input v-model="name" required maxlength="120"></label><label><input type="checkbox" v-model="active"> 그룹 사용</label><p>그룹 사용 중지와 구성원 변경은 이 그룹에 연결된 모든 프로젝트에 적용됩니다.</p><button :disabled="busy">그룹 저장</button></form>
<template v-if="group">
<h3>그룹 구성원</h3><form @submit.prevent="find"><label>가입 회원 이메일·이름·회사명<input v-model="search" required minlength="2" maxlength="120"></label><button :disabled="busy">회원 찾기</button></form>
<ul><li v-for="u in matches" :key="u.id">{{u.email}} <button @click="member(u.id,true)" :disabled="busy">그룹에 추가</button></li></ul>
<ul><li v-for="u in people" :key="u.user_id">{{u.display_name}} · {{u.email}} · {{u.company}} · {{u.active?'포함':'제외'}} <label>구성원 만료 일시(선택)<input type="datetime-local" v-model="u.expiryInput"></label><button @click="saveExpiry(u)" :disabled="busy">구성원 만료 저장</button> <button @click="member(u.user_id,!u.active)" :disabled="busy">{{u.active?'제외':'다시 추가'}}</button></li></ul>
<template v-if="project"><h3>이 프로젝트에 권한 부여</h3><label>역할<select v-model="role"><option value="viewer">열람자</option><option value="editor">편집자</option></select></label><label>만료 일시(선택)<input type="datetime-local" v-model="expires"></label><button @click="grant(group,true)" :disabled="busy">선택 그룹에 역할·만료 적용</button></template>
</template>
<ul><li v-for="g in grants" :key="g.group_id">{{g.name}} · {{g.role==='editor'?'편집자':'열람자'}} · {{g.active&&g.group_active?'허용':'회수 또는 그룹 중지'}} · {{g.expires_at||'만료 없음'}} <button v-if="g.active" @click="grant(g.group_id,false,g.role)" :disabled="busy">프로젝트 권한 회수</button></li></ul>
<p>다른 유효 그룹의 권한이 있으면 접근이 유지됩니다. 지정 그룹의 활성 회원만 프로젝트를 열람하며, 편집자만 원본을 게시·복원할 수 있습니다.</p>
</section>
</template>
<style scoped>
.pms-groups{padding:24px;border:1px solid #d5e0eb;border-radius:10px;background:white;margin-bottom:22px}h2{font-size:22px;font-weight:700}h3{font-weight:700;margin-top:20px}label{display:block;margin:12px 0}input:not([type=checkbox]),select{display:block;width:100%;padding:10px;border:1px solid #b5c5d5;border-radius:6px}button{padding:9px 13px;border:1px solid #b5c5d5;border-radius:6px;background:#edf3fa}button:disabled{opacity:.5}li,p{margin:12px 0;overflow-wrap:anywhere}li button{margin-left:8px}
</style>
