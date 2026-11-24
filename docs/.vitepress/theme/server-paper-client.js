import {memberClient} from './member-service.js'
export async function paperApi(action,p={}){
 const {data,error}=await memberClient().rpc('auto_trading_paper_admin',{p_action:action,p});
 if(error){const e=Error(error.code==='42501'?'시스템 관리자 권한이 필요합니다.':error.code==='42883'?'서버 모의 거래는 적용 준비 중입니다.':error.code==='40001'?'다른 변경이 있습니다. 새로 확인해 주세요.':error.message||'서버 모의 요청 실패');e.accessDenied=error.code==='42501';throw e}return data;
}
export async function paperRefresh(id){
 const {data,error}=await memberClient().functions.invoke('auto-trading-paper',{body:{action:'refresh',id}});if(error)throw Error('서버 시세·이벤트 실행 결과를 확인하지 못했습니다. 기록을 다시 조회해 주세요.');return data;
}
