<script setup>
import {ref,onMounted,onUnmounted,watch,nextTick} from 'vue'
import {useRoute} from 'vitepress'
import {memberAccount,memberReady,initializeMember,memberRpc,memberFile} from './member-service.js'
const props=defineProps({path:{default:''}}),route=useRoute()
const rows=ref([]),doc=ref(null),message=ref(''),query=ref(''),results=ref([]),root=ref(null),current=ref(''),loading=ref(false)
let epoch=0,urls=[],loadedPath='',loadedHash=''
function clear(){++epoch;rows.value=[];doc.value=null;results.value=[];for(const url of urls)URL.revokeObjectURL(url);urls=[];loadedPath='';loadedHash=''}
function selectedPath(){const post=new URL(location.href).searchParams.get('post');return post&&/^[0-9a-f-]{36}$/i.test(post)?'/knowledge/index.html?post='+post:props.path}
async function media(id){await nextTick();const images=[...(root.value?.querySelectorAll('img[data-member-media]')||[])];for(let i=0;i<images.length;i+=4){await Promise.all(images.slice(i,i+4).map(async img=>{try{const blob=await memberFile({object:img.dataset.memberMedia});if(id!==epoch)return;const url=URL.createObjectURL(blob);urls.push(url);img.src=url}catch{if(id===epoch)img.alt+=' (이미지를 불러오지 못했습니다.)'}}))}}
async function load(){if(!memberAccount.value?.admin){clear();return}const id=++epoch;loading.value=true;try{
 const path=selectedPath();current.value=path;const list=await memberRpc('member_document_list');
 const data=path.startsWith('/knowledge/index.html?post=')?await memberRpc('member_post_get',{p_id:path.split('=')[1]}):path?await memberRpc('member_document_get',{p_path:path}):null;
 if(id!==epoch)return;rows.value=list||[];message.value='';
 if(path&&!data){clear();message.value='자료가 없거나 열람 권한이 없습니다.';return}
 const hash=data?.source_sha256||data?.body||'';if(path===loadedPath&&hash===loadedHash&&doc.value)return;
 for(const url of urls)URL.revokeObjectURL(url);urls=[];doc.value=data;loadedPath=path;loadedHash=hash;
 if(data?.body_html)await media(id);
 await nextTick();if(location.hash){const target=root.value?.querySelector('[id="'+CSS.escape(decodeURIComponent(location.hash.slice(1)))+'"]');target?.scrollIntoView()}
 }catch(e){if(id===epoch){clear();message.value=e.message}}finally{if(id===epoch)loading.value=false}}
async function search(){if(!memberAccount.value?.admin)return;const id=epoch;try{const data=await memberRpc('member_document_search',{p_query:query.value});if(id===epoch)results.value=data||[]}catch(e){message.value=e.message}}
async function download(params,name){try{const blob=await memberFile(params);if(!memberAccount.value?.admin)return;const url=URL.createObjectURL(blob);urls.push(url);const a=document.createElement('a');a.href=url;a.download=name||'자료';a.click()}catch(e){message.value=e.message}}
function bodyClick(event){const link=event.target.closest('a[data-member-download]');if(link){event.preventDefault();download({object:link.dataset.memberDownload},link.dataset.memberDownload.split('/').pop())}}
watch(()=>memberAccount.value,()=>{if(memberAccount.value?.admin)load();else clear()})
watch(()=>route.path,()=>load())
onMounted(async()=>{await initializeMember();await load()});onUnmounted(clear)
</script>
<template><main class="member-page"><template v-if="!memberReady"><h1>지식 공간</h1><p>로그인 상태를 확인하고 있습니다.</p></template><template v-else-if="!memberAccount?.admin"><h1>관리자 전용 공간</h1><p>지식 공간은 현재 시스템 관리자만 이용할 수 있습니다.</p><a v-if="!memberAccount?.member" class="member-button" :href="'/login.html?returnTo='+encodeURIComponent(path||'/knowledge/index.html')">관리자 로그인</a> <a href="/account.html">내 정보로 이동</a></template>
<div v-else class="knowledge-layout"><aside class="knowledge-sidebar" aria-label="지식 공간 메뉴"><nav class="knowledge-links"><a href="/knowledge/index.html"><strong>지식 공간</strong></a><template v-for="category in [...new Set(rows.map(r=>r.category))]" :key="category"><h3>{{category}}</h3><template v-for="r in rows.filter(r=>r.category===category)" :key="r.path"><a :href="r.path" :class="{active:current===r.path}">{{r.title}}</a><div v-if="current===r.path" class="knowledge-toc"><a v-for="h in r.toc.filter(h=>h.level===2)" :key="h.id" :href="'#'+h.id">{{h.title}}</a></div></template></template></nav><div class="knowledge-search"><form @submit.prevent="search"><label>지식 공간 검색<input v-model="query" type="search" required maxlength="100" placeholder="검색어 입력"></label><button>검색</button></form><div v-if="results.length" class="knowledge-results"><a v-for="r in results" :key="r.path" :href="r.path">{{r.title}}</a></div></div></aside>
<section class="knowledge-body" ref="root" @click="bodyClick"><p role="status" aria-live="polite">{{message}}</p><template v-if="doc"><div v-if="doc.body_html" v-html="doc.body_html"></div><template v-else><h1>{{doc.title}}</h1><div class="knowledge-post">{{doc.body}}</div><button v-for="a in doc.attachments" :key="a.id" class="knowledge-download" @click="download({attachment:a.id},a.file_name)">{{a.file_name}} 내려받기</button></template></template><template v-else-if="!current"><h1>지식 공간</h1><p>프로젝트 관리·MS Project·실전 AI 자료를 읽고 검색할 수 있습니다.</p><article class="knowledge-card" v-for="r in rows" :key="r.path"><h2><a :href="r.path">{{r.title}}</a></h2><p>{{r.category}}</p></article><p v-if="!rows.length&&!loading">표시할 자료가 없습니다.</p></template></section></div></main></template>
