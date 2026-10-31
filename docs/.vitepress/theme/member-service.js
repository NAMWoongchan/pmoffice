import {shallowRef} from 'vue'
import {getInquiryClient} from './inquiry-client.js'
import config from './inquiry-public.json'
export const memberSession=shallowRef(null),memberAccount=shallowRef(null),memberProjects=shallowRef([]),memberReady=shallowRef(false)
let startup,generation=0,timer
export const memberClient=getInquiryClient
export async function memberRpc(name,args={}){const {data,error}=await memberClient().rpc(name,args);if(error)throw Error(error.code==='40001'?'다른 변경이 있습니다. 다시 확인해 주세요.':error.code==='23505'?'이미 등록된 항목입니다.':'요청을 완료하지 못했습니다. 입력값과 이용 권한을 확인해 주세요.');return data}
export function safeMemberReturn(value){
 try{const url=new URL(value||'/knowledge/index.html','https://pmoffice.co.kr');if(url.origin!=='https://pmoffice.co.kr'||url.username||url.password)return '/knowledge/index.html';
 if(url.pathname==='/auth/ebook-bridge.html'&&url.searchParams.size===1&&url.searchParams.getAll('state').length===1&&/^[0-9a-f-]{36}$/.test(url.searchParams.get('state')||''))return url.pathname+url.search;
 const valid=/^\/pms\/(?:[a-z][a-z0-9-]{1,47}\/)?$/.test(url.pathname)||['/account.html','/knowledge/index.html','/knowledge/','/project-management.html','/project-management/paradigm-shift.html','/microsoft-project.html','/generative-ai.html','/pc-management/README.html','/pc-management/high-performance-power.html'].includes(url.pathname);
 if(!valid||[...url.searchParams.keys()].some(k=>k!=='post')||url.searchParams.getAll('post').length>1||(url.searchParams.has('post')&&!/^[0-9a-f-]{36}$/i.test(url.searchParams.get('post'))))return '/knowledge/index.html';
 return url.pathname+url.search+url.hash}catch{return '/knowledge/index.html'}
}
export async function refreshMember(){const revision=++generation;try{const {data,error}=await memberClient().auth.getSession();if(error)throw error;memberSession.value=data.session;if(!data.session){memberAccount.value=null;memberProjects.value=[];return}
 const account=await memberRpc('member_account');const projects=account?.member?await memberRpc('pms_catalog'):[];
 if(revision!==generation)return;memberAccount.value=account;memberProjects.value=projects||[];
 }catch{if(revision===generation){memberAccount.value=null;memberProjects.value=[]}}finally{memberReady.value=true}}
export function initializeMember(){if(startup)return startup;startup=(async()=>{const c=memberClient();c.auth.onAuthStateChange((event,session)=>{++generation;memberSession.value=session;memberAccount.value=null;memberProjects.value=[];if(event!=='SIGNED_OUT')setTimeout(refreshMember,0)});await refreshMember();timer=setInterval(refreshMember,30000);window.addEventListener('focus',refreshMember)})();return startup}
export async function memberLogout(){++generation;memberAccount.value=null;memberProjects.value=[];memberSession.value=null;await memberClient().auth.signOut();location.assign('/')}
export async function googleMemberLogin(next='/knowledge/index.html'){sessionStorage.setItem('member-return',safeMemberReturn(next));const {error}=await memberClient().auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/pms/callback.html',queryParams:{prompt:'select_account'}}});if(error)throw Error('Google 로그인을 시작하지 못했습니다.')}
export async function memberApi(body){const {data}=await memberClient().auth.getSession();const response=await fetch(config.url+'/functions/v1/member-admin',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey,...(data.session?{Authorization:'Bearer '+data.session.access_token}:{})},body:JSON.stringify(body),cache:'no-store'});let result;try{result=await response.json()}catch{throw Error('회원 서비스 연결을 확인해 주세요.')}if(!response.ok)throw Error(result.error||'요청을 완료하지 못했습니다.');return result}
export async function memberFile(params){const {data}=await memberClient().auth.getSession();if(!data.session)throw Error('로그인이 필요합니다.');const response=await fetch(config.url+'/functions/v1/member-file?'+new URLSearchParams(params),{headers:{apikey:config.publishableKey,Authorization:'Bearer '+data.session.access_token},cache:'no-store'});if(!response.ok)throw Error('자료 열람 권한을 확인해 주세요.');return response.blob()}
if(import.meta.hot)import.meta.hot.dispose(()=>{clearInterval(timer);if(typeof window!=='undefined')window.removeEventListener('focus',refreshMember)})
