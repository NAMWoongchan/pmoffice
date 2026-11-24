import {memberClient} from './member-service.js'
export async function paperApi(action,p={}){
 const {data,error}=await memberClient().rpc('auto_trading_paper_admin',{p_action:action,p});
 if(error){const e=Error(error.code==='42501'?'시스템 관리자 권한이 필요합니다.':error.code==='42883'?'서버 모의 거래는 적용 준비 중입니다.':error.code==='40001'?'다른 변경이 있습니다. 새로 확인해 주세요.':error.message||'서버 모의 요청 실패');e.accessDenied=error.code==='42501';throw e}return data;
}
async function invoke(action,id){
 const {data,error}=await memberClient().functions.invoke('auto-trading-paper',{body:{action,id}});if(error)throw Error('서버 연결 확인에 실패했습니다. 로그인 상태와 네트워크를 확인해 주세요.');return data;
}
export const paperRefresh=id=>invoke('refresh',id);
export const paperDiagnose=id=>invoke('diagnose',id);
