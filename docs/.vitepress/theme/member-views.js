export const MEMBER_VIEWS=[['all','전체 회원'],['new','신규'],['using','이용 중'],['expired','멤버십 만료'],['withdrawn','탈퇴'],['partner','파트너']]
export const memberViewLabel=view=>view==='valid'?'유효 회원':MEMBER_VIEWS.find(v=>v[0]===view)?.[1]||'유효 회원'
const columns=[['display_name','이름'],['email','이메일'],['company','회사/소속'],['position','직함'],['member_kind','회원 구분'],['groups','소속 그룹'],['member_state','이용 상태'],['registered_at','가입일 (KST)'],['last_sign_in_at','마지막 로그인 (KST)'],['login_status','현재 로그인 상태']]
export function memberViewColumns(view){if(!['using','valid'].includes(view))return columns;return columns.filter(c=>!['email','member_kind','member_state','registered_at','last_sign_in_at'].includes(c[0])).flatMap(c=>c[0]==='groups'?[c,['services','서비스 종류']]:[c])}
