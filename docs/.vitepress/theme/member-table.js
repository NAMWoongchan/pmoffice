export const MEMBER_PAGE_SIZE=100
const dateFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
export function formatMemberDate(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':dateFormat.format(date)}
export function memberLoginLabel(state){return {signed_in:'로그인 중',signed_out:'로그아웃',blocked:'이용 중지'}[state]||'확인 불가'}
