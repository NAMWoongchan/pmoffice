import {createClient} from '@supabase/supabase-js'
import config from './inquiry-public.json'
let client
export function getInquiryClient(){if(!config.url||!config.publishableKey)throw Error('현재 문의 접수를 준비하고 있습니다. 전화로 문의해 주십시오.');return client||(client=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:true}}))}
export async function rpc(name,args={}){const {data,error}=await getInquiryClient().rpc(name,args);if(error)throw Error(error.message.includes('접수')||error.message.includes('입력')||error.message.includes('동시')?error.message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주십시오.');return data}
export const states=['신규','확인 중','처리 완료','보관']
export async function googleLoginAvailable(){const response=await fetch(config.url+'/auth/v1/settings',{headers:{apikey:config.publishableKey}});if(!response.ok)return false;return (await response.json()).external?.google===true}
export const sheetUrl='https://docs.google.com/spreadsheets/d/1c0zLEJ-t_8dni-tX2oc12Wg8LCwsv3l6QYt8NqpkZ3o/edit'
export const formatDate=v=>new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(v))
