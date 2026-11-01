<script setup>
import {computed} from 'vue'
const props=defineProps({summary:{type:Object,default:null}})
const summary=computed(()=>props.summary)
const size=n=>(n/1048576).toFixed(1)+' MiB'
</script>
<template><section class="member-ebook-workspace" aria-labelledby="ebook-workspace-title"><h2 id="ebook-workspace-title">나의 작업 공간</h2><p>피엠오피스 회원 전용 이북 서비스 이용 현황입니다.</p><p v-if="summary&&!summary.enabled" role="status">회원 그룹 정책에 따라 이북 이용이 제한되어 있습니다. 작업 공간 현황은 아래에서 확인할 수 있습니다.</p><div v-if="summary" class="ebook-workspace-metrics"><div><span>내 이북</span><strong>{{summary.books}} <small>/ {{summary.max===null?'무제한':summary.max+'권'}}</small></strong></div><div><span>이용 가능</span><strong>{{summary.ready}} <small>권</small></strong></div><div><span>원본 보관 용량</span><strong>{{size(summary.bytes)}}</strong></div></div><p v-if="summary?.max===null" class="member-note">시스템 관리자: 이북 개수·파일 크기·보관 용량에 서비스 제한이 없습니다.</p><p v-else class="member-note">변환 결과와 관리자 보관 자료는 일반 회원 저장량에 포함됩니다.</p><a class="member-button" href="/ebooks/view.html" target="_self">이북 서비스 열기 →</a></section></template>
<style scoped>
.member-ebook-workspace{margin-top:0;padding-top:0;border-top:0}.ebook-workspace-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:22px 0}.ebook-workspace-metrics>div{padding:15px 12px;border:1px solid #dbe5ef;border-radius:8px;background:#f5f8fc}.ebook-workspace-metrics span{display:block;font-size:12px;color:#526880;margin-bottom:10px}.ebook-workspace-metrics strong{display:block;font-size:21px;white-space:nowrap}.ebook-workspace-metrics small{font-size:12px;font-weight:400}@media(max-width:480px){.ebook-workspace-metrics{grid-template-columns:1fr}.ebook-workspace-metrics>div{display:flex;justify-content:space-between;align-items:center}.ebook-workspace-metrics span{margin:0}}
</style>
