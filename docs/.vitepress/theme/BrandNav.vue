<script setup>
import {ref,onMounted,onUnmounted,nextTick} from 'vue'
import {withBase} from 'vitepress'
import education from './education.json'
import aiEducation from './ai-education.json'
const container=ref(null),open=ref(''),mobile=ref(false)
const groups=[
{key:'about',text:'회사 소개',link:'/about.html',items:[{text:'피엠오피스 소개',link:'/about.html'},{text:'사업 분야',link:'/services.html'},{text:'주요 수행 실적',link:'/consulting/experience.html'},{text:'교육 컨설팅 문의',link:'/contact.html'}]},
{key:'ai',text:'AI 교육',link:'/ai-edu/',items:[{text:'AI 교육 전체 과정',link:'/ai-edu/'},...aiEducation.courses.map(c=>({text:c.title,link:c.path}))]},
{key:'ms',text:'MS Project 교육',link:'/ms-project/',items:[{text:'MS Project 소개',link:'/ms-project/introduction.html'},...education.groups.find(g=>g.key==='ms').items]},
{key:'pm-education',text:'PM 실무 교육',link:'/pm-practice/',items:education.groups.find(g=>g.key==='pm').items},
{key:'consulting',text:'프로젝트 관리 컨설팅',link:'/consulting/',items:[{text:'공정표 작성 대행',link:'/consulting/scheduling.html'},{text:'컨설팅 종합 안내',link:'/consulting/'},{text:'EPC·R&D·글로벌 프로젝트',link:'/consulting/pm.html'},{text:'AI 컨설팅',link:'/consulting/ai/'},{text:'ChatGPT 컨설팅',link:'/consulting/ai/chatgpt.html'},{text:'Microsoft Copilot 컨설팅',link:'/consulting/ai/copilot.html'}]},
{key:'knowledge',text:'지식 공간',link:'/knowledge/index.html'}]
const close=()=>{open.value='';mobile.value=false}
function outside(event){if(container.value&&!container.value.contains(event.target))close()}
function keyboard(event){if(event.key==='Escape')close()}
async function first(group){open.value=group.key;await nextTick();container.value?.querySelector('#submenu-'+group.key+' a')?.focus()}
onMounted(()=>{document.addEventListener('click',outside);document.addEventListener('keydown',keyboard)})
onUnmounted(()=>{document.removeEventListener('click',outside);document.removeEventListener('keydown',keyboard)})
</script>
<template><div ref="container" class="brand-navigation"><button class="brand-menu-toggle" :aria-expanded="mobile" aria-controls="brand-main-menu" aria-label="전체 메뉴" @click="mobile=!mobile"><span></span><span></span><span></span></button><nav id="brand-main-menu" aria-label="주요 메뉴" class="brand-menu" :class="{'mobile-open':mobile}"><ul><li v-for="group in groups" :key="group.key" class="brand-nav-group" :class="{expanded:open===group.key}" @mouseenter="group.items && !mobile && (open=group.key)" @mouseleave="!mobile && (open='')"><div class="brand-nav-title"><a :href="withBase(group.link)" :aria-expanded="group.items?open===group.key:undefined" :aria-haspopup="group.items?'true':undefined" @click="group.items?(open=group.key):close()" @keydown.down.prevent="group.items && first(group)">{{group.text}}</a><button v-if="group.items" class="submenu-toggle" :aria-label="group.text+' 목록 펼치기'" :aria-expanded="open===group.key" :aria-controls="'submenu-'+group.key" @click="open=mobile && open===group.key?'':group.key"><span>⌄</span></button></div><ul v-if="group.items" v-show="open===group.key" :id="'submenu-'+group.key" class="brand-floating-menu" :aria-label="group.text+' 하위 과정'"><li v-for="item in group.items" :key="item.link"><a :href="withBase(item.link)" @click="close">{{item.text}} <span aria-hidden="true">↗</span></a></li></ul></li></ul></nav></div></template>
