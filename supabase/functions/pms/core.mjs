export const validSlug = s => typeof s==='string' && /^[a-z][a-z0-9-]{1,47}$/.test(s) && !['app','callback','project','index','admin','assets'].includes(s);
export const MAX_BYTES=8*1024*1024;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s)}
function unbase64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
export function createHandler({rpc,github,origin='https://pmoffice.co.kr',dataRepo,siteRepo='NAMWoongchan/pmoffice',branch='main'}){
 return async request=>{
 const cors={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-filename, if-match','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Expose-Headers':'ETag,X-Filename'};
 try{
 if(request.headers.get('origin') && request.headers.get('origin')!==origin)fail(403,'허용되지 않은 요청입니다.');
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(!['GET','POST'].includes(request.method))fail(405,'지원하지 않는 요청입니다.');
 const url=new URL(request.url),slug=url.searchParams.get('project'),action=url.searchParams.get('action')||'meta';
 if(!validSlug(slug))fail(400,'프로젝트 주소가 올바르지 않습니다.');
 const auth=request.headers.get('authorization')||'';
 const check=()=>rpc(auth,'pms_access',{p_slug:slug});
 let access=await check();
 if(!access?.allowed)fail(403,'프로젝트 열람 권한이 없습니다. Google 로그인과 회원 권한을 확인해 주세요.');
 const isWrite=request.method==='POST';
 if((isWrite||action==='route')&&!access.admin)fail(403,'관리자만 게시할 수 있습니다.');
 if(!dataRepo||!/^[-\w]+\/[-\w.]+$/.test(dataRepo))fail(503,'비공개 원본 저장소 연결이 필요합니다.');
 // Never serve customer data from a repository that has become public.
 const repo=await github('/repos/'+dataRepo);
 if(repo.private!==true)fail(503,'원본 저장소가 비공개인지 확인해 주세요.');
 const path='projects/'+slug+'/workbook.json',endpoint='/repos/'+dataRepo+'/contents/'+path;
 const current=await github(endpoint+'?ref='+encodeURIComponent(branch),{},true);
 let response;
 if(action==='route'&&isWrite){
 const route='/repos/'+siteRepo+'/contents/docs/pms/'+slug+'/index.md';
 const exists=await github(route+'?ref='+encodeURIComponent(branch),{},true);
 if(exists)response=json({already_exists:true,url:origin+'/pms/'+slug+'/'});
 else{
 const content='---\nlayout: page\nsidebar: false\naside: false\ntitle: 고객 프로젝트\nsearch: false\nhead:\n  - - meta\n    - name: robots\n      content: noindex, nofollow\n---\n<PmsPortal mode="project" project="'+slug+'" />\n';
 const result=await github(route,{method:'PUT',body:{message:'Add PMS project route: '+slug,branch,content:base64(new TextEncoder().encode(content))}});
 await rpc(auth,'pms_log_action',{p_slug:slug,p_action:'route.publish',p_details:{commit:result.commit.sha}});
 response=json({commit:result.commit.sha,url:origin+'/pms/'+slug+'/',status:'deployment_pending'});
 }
 }else if(action==='publish'&&isWrite){
 const claimed=Number(request.headers.get('content-length')||0);if(claimed>MAX_BYTES)fail(413,'최대 8MB까지 게시할 수 있습니다.');
 // Read incrementally so a missing Content-Length cannot allocate an unbounded body.
 const chunks=[];let size=0;const reader=request.body?.getReader();if(!reader)fail(400,'파일이 없습니다.');
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();fail(413,'최대 8MB까지 게시할 수 있습니다.')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 let name;try{name=decodeURIComponent(request.headers.get('x-filename')||'')}catch{fail(400,'파일명이 올바르지 않습니다.')}
 if(!/^[^\\/\x00-\x1f]{1,180}\.(xlsx|xlsm)$/i.test(name)||bytes[0]!==80||bytes[1]!==75)fail(400,'xlsx 또는 xlsm 파일만 게시할 수 있습니다.');
 if(request.headers.get('if-match')!==(current?.sha||'seed'))fail(409,'다른 게시본이 있습니다. 편집본을 다운로드하고 새로고침해 주세요.');
 access=await check();if(!access.admin)fail(403,'관리자 권한이 변경되었습니다.');
 const payload={schema:1,name,at:new Date().toISOString(),size:bytes.length,content:base64(bytes)};
 const result=await github(endpoint,{method:'PUT',body:{message:'Publish workbook: '+slug,branch,content:base64(new TextEncoder().encode(JSON.stringify(payload))),...(current?{sha:current.sha}:{})}});
 let audit=true;try{await rpc(auth,'pms_log_action',{p_slug:slug,p_action:'workbook.publish',p_details:{commit:result.commit.sha,blob:result.content.sha,size,name}})}catch{audit=false}
 response=json({etag:result.content.sha,id:result.commit.sha,name:encodeURIComponent(name),at:payload.at,audit_recorded:audit});
 }else if(action==='file'&&request.method==='GET'){
 if(!current)fail(404,'아직 게시된 원본이 없습니다.');
 const version=url.searchParams.get('version');
 if(version&&!/^[0-9a-f]{40}$/.test(version))fail(400,'잘못된 버전입니다.');
 if(version){
 // A valid commit must have changed THIS project's path; arbitrary repository commits are rejected.
 const commit=await github('/repos/'+dataRepo+'/commits/'+version);
 if(!commit.files?.some(f=>f.filename===path))fail(404,'이 프로젝트의 게시본이 아닙니다.');
 }
 const payload=await github(endpoint+'?ref='+encodeURIComponent(version||branch),{raw:true});
 if(payload.schema!==1||typeof payload.content!=='string'||!Number.isInteger(payload.size)||payload.size>MAX_BYTES)fail(502,'게시 원본 형식을 확인해 주세요.');
 const bytes=unbase64(payload.content);
 if(bytes.length!==payload.size||bytes[0]!==80||bytes[1]!==75)fail(502,'게시 원본 검증에 실패했습니다.');
 if(!(await check())?.allowed)fail(403,'열람 권한이 변경되었습니다.');
 response=new Response(bytes,{headers:{'Content-Type':/\.xlsm$/i.test(payload.name)?'application/vnd.ms-excel.sheet.macroEnabled.12':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Cache-Control':'private, no-store','ETag':current.sha,'X-Filename':encodeURIComponent(payload.name)}});
 }else if(action==='meta'&&request.method==='GET'){
 const commits=current?await github('/repos/'+dataRepo+'/commits?sha='+encodeURIComponent(branch)+'&path='+encodeURIComponent(path)+'&per_page=50'):[];
 const payload=current?await github(endpoint+'?ref='+encodeURIComponent(branch),{raw:true}):null;
 // Only administrators need history. Current data remains protected for every request.
 response=json({canPublish:access.admin,current:current?{etag:current.sha,name:encodeURIComponent(payload.name),at:payload.at}:null,versions:access.admin?commits.map(c=>({id:c.sha,at:c.commit.committer.date,name:encodeURIComponent('게시본.xlsx'),size:0})):[]});
 }else fail(400,'지원하지 않는 요청입니다.');
 for(const [k,v] of Object.entries(cors))response.headers.set(k,v);return response;
 }catch(e){
 const status=[400,401,403,404,409,413,405,503].includes(e.status)?e.status:502;
 const response=json({error:status===502?'저장소 요청을 완료하지 못했습니다. 잠시 후 다시 확인해 주세요.':e.message},status);
 for(const [k,v] of Object.entries(cors))response.headers.set(k,v);return response;
 }
 };
}

