<script setup>
import {ref,onMounted} from 'vue'
import {memberRpc} from './member-service.js'
const rows=ref([]),message=ref('')
onMounted(async()=>{try{rows.value=await memberRpc('member_admin_history')}catch(e){message.value=e.message}})
</script><template><main class="member-page"><h1>회원·그룹·권한 변경 이력</h1><p role="status">{{message}}</p><div class="member-history"><table><thead><tr><th>처리</th><th>대상 ID</th><th>관리자·실행자</th><th>시각</th></tr></thead><tbody><tr v-for="r in rows" :key="r.id"><td>{{r.action}} · {{r.state}}</td><td>{{r.target_id}}</td><td>{{r.actor_id}}</td><td>{{new Date(r.created_at).toLocaleString('ko-KR')}}</td></tr></tbody></table></div></main></template>
