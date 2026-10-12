<script setup>
import {ref,onMounted,onUnmounted,nextTick} from 'vue'
import {withBase} from 'vitepress'
import education from './education.json'
const container=ref(null),open=ref(''),mobile=ref(false)
const groups=[{key:'about',text:'피엠오피스 소개',link:'/about.html'},{key:'services',text:'사업 분야',link:'/services.html'},...education.groups,{key:'knowledge',text:'지식 공간',link:'/knowledge/index.html'},{key:'contact',text:'문의',link:'/contact.html'}]
const close=()=>{open.value='';mobile.value=false}
function outside(event){if(container.value&&!container.value.contains(event.target))close()}
function keyboard(event){if(event.key==='Escape')close()}
async function first(group){open.value=group.key;await nextTick();container.value?.querySelector('#submenu-'+group.key+' a')?.focus()}
onMounted(()=>{document.addEventListener('click',outside);document.addEventListener('keydown',keyboard)})
onUnmounted(()=>{document.removeEventListener('click',outside);document.removeEventListener('keydown',keyboard)})
</script>
<template><div ref="container" class="brand-navigation"><button class="brand-menu-toggle" :aria-expanded="mobile" aria-controls="brand-main-menu" aria-label="전체 메뉴" @click="mobile=!mobile"><span></span><span></span><span></span></button><nav id="brand-main-menu" aria-label="주요 메뉴" class="brand-menu" :class="{'mobile-open':mobile}"><ul><li v-for="group in groups" :key="group.key" class="brand-nav-group" :class="{expanded:open===group.key}" @mouseenter="group.items && !mobile && (open=group.key)" @mouseleave="!mobile && (open='')"><div class="brand-nav-title"><a :href="withBase(group.link)" :aria-expanded="group.items?open===group.key:undefined" :aria-haspopup="group.items?'true':undefined" @click="group.items?(open=group.key):close()" @keydown.down.prevent="group.items && first(group)">{{group.text}}</a><button v-if="group.items" class="submenu-toggle" :aria-label="group.text+' 목록 펼치기'" :aria-expanded="open===group.key" :aria-controls="'submenu-'+group.key" @click="open=mobile && open===group.key?'':group.key"><span>⌄</span></button></div><ul v-if="group.items" v-show="open===group.key" :id="'submenu-'+group.key" class="brand-floating-menu" :aria-label="group.text+' 하위 과정'"><li v-for="item in group.items" :key="item.link"><a :href="withBase(item.link)" @click="close">{{item.text}} <span aria-hidden="true">↗</span></a></li></ul></li></ul></nav></div></template>