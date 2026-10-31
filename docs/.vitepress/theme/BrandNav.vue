<script setup>
import {ref,computed,onMounted,onUnmounted,nextTick} from 'vue'
import {withBase} from 'vitepress'
import education from './education.json'
import aiEducation from './ai-education.json'
import {memberAccount,memberSession,memberProjects,initializeMember,memberLogout} from './member-service.js'
const container=ref(null),open=ref(''),mobile=ref(false)
const publicGroups=[

{key:'about',text:'회사 소개',link:'/about.html',items:[{text:'피엠오피스 소개',link:'/about.html'},{text:'사업 분야',link:'/services.html'},{text:'주요 수행 실적',link:'/consulting/experience.html'},{text:'교육 컨설팅 문의',link:'/contact.html'}]},
{key:'ai',text:'AI 교육',link:'/ai-edu/',items:[{text:'AI 교육 전체 과정',link:'/ai-edu/'},...aiEducation.courses.map(c=>({text:c.title,link:c.path}))]},
{key:'ms',text:'MS Project 교육',link:'/ms-project/',items:[{text:'MS Project 소개',link:'/ms-project/introduction.html'},...education.groups.find(g=>g.key==='ms').items]},
{key:'pm-education',text:'PM 실무 교육',link:'/pm-practice/',items:education.groups.find(g=>g.key==='pm').items},
{key:'consulting',text:'프로젝트 관리 컨설팅',link:'/consulting/',items:[{text:'공정표 작성 대행',link:'/consulting/scheduling.html'},{text:'컨설팅 종합 안내',link:'/consulting/'},{text:'EPC·R&D·글로벌 프로젝트',link:'/consulting/pm.html'},{text:'AI 컨설팅',link:'/consulting/ai/'},{text:'ChatGPT 컨설팅',link:'/consulting/ai/chatgpt.html'},{text:'Microsoft Copilot 컨설팅',link:'/consulting/ai/copilot.html'}]}]
const groups=computed(()=>[...publicGroups,{key:'members',text:'회원 전용',link:memberAccount.value?.member?'/knowledge/index.html':'/login.html',items:[{text:'이북 서비스',link:'/ebooks/'},...(memberAccount.value?.member?[{text:'지식 공간',link:'/knowledge/index.html'},...(memberAccount.value.admin||memberProjects.value.length?[{text:'고객 프로젝트',link:'/pms/'}]:[])]:[])]}])
const close=()=>{open.value='';mobile.value=false}
function outside(event){if(container.value&&!container.value.contains(event.target))close()}
function keyboard(event){if(event.key==='Escape')close()}
async function first(group){open.value=group.key;await nextTick();container.value?.querySelector('#submenu-'+group.key+' a')?.focus()}
onMounted(()=>{initializeMember();document.addEventListener('click',outside);document.addEventListener('keydown',keyboard)})
onUnmounted(()=>{document.removeEventListener('click',outside);document.removeEventListener('keydown',keyboard)})
</script>
<template><div ref="container" class="brand-navigation"><button class="brand-menu-toggle" :aria-expanded="mobile" aria-controls="brand-main-menu" aria-label="전체 메뉴" @click="mobile=!mobile"><span></span><span></span><span></span></button>
<nav id="brand-main-menu" aria-label="주요 메뉴" class="brand-menu" :class="{'mobile-open':mobile}"><ul><li v-for="group in groups" :key="group.key" class="brand-nav-group" :class="{expanded:open===group.key}" @mouseenter="group.items&&!mobile&&(open=group.key)" @mouseleave="!mobile&&(open='')"><div class="brand-nav-title"><button v-if="group.key==='members'&&group.items" class="member-menu-title" :aria-expanded="open===group.key" aria-controls="submenu-members" @click="open=open===group.key?'':group.key" @keydown.down.prevent="first(group)">{{group.text}}</button><a v-else :href="withBase(group.link)" :aria-expanded="group.items?open===group.key:undefined" :aria-haspopup="group.items?'true':undefined" @click="group.items?(open=group.key):close()" @keydown.down.prevent="group.items&&first(group)">{{group.text}}</a><button v-if="group.items" class="submenu-toggle" :aria-label="group.text+' 목록 펼치기'" :aria-expanded="open===group.key" :aria-controls="'submenu-'+group.key" @click="open=open===group.key?'':group.key"><span>⌄</span></button></div><ul v-if="group.items" v-show="open===group.key" :id="'submenu-'+group.key" class="brand-floating-menu" :aria-label="group.text+' 하위 메뉴'"><li v-for="item in group.items" :key="item.link"><a :href="withBase(item.link)" @click="close">{{item.text}}<span aria-hidden="true">↗</span></a></li></ul></li></ul><div class="member-mobile-admin" v-if="memberAccount?.admin"><a href="/admin/" @click="close">시스템 관리</a></div></nav>
<nav class="member-auth" aria-label="회원 메뉴"><template v-if="memberSession"><a v-if="memberAccount?.admin" href="/admin/">시스템 관리</a><a class="member-account-link" href="/account.html">내 정보</a><button @click="memberLogout">로그아웃</button></template><template v-else><a href="/login.html">로그인</a><a href="/signup.html">가입</a></template></nav>
</div></template>
