import {memberClient} from './member-service.js'
export async function tradingApi(action,values={}){
 const {data,error}=await memberClient().rpc('auto_trading_admin',{p_action:action,p:values})
 if(error){const e=Error(error.code==='42501'?'관리자 권한이 필요합니다.':error.code==='23505'?'같은 Demo 계정·종목이 이미 등록되어 있습니다.':error.code==='40001'?'다른 변경이 있습니다. 새로 확인해 주세요.':error.message||'센터 요청을 완료하지 못했습니다.');e.accessDenied=error.code==='42501';throw e}return data
}
export const tradingOnline=item=>!!item.last_seen&&Date.now()-Date.parse(item.last_seen)<15000

export async function saveTradingSizing(id,version,config,requestId){
 const {data,error}=await memberClient().rpc('auto_trading_set_sizing',{p_id:id,p_version:version,p_config:config,p_request_id:requestId});
 if(error){const e=Error(error.code==='42501'?'관리자 권한이 필요합니다.':error.code==='40001'?'투자금 설정이 바뀌었습니다. 새로고침 후 확인해 주세요.':error.message||'투자금 적용 요청을 확인하지 못했습니다.');e.accessDenied=error.code==='42501';throw e}return data
}
