<script setup>
import {ref,onMounted} from 'vue'
import {memberRpc} from './member-service.js'
import PmsGroups from './PmsGroups.vue'
const projects=ref([]),selected=ref(''),message=ref('')
onMounted(async()=>{try{projects.value=await memberRpc('pms_catalog')}catch(e){message.value=e.message}})
</script><template><main class="member-page"><h1>그룹 관리</h1><p role="status">{{message}}</p><label>연결할 고객 프로젝트<select v-model="selected"><option value="">그룹과 구성원만 관리</option><option v-for="p in projects" :key="p.slug" :value="p.slug">{{p.title}}</option></select></label><PmsGroups :project="selected" :key="selected" /></main></template>
