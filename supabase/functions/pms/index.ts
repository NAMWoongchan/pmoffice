import {patchTasksChainedRemote as patchTasks} from './workbook-engine.mjs';
import {createHandler} from './core.mjs';
const supabase=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_ANON_KEY')!;
const token=Deno.env.get('PMS_GITHUB_TOKEN')?.trim();
const handler=createHandler({
 patchTasks:(bytes:Uint8Array,name:string,updates:any,policy:any)=>patchTasks(bytes,name,updates,policy,async(stage:string,input:any)=>{
  const response=await fetch(supabase+'/functions/v1/pms-workbook',{method:'POST',headers:{Authorization:'Bearer '+Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),'Content-Type':'application/json'},body:JSON.stringify({stage,input})});
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'작업 처리 단계를 확인해 주세요.'),{status:[400,403,413].includes(response.status)?response.status:503});return result;
 }),
 origin:Deno.env.get('PMS_ALLOWED_ORIGIN')||'https://pmoffice.co.kr',
 dataRepo:Deno.env.get('PMS_DATA_REPO'),
 siteRepo:Deno.env.get('PMS_SITE_REPO')||'NAMWoongchan/pmoffice',
 branch:'main',
 async rpc(auth:string,name:string,args:object){
  const r=await fetch(supabase+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:auth||'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args)});
  if(!r.ok)throw Object.assign(Error('인증 또는 권한을 확인해 주세요.'),{status:r.status===401?401:403});return r.json();
 },
 async github(path:string,options:any={},missing=false){
  if(!token)throw Object.assign(Error('GitHub 서버 연결이 필요합니다.'),{status:503});
  if(!/^(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+)$/.test(token))throw Object.assign(Error('PMS_GITHUB_TOKEN 값 형식을 확인해 주세요. 토큰 이름이 아닌 발급된 토큰 값을 저장해야 합니다.'),{status:503});
  const r=await fetch('https://api.github.com'+path,{method:options.method||'GET',headers:{Authorization:'Bearer '+token,Accept:options.raw?'application/vnd.github.raw+json':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});
  if(r.status===401)throw Object.assign(Error('GitHub 토큰이 유효하지 않거나 만료되었습니다. 발급한 토큰 전체를 다시 저장해 주세요.'),{status:503});
  if(r.status===403)throw Object.assign(Error('GitHub 접근이 거부되었습니다(403). 토큰 권한·승인 상태 또는 API 사용 한도를 확인해 주세요.'),{status:503});
  if(r.status===404&&!missing)throw Object.assign(Error('GitHub 저장소를 찾거나 열 수 없습니다(404). 토큰에 pmoffice-pms-data 저장소가 선택되어 있는지 확인해 주세요.'),{status:503});
  if(r.status===404&&missing)return null;
  if(!r.ok)throw Object.assign(Error(r.status===409||r.status===422?'동시 게시가 감지되었습니다. 최신본을 확인해 주세요.':'GitHub 저장소 연결을 확인해 주세요.'),{status:r.status===409||r.status===422?409:503});
  return r.json();
 }
});
Deno.serve(handler);

