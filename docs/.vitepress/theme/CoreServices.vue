<script setup>
import {withBase} from 'vitepress'
const items=[
['MS Project 교육','공정표 작성부터 진도·자원·비용 분석까지, 담당자가 직접 관리할 수 있도록 실습합니다.','/ms-project/','핵심 실무 · 전문가 · Template 개발','gantt-screen.webp'],
['프로젝트 관리 컨설팅','EPC·국가연구개발·글로벌 프로젝트의 관리 기준과 통합 일정·보고 체계를 구축합니다.','/consulting/pm.html','관리 체계 · 통합 일정 · 운영 인계','original-weight.webp'],
['공정표 작성 대행','입찰·발주처·감독기관 제출과 기업 통합 관리에 필요한 공정표를 작성합니다.','/consulting/scheduling.html','Microsoft Project · Excel · PDF','excel-schedule.webp'],
['AI 교육','ChatGPT와 Microsoft Copilot을 보고서 작성·자료 분석·과제 관리 업무에 적용합니다.','/ai-edu/','기업 방문 · 직무별 실습 · 맞춤형 교육','report-dashboard.webp']]
</script>
<template><section id="core-services" class="section-inner release-section"><div class="release-heading"><span class="consult-eyebrow">피엠오피스의 주요 서비스</span><h2>지금 필요한 업무 지원을<br>선택하십시오.</h2><p>담당자의 교육부터 공정표 납품과 조직의 관리 체계 구축까지.<br>목적과 필요한 산출물에 맞춰 지원합니다.</p></div><div class="core-service-grid"><a v-for="(item,i) in items" :key="item[0]" :href="withBase(item[2])" class="core-service-card"><div class="core-service-top"><span>0{{i+1}}</span><span aria-hidden="true">↗</span></div><h3>{{item[0]}}</h3><p>{{item[1]}}</p><img :src="withBase('/images/consulting/'+item[4])" alt="Microsoft Project·Excel 공정표와 보고서 화면" loading="lazy" width="1144" height="761"><strong>{{item[3]}}</strong></a></div></section></template>
