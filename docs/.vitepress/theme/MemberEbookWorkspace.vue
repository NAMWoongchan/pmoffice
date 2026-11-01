<script setup>
import {ref,watch} from 'vue'
import {memberAccount,memberSession} from './member-service.js'
const summary=ref(null),message=ref(''),loading=ref(false)
let generation=0
watch(()=>[memberAccount.value?.profile?.id,memberAccount.value?.member,memberSession.value?.access_token],async()=>{
 const current=++generation;summary.value=null;message.value=''
 if(!memberAccount.value?.member||!memberSession.value)return
 loading.value=true
 try{
  const request=async action=>{const r=await fetch('https://pmoffice-ebooks.pages.dev/api/rpc',{method:'POST',headers:{Authorization:'Bearer '+memberSession.value.access_token,'Content-Type':'application/json'},body:JSON.stringify({action}),cache:'no-store'});if(!r.ok)throw Error('이북 사용량을 불러오지 못했습니다. 이북 서비스에서 이용 상태를 확인해 주세요.');return r.json()}
  const session=await request('session')
  if(!session.enabled){if(current===generation)message.value='회원 상태 또는 그룹 정책에 따라 이북 이용이 제한되어 있습니다.';return}
  if(!session.released&&!session.admin){if(current===generation)message.value='이북 서비스를 점검 중입니다.';return}
  const data=await request('list');if(current!==generation)return
  const books=data.books||[];summary.value={books:books.length,max:session.admin?null:(session.max_books??10),bytes:books.reduce((n,b)=>n+Number(b.source_bytes),0),ready:books.filter(b=>b.state==='ready').length}
 }catch(e){if(current===generation)message.value=e.message}finally{if(current===generation)loading.value=false}
},{immediate:true})
const size=n=>(n/1048576).toFixed(1)+' MiB'
</script>
<template><section class="member-ebook-workspace" aria-labelledby="ebook-workspace-title"><h2 id="ebook-workspace-title">나의 작업 공간</h2><p>피엠오피스 회원 전용 이북 서비스 이용 현황입니다.</p><p v-if="loading" role="status">이북 사용량을 확인하고 있습니다.</p><p v-else-if="message" role="status">{{message}}</p><div v-else-if="summary" class="ebook-workspace-metrics"><div><span>내 이북</span><strong>{{summary.books}} <small>/ {{summary.max===null?'무제한':summary.max+'권'}}</small></strong></div><div><span>이용 가능</span><strong>{{summary.ready}} <small>권</small></strong></div><div><span>원본 보관 용량</span><strong>{{size(summary.bytes)}}</strong></div></div><p v-if="summary?.max===null" class="member-note">시스템 관리자: 이북 개수·파일 크기·보관 용량에 서비스 제한이 없습니다.</p><p v-else class="member-note">변환 결과와 관리자 보관 자료는 일반 회원 저장량에 포함됩니다.</p><a class="member-button" href="/ebooks/view.html" target="_self">이북 서비스 열기 →</a></section></template>
<style scoped>
.member-ebook-workspace{margin-top:36px;padding-top:24px;border-top:1px solid #d5e0eb}.ebook-workspace-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:22px 0}.ebook-workspace-metrics>div{padding:15px 12px;border:1px solid #dbe5ef;border-radius:8px;background:#f5f8fc}.ebook-workspace-metrics span{display:block;font-size:12px;color:#526880;margin-bottom:10px}.ebook-workspace-metrics strong{display:block;font-size:21px;white-space:nowrap}.ebook-workspace-metrics small{font-size:12px;font-weight:400}@media(max-width:480px){.ebook-workspace-metrics{grid-template-columns:1fr}.ebook-workspace-metrics>div{display:flex;justify-content:space-between;align-items:center}.ebook-workspace-metrics span{margin:0}}
</style>
