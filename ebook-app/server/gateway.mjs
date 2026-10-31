import {byteRange,chunkWindow,LIMITS} from '../shared.mjs';
import {Buffer} from 'node:buffer';
const HEADERS={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
export class HttpError extends Error{constructor(status,message){super(message);this.status=status}}
async function requestObject(request,max=20000){let input;try{input=JSON.parse(new TextDecoder().decode(await boundedBody(request,max)))}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'올바른 JSON 요청이 필요합니다.')}if(!input||Array.isArray(input)||typeof input!=='object'||typeof input.action!=='string'||(input.p!==undefined&&(!input.p||Array.isArray(input.p)||typeof input.p!=='object')))throw new HttpError(400,'요청 형식이 올바르지 않습니다.');return input}
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{...HEADERS,'Content-Type':'application/json;charset=utf-8'}});
export async function digest(buffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function pathFor(a,idx){if(!/^[0-9a-f-]{36}$/.test(a.owner_id)||!/^[0-9a-f-]{36}$/.test(a.book_id)||!/^[0-9a-f-]{36}$/.test(a.id)||!Number.isSafeInteger(idx)||idx<0)throw new HttpError(400,'잘못된 파일 경로입니다.');return `members/${a.owner_id}/${a.book_id}/${a.id}/${String(idx).padStart(5,'0')}.bin`}
async function rpc(env,action,p,auth,internal=false){
 const key=internal?env.SUPABASE_SERVICE_ROLE_KEY:env.SUPABASE_ANON_KEY;
 const response=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${internal?'ebook_internal':'ebook_api'}`,{method:'POST',headers:{apikey:key,...(internal?{Authorization:`Bearer ${key}`}:(auth?{Authorization:auth}:{})),'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p})});
 let result;try{result=await response.json()}catch{throw new HttpError(502,'회원 서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.')}if(!response.ok){if(['PGRST202','PGRST205','42883'].includes(result.code))throw new HttpError(503,'이북 서비스의 서버 설정이 아직 완료되지 않았습니다.');throw new HttpError(result.code==='42501'?403:409,result.code==='42501'?'이북 이용 권한을 확인해 주세요.':result.message||'요청을 처리하지 못했습니다.')}return result;
}
async function github(env,path,options={}){if(path.startsWith('/contents/')&&!options.method&&env.GITHUB_DATA_BRANCH)path+='?ref='+encodeURIComponent(env.GITHUB_DATA_BRANCH);const r=await fetch(`https://api.github.com/repos/${env.GITHUB_DATA_REPO}${path}`,{...options,headers:{Authorization:`Bearer ${env.GITHUB_DATA_TOKEN}`,'User-Agent':'PMOffice-Ebooks','X-GitHub-Api-Version':'2022-11-28',Accept:'application/vnd.github+json',...options.headers}});if(r.status===429||r.status===403)throw new HttpError(503,'GitHub 사용 한도 또는 연결 권한을 확인해 주세요.');return r}
async function requirePrivate(env){if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_DATA_REPO||''))throw new HttpError(503,'비공개 저장소 설정이 필요합니다.');const r=await github(env,'');const d=await r.json();if(!r.ok||d.private!==true)throw new HttpError(503,'고객 파일 저장소는 비공개여야 합니다.');}
function base64(bytes){return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64')}
async function putChunk(env,a,idx,bytes){
 await requirePrivate(env);const object_path=pathFor(a,idx),sha256=await digest(bytes);
 const route='/contents/'+object_path, existing=await github(env,route);let previous;
 if(existing.ok){previous=await existing.json();const raw=await github(env,route,{headers:{Accept:'application/vnd.github.raw+json'}});if(!raw.ok||await digest(await raw.arrayBuffer())!==sha256)throw new HttpError(409,'같은 파일 위치에 다른 데이터가 있습니다.');return rpc(env,'chunk',{asset_id:a.id,idx,bytes:bytes.byteLength,sha256,object_path,git_sha:previous.sha},null,true)}
 if(existing.status!==404)throw new HttpError(503,'저장 상태를 확인하지 못했습니다.');
 const r=await github(env,route,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Store ebook asset chunk',content:base64(new Uint8Array(bytes)),branch:env.GITHUB_DATA_BRANCH||'main'})});
 if(!r.ok)throw new HttpError(r.status===409?409:503,'파일 저장을 완료하지 못했습니다. 잠시 후 같은 조각을 다시 올려 주세요.');
 const saved=await r.json();return rpc(env,'chunk',{asset_id:a.id,idx,bytes:bytes.byteLength,sha256,object_path,git_sha:saved.content.sha},null,true);
}
async function streamAsset(env,a,range){
 let window;try{window=byteRange(range,a.bytes)}catch{return new Response(null,{status:416,headers:{...HEADERS,'Content-Range':`bytes */${a.bytes}`}})}
 if(window.end-window.start+1>8*1024*1024)throw new HttpError(413,'파일은 8 MiB 이하 범위로 나누어 요청해 주세요.');
 await rpc(env,'delivery',{bytes:window.end-window.start+1},null,true);
 await requirePrivate(env);
 const chunks=chunkWindow(a.chunks,window.start,window.end);let at=0;
 // Fetch one protected chunk at a time; no GitHub download URL is returned to the reader.
 const body=new ReadableStream({async pull(controller){try{if(at>=chunks.length){controller.close();return}const c=chunks[at++];const r=await github(env,'/contents/'+c.object_path,{headers:{Accept:'application/vnd.github.raw+json'}});if(!r.ok)throw Error('storage');const bytes=await r.arrayBuffer();if(bytes.byteLength!==c.bytes||await digest(bytes)!==c.sha256)throw Error('integrity');controller.enqueue(new Uint8Array(bytes,c.start,c.end-c.start+1));}catch{controller.error(Error('파일 전달이 중단되었습니다.'))}}});
 return new Response(body,{status:window.status,headers:{...HEADERS,'Content-Type':a.mime,'Content-Length':String(window.end-window.start+1),'Accept-Ranges':'bytes',...(window.status===206?{'Content-Range':`bytes ${window.start}-${window.end}/${a.bytes}`}:{}) ,'Content-Disposition':a.kind==='source'?'attachment; filename="original.'+(a.mime==='application/pdf'?'pdf':'pptx')+'"':'inline'}});
}
async function workerAuth(request,env){const value=request.headers.get('Authorization')||'';if(!env.CONVERTER_TOKEN||!value.startsWith('Bearer ')||await digest(new TextEncoder().encode(value.slice(7)))!==await digest(new TextEncoder().encode(env.CONVERTER_TOKEN)))throw new HttpError(403,'변환 프로그램 인증에 실패했습니다.');}
export async function handle(request,env){
 try{
 const url=new URL(request.url),auth=request.headers.get('Authorization');
 // Only enable after custom-domain DNS and HTTPS have been verified.
 if(env.CANONICAL_HOST==='ebooks.pmoffice.co.kr'&&url.hostname.endsWith('.pages.dev')){
  if(!['GET','HEAD'].includes(request.method))throw new HttpError(403,'피엠오피스 이북 주소로 다시 접속해 주세요.');
  const destination=new URL(url.pathname+url.search,'https://ebooks.pmoffice.co.kr');
  return new Response(null,{status:307,headers:{...HEADERS,Location:destination.href}});
 }

 if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
 if(request.method!=='GET'&&request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)throw new HttpError(403,'허용되지 않은 요청 출처입니다.');
 if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY)throw new HttpError(503,'회원 서비스 연결 설정이 필요합니다.');
 if(url.pathname==='/api/config'&&request.method==='GET')return json({supabaseUrl:env.SUPABASE_URL,supabaseKey:env.SUPABASE_ANON_KEY,appOrigin:url.origin});
 if(url.pathname==='/api/storage-health'&&request.method==='GET'){
  const account=await rpc(env,'session',{},auth);if(!account.admin)throw new HttpError(403,'관리자 권한이 필요합니다.');await requirePrivate(env);
  const repo=await (await github(env,'')).json();const response=await fetch('https://api.github.com/rate_limit',{headers:{Authorization:`Bearer ${env.GITHUB_DATA_TOKEN}`,'User-Agent':'PMOffice-Ebooks',Accept:'application/vnd.github+json'}});if(!response.ok)throw new HttpError(503,'GitHub 요청량을 확인하지 못했습니다.');const rate=await response.json();
  return json({private:repo.private,sizeKiB:repo.size,defaultBranch:repo.default_branch,core:rate.resources.core});
 }
 if(url.pathname==='/api/rpc'&&request.method==='POST'){
  const {action,p={}}=await requestObject(request);
  if(!['session','list','folder_save','create','get','update','share','archive','approve','submit','admin','settings','group_policy'].includes(action))throw new HttpError(400,'잘못된 요청입니다.');
  if(action==='share'&&p.visibility==='link'){const token=crypto.randomUUID()+crypto.randomUUID();p.share_hash=await digest(new TextEncoder().encode(token));const data=await rpc(env,action,p,auth);return json({...data,share_token:token})}
  return json(await rpc(env,action,p,auth));
 }
 if(url.pathname==='/api/upload'&&request.method==='PUT'){
  const idx=Number(url.searchParams.get('idx')),book_id=url.searchParams.get('book');const ticket=await rpc(env,'upload_ticket',{book_id,idx},auth);const bytes=await boundedBody(request,LIMITS.chunkBytes);
  if(bytes.byteLength!==ticket.expected_bytes)throw new HttpError(400,'파일 조각 크기가 맞지 않습니다.');
  return json(await putChunk(env,ticket,idx,bytes));
 }
 if(url.pathname==='/api/asset'&&request.method==='GET'){
  const a=await rpc(env,'asset',{book_id:url.searchParams.get('book'),asset_id:url.searchParams.get('asset'),share_hash:request.headers.get('X-Ebook-Share')},auth);return await streamAsset(env,a,request.headers.get('Range'));
 }
 if(url.pathname.startsWith('/api/worker/')){
  await workerAuth(request,env);
  if(url.pathname==='/api/worker/source'&&request.method==='GET'){
   // The converter must present its still-current lease. No arbitrary storage path is accepted.
   const p=Object.fromEntries(url.searchParams);const a=await rpc(env,'source',p,null,true);return await streamAsset(env,a,request.headers.get('Range'));
  }
  if(url.pathname==='/api/worker/upload'&&request.method==='PUT'){
   const p=Object.fromEntries(url.searchParams);const a=await rpc(env,'asset_ticket',p,null,true);const bytes=await boundedBody(request,LIMITS.chunkBytes);if(bytes.byteLength!==a.expected_bytes)throw new HttpError(400,'결과 조각 크기 오류');return json(await putChunk(env,a,Number(p.idx),bytes));
  }
  if(url.pathname==='/api/worker/rpc'&&request.method==='POST'){
   const {action,p={}}=await requestObject(request,262144);if(!['claim','heartbeat','asset_create','asset_complete','finish','fail'].includes(action))throw new HttpError(400,'처리 요청 오류');return json(await rpc(env,action,p,null,true));
  }
 }
 throw new HttpError(404,'요청한 경로가 없습니다.');
 }catch(error){return json({error:error instanceof HttpError?error.message:'요청을 완료하지 못했습니다.'},error.status||500)}
}
export async function boundedBody(request,max){const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'파일이 없습니다.');const parts=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new HttpError(413,'파일 조각 한도 초과');}parts.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}return bytes.buffer}
export default {fetch:handle};
