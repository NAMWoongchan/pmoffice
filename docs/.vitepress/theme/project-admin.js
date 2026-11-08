export function suggestedProjectSlug(title,existing=[]){
 let slug=String(title||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40).replace(/-$/,'')
 if(!/^[a-z]/.test(slug)||slug.length<2||['app','callback','project','index','admin','assets'].includes(slug))slug='project-'+(slug||'new')
 slug=slug.slice(0,40);let candidate=slug,index=2;while(existing.includes(candidate))candidate=slug+'-'+index++;return candidate
}
export const projectManageUrl=slug=>'/admin/#projects?'+(/^nexpharm-[0-9a-f]{12}$/.test(slug)?'workspace=nexpharm&':'')+'project='+encodeURIComponent(slug)
export const projectStatusLabel=status=>({draft:'초안',published:'게시',archived:'보관'})[status]||status
