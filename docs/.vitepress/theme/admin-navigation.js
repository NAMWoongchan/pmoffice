export const adminSections = [
 {title:'피엠오피스 회원 관리',items:[['members','멤버십 현황'],['groups','그룹 관리'],['client','고객 문의'],['mail','메일 발송'],['passwords','회원 정보 관리']]},
 {title:'피엠오피스 고객 지원',items:[['pms','Project Online 사이트 현황'],['projects','프로젝트 관리'],['knowledge','지식 관리'],['ebooks','이북 서비스 현황'],['sw','소프트웨어 발급 현황']]},
 {title:'시스템 관리(Administration)',items:[['ai-work','AI 작업 관리'],['history','변경 이력']]}
]
export function adminRoute(hash=''){
 const raw=hash.replace(/^#/,'')
 if(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(raw))return {tab:'client',query:new URLSearchParams({inquiry:raw}),canonical:'#client?inquiry='+raw}
 const [key,query='']=raw.split('?');const tab=adminSections.some(s=>s.items.some(([id])=>id===key))?key:'home'
 return {tab,query:new URLSearchParams(query),canonical:tab==='home'?'':'#'+tab+(query?'?'+query:'')}
}
export const adminDate=v=>v?new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(v)):'—'
