<script setup>
import {ref,onMounted} from 'vue';import {initializeMember,memberClient,memberAccount} from './member-service.js';
const message=ref('홈페이지 로그인 상태를 확인하고 있습니다.');
onMounted(async()=>{const state=new URLSearchParams(location.search).get('state');if(!/^[0-9a-f-]{36}$/.test(state||'')||!window.opener){message.value='이북 생성기에서 홈페이지 로그인 연결을 시작해 주세요.';return}
 await initializeMember();if(!memberAccount.value?.member){location.replace('/login.html?returnTo='+encodeURIComponent('/auth/ebook-bridge.html?state='+state));return}
 const {data}=await memberClient().auth.getSession();if(!data.session){message.value='다시 로그인해 주세요.';return}
 window.opener.postMessage({type:'pmoffice-ebook-session',state,session:{access_token:data.session.access_token,refresh_token:data.session.refresh_token}},'https://ebooks.pmoffice.co.kr');message.value='이북 생성기로 로그인 정보를 전달했습니다. 이 창을 닫아도 됩니다.';
});
</script><template><section style="padding:40px;max-width:600px;margin:auto"><h1>이북 생성기 로그인 연결</h1><p role="status">{{message}}</p></section></template>
