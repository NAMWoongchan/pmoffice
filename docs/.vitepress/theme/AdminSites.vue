<script setup>
import {ref,onMounted} from 'vue'
import {call,labels} from './pms-client.js'
const rows=ref([]),error=ref(''),loading=ref(true)
async function load(){loading.value=true;try{rows.value=await call('pms_catalog');error.value=''}catch{rows.value=[];error.value='사이트 목록 확인에 실패했습니다.'}finally{loading.value=false}}
onMounted(load)
</script><template><main class="member-page"><h1>Project Online 사이트 현황</h1><p>전체 고객 프로젝트 사이트와 운영 상태를 확인합니다.</p><p v-if="loading" role="status">사이트 목록을 불러오고 있습니다.</p><p v-if="error" role="alert">{{error}} <button @click="load">다시 확인</button></p><div class="admin-site-cards"><a v-for="p in rows" :key="p.slug" :href="'/pms/'+encodeURIComponent(p.slug)+'/'"><span>{{p.customer}}</span><h2>{{p.title}}</h2><p>{{p.description}}</p><p>{{labels[p.access_mode]}} · {{({draft:'초안',published:'게시',archived:'보관'})[p.status]||p.status}}</p><strong>사이트 열기 →</strong></a></div><p v-if="!loading&&!error&&!rows.length">등록된 사이트가 없습니다.</p><a href="/admin/#projects">프로젝트 설정 관리 →</a></main></template><style scoped>.admin-site-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin:24px 0}.admin-site-cards a{border:1px solid #d5e0eb;border-radius:10px;padding:24px;overflow-wrap:anywhere}.admin-site-cards h2{font-size:21px;font-weight:700;margin:12px 0}.admin-site-cards p{margin:12px 0}</style>
