import {getInquiryClient} from './inquiry-client.js'
import config from './inquiry-public.json'
export const labels={public:'전체 공개',members:'가입 회원',assigned:'지정 회원'}
export const client=getInquiryClient
export async function call(name,args={}){const {data,error}=await client().rpc(name,args);if(error)throw Error(error.code==='40001'?'다른 수정이 있습니다. 새로고침해 주세요.':'요청을 완료하지 못했습니다. 연결 상태와 접근 권한을 확인해 주세요.');return data}
export async function api(slug,action,options={}){
 const {data,error}=await client().auth.getSession();if(error)throw error
 return fetch(config.url+'/functions/v1/pms?project='+encodeURIComponent(slug)+'&action='+action,{...options,cache:'no-store',headers:{apikey:config.publishableKey,...(data.session?{Authorization:'Bearer '+data.session.access_token}:{}),...options.headers}})
}
export async function action(slug,name,options={}){const r=await api(slug,name,options);const data=await r.json();if(!r.ok)throw Error(data.error||'요청에 실패했습니다.');return data}
export function safeReturn(value){return /^\/pms\/(?:[a-z][a-z0-9-]{1,47}\/?)?(?:#[a-z-]+)?$/.test(value||'')?value:'/pms/'}
export async function login(path='/pms/'){sessionStorage.setItem('pms-return',safeReturn(path));const {error}=await client().auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/pms/callback.html'}});if(error)throw error}

