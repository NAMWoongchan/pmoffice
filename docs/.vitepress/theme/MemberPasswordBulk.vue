<script setup>
import {ref,computed,onMounted,onUnmounted} from 'vue'
import {memberRpc,memberApi} from './member-service.js'
const rows=ref([]),selected=ref([]),busy=ref(false),loading=ref(false),loaded=ref(false),message=ref(''),password=ref(''),confirm=ref(''),ack=ref(false)
let alive=true
const eligible=computed(()=>rows.value.filter(r=>!r.is_admin))
const allSelected=computed(()=>eligible.value.length>0&&eligible.value.every(r=>selected.value.includes(r.id)))
const pending=computed(()=>rows.value.filter(r=>!r.is_admin&&selected.value.includes(r.id)&&r.result!=='완료'))
const canSubmit=computed(()=>!busy.value&&!loading.value&&loaded.value&&ack.value&&pending.value.length>0&&password.value.length>=8&&password.value.length<=128&&password.value===confirm.value)
function selectAll(){if(busy.value||loading.value)return;selected.value=allSelected.value?[]:eligible.value.map(r=>r.id);ack.value=false}
function toggle(row){if(row.is_admin||busy.value)return;selected.value=selected.value.includes(row.id)?selected.value.filter(id=>id!==row.id):[...selected.value,row.id];ack.value=false}
async function load(){if(busy.value||loading.value)return;loading.value=true;loaded.value=false;message.value='';selected.value=[];ack.value=false;password.value='';confirm.value='';const data=[]
 try{let offset=0;while(true){const page=await memberRpc('member_password_targets',{p_offset:offset});if(!alive)return;if(!Array.isArray(page))throw Error('회원 목록 응답을 확인해 주세요.');data.push(...page.slice(0,100));if(page.length<=100)break;offset+=100}
 if(new Set(data.map(r=>r.id)).size!==data.length)throw Error('회원 목록이 변경되었습니다. 다시 조회해 주세요.');rows.value=data.map(r=>({...r,result:'대기',error:'',request_id:crypto.randomUUID()}));loaded.value=true
 }catch(e){rows.value=[];message.value=e.message}finally{loading.value=false}}
async function submit(){if(!canSubmit.value)return;const targets=[...pending.value];busy.value=true;message.value='변경 중입니다. 이 화면을 닫지 마세요.'
 try{for(const row of targets){if(!alive)break;row.result='처리 중';try{await memberApi({action:'password',request_id:row.request_id,user_id:row.id,password:password.value});row.result='완료';row.error=''}catch(e){row.result='실패';row.error=e.message}}
 if(alive)message.value='변경 완료 '+targets.filter(r=>r.result==='완료').length+'명 / 실패 '+targets.filter(r=>r.result==='실패').length+'명. 관리자 계정은 제외했습니다.'
 }finally{password.value='';confirm.value='';ack.value=false;busy.value=false}}
onMounted(load)
onUnmounted(()=>{alive=false;password.value='';confirm.value='';selected.value=[];rows.value=[]})
</script>
<template><main class="member-page member-password-bulk">
 <h1>회원 비밀번호 일괄 변경</h1>
 <p>등록된 회원을 선택하여 PMOffice 비밀번호를 한 번에 변경합니다. 남웅찬을 포함한 관리자 계정은 선택과 변경에서 제외됩니다.</p>
 <p>회원 등록·그룹·이용 상태는 변경하지 않습니다. Google 계정 비밀번호도 변경하지 않습니다.</p>
 <div class="member-actions"><a href="/admin/#members">회원 관리로 이동</a><button :disabled="busy||loading" @click="load">회원 목록 새로고침</button><button :disabled="busy||loading||!eligible.length" @click="selectAll">{{allSelected?'전체 선택 해제':'관리자 제외 전체 선택'}}</button><span>전체 {{rows.length}}명 · 변경 가능 {{eligible.length}}명 · 선택 {{selected.length}}명</span></div>
 <p v-if="loading" role="status">전체 회원을 불러오는 중입니다.</p>
 <div class="password-table"><table><caption>관리자 제외 비밀번호 변경 대상</caption><thead><tr><th>선택</th><th>이름</th><th>이메일</th><th>소속</th><th>이용 상태</th><th>처리 결과</th></tr></thead><tbody>
 <tr v-for="r in rows" :key="r.id"><td><input type="checkbox" :checked="selected.includes(r.id)" :disabled="busy||r.is_admin" :aria-label="(r.display_name||r.email)+' 선택'" @change="toggle(r)"></td><td>{{r.display_name||'이름 미입력'}}<strong v-if="r.is_admin"> · 관리자(제외)</strong></td><td>{{r.email}}</td><td>{{r.company||'—'}}</td><td>{{r.withdrawn_at?'탈퇴':r.status==='active'?'이용 중':'중지'}}</td><td>{{r.is_admin?'변경 대상 제외':r.result}}<span v-if="r.error"> · {{r.error}}</span></td></tr>
 <tr v-if="loaded&&!eligible.length"><td colspan="6">관리자를 제외한 등록 회원이 없습니다. 회원 관리에서 계정을 먼저 등록해 주세요.</td></tr>
 </tbody></table></div>
 <form class="member-form" @submit.prevent="submit">
 <label>새 공통 비밀번호<input v-model="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password" :disabled="busy||!pending.length"></label>
 <label>새 공통 비밀번호 확인<input v-model="confirm" type="password" minlength="8" maxlength="128" required autocomplete="new-password" :disabled="busy||!pending.length"></label>
 <p v-if="confirm&&password!==confirm" role="alert">비밀번호 확인이 일치하지 않습니다.</p>
 <label class="member-check"><input v-model="ack" type="checkbox" :disabled="busy||!pending.length"><span>선택한 {{pending.length}}명의 비밀번호 변경 대상을 확인했습니다.</span></label>
 <button class="member-button" :disabled="!canSubmit">{{busy?'비밀번호 변경 중':'선택 회원 비밀번호 변경 실행'}}</button>
 </form>
 <p>변경 후 비밀번호 입력란은 지워집니다. 회원별 성공·실패는 위 표에서 확인하며, 재실행하면 실패한 선택 회원만 다시 처리합니다. 안내 메일은 자동 발송하지 않습니다.</p>
 <p role="status" aria-live="polite">{{message}}</p>
</main></template>
<style scoped>.password-table{overflow-x:auto;margin:1.2rem 0}.password-table table{min-width:760px;width:100%;border-collapse:collapse}.password-table th,.password-table td{padding:.65rem;text-align:left;border-bottom:1px solid var(--vp-c-divider)}.password-table strong{color:var(--vp-c-brand-1)}.member-password-bulk .member-actions{flex-wrap:wrap}</style>
