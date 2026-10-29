<script setup>
import {withBase} from 'vitepress'
import data from './experience.json'
defineProps({full:{type:Boolean,default:false}})
const clients=['한국로봇산업진흥원','한국철도공사','SGC E&C','퀄리타스반도체','한국지질자원연구원','LG에너지솔루션','현대로템','한화에어로스페이스']
</script>
<template><section class="experience-proof"><div class="section-inner release-section"><div class="release-heading"><span class="consult-eyebrow">기업·공공기관 수행 경험</span><h2>산업과 조직의 관리 요구를<br>실제 업무에 반영해 왔습니다.</h2><p>국가연구개발 사업, 건설·플랜트, 반도체·제조와 IT 분야의<br>교육·컨설팅 수행 실적을 확인하십시오.</p></div><ul class="client-name-grid"><li v-for="c in clients" :key="c">{{c}}</li></ul><a v-if="!full" class="text-link" :href="withBase('/consulting/experience.html')">산업별·연도별 주요 실적 보기 ↗</a><div v-if="!full" class="case-preview-grid"><article v-for="c in data.cases" :key="c.id"><span class="consult-eyebrow">{{c.client}}</span><h3>{{c.title}}</h3><p>{{c.work}}</p><a class="text-link" :href="withBase('/consulting/experience.html#industry-experience')">산업별·연도별 실적 보기 ↗</a></article></div></div></section></template>
