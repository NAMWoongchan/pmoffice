<script setup>
import {ref,onMounted} from 'vue'
import {adminEbook} from './admin-ebook.js'
import {adminDate} from './admin-navigation.js'
import {memberRpc} from './member-service.js'
const rows=ref([]),message=ref(''),ebookRows=ref([]),ebookError=ref('')
onMounted(async()=>{adminEbook('admin_history').then(v=>{ebookRows.value=v}).catch(()=>{ebookError.value='이북 변경 이력 확인 실패'});try{rows.value=await memberRpc('member_admin_history')}catch(e){message.value=e.message}})
</script><template><main class="member-page"><h1>변경 이력</h1><h2>회원·그룹·권한</h2><p role="status">{{message}}</p><div class="member-history"><table><thead><tr><th>처리</th><th>대상 ID</th><th>관리자·실행자</th><th>시각</th></tr></thead><tbody><tr v-for="r in rows" :key="r.id"><td>{{r.action}} · {{r.state}}</td><td>{{r.target_id}}</td><td>{{r.actor_id}}</td><td>{{adminDate(r.created_at)}}</td></tr></tbody></table></div><h2>이북 운영 조치</h2><p v-if="ebookError" role="alert">{{ebookError}}</p><div class="member-history"><table><thead><tr><th>조치·대상</th><th>실행자</th><th>사유·전후 상태</th><th>시각(KST)</th></tr></thead><tbody><tr v-for="r in ebookRows" :key="r.id"><td>{{r.action}} · {{r.title||r.book_id}}</td><td>{{r.actor_id}}</td><td>{{r.reason}}<p v-if="r.before_state">{{r.before_state.state}} → {{r.after_state?.state}} · 게시 중지 {{r.before_state.suspended?'예':'아니요'}} → {{r.after_state?.suspended?'예':'아니요'}}</p></td><td>{{adminDate(r.created_at)}}</td></tr></tbody></table></div></main></template>
