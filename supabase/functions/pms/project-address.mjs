// Public address alias only. Internal data keys and authorization checks stay stable.
export const projectRouteName=slug=>slug==='sk-ulsan-ai-datacenter-epc'?'AIDC_SK':slug
export const projectPublicPath=slug=>/^nexpharm-[0-9a-f]{12}$/.test(slug)?'/pms/nexpharm/?project='+slug:'/pms/'+encodeURIComponent(projectRouteName(slug))+'/'
export const canonicalPmsPath=path=>path.replace(/^\/pms\/(?:sk-ulsan-ai-datacenter-epc|AIDC_SK)\/?(?=#|$)/,'/pms/AIDC_SK/')
