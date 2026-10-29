const bulkCompanies=['한국철도공사','샬롬엔지니어링','투아이시스','알에프컴','KTL','국립한국교통대학교'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
export function validateProfile(b){
 if(b.position!==undefined&&(typeof b.position!=='string'||b.position.length>120))fail(400,'직함을 확인해 주세요.');
 if(!['business','individual'].includes(b.kind)||typeof b.name!=='string'||!b.name.trim()||b.name.length>120||typeof b.company!=='string'||b.company.length>200||(b.kind==='business'&&!b.company.trim()))fail(400,'이름과 회사·소속을 확인해 주세요.');
}
export function validatePassword(value){if(typeof value!=='string'||value.length<8||value.length>128)fail(400,'비밀번호는 8자 이상 128자 이하로 입력해 주세요.')}
export function validateEmail(value){if(typeof value!=='string'||value.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))fail(400,'이메일 주소를 확인해 주세요.')}
async function readBody(request){let size=0;const parts=[];const reader=request.body?.getReader();if(!reader)fail(400,'입력값이 없습니다.');while(true){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>64000){await reader.cancel();fail(413,'입력 내용이 너무 큽니다.')}parts.push(x.value)}const bytes=new Uint8Array(size);let i=0;for(const p of parts){bytes.set(p,i);i+=p.length}try{return JSON.parse(new TextDecoder().decode(bytes))}catch{fail(400,'입력 형식을 확인해 주세요.')}}
export function createMemberHandler(deps){return async request=>{
 const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Access-Control-Allow-Origin':deps.origin||'https://pmoffice.co.kr','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
 const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
 let op=null,created=null;
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==(deps.origin||'https://pmoffice.co.kr'))fail(403,'허용되지 않은 요청입니다.');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')fail(405,'지원하지 않는 요청입니다.');
  const b=await readBody(request),action=b.action;
  if(action==='register'){
   validateProfile(b);validateEmail(b.email);validatePassword(b.password);if(b.accept!==true)fail(400,'회원 가입 안내를 확인해 주세요.');
   await deps.rateLimit(request);
   const user=await deps.createUser({email:b.email.trim().toLowerCase(),password:b.password,email_confirm:true,user_metadata:{name:b.name.trim()}});created=user.id;
   const session=await deps.signIn(b.email.trim().toLowerCase(),b.password);
   try{await deps.rpc(session.access_token,'member_complete_registration',{p_name:b.name,p_company:b.company,p_kind:b.kind,p_accept:true})}
   catch{fail(503,'가입 정보 저장을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.')}
   created=null;return response({session});
  }
  const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  const user=await deps.authenticate(token);if(!user)fail(401,'로그인이 필요합니다.');
  const account=await deps.rpc(token,'member_account',{});if(!account?.member)fail(403,'이용 가능한 회원 계정이 아닙니다.');
  if(action==='self-update'){
   validateProfile(b);if(b.email!==undefined)validateEmail(b.email);if(b.password)validatePassword(b.password);
   const changedEmail=b.email&&b.email.toLowerCase()!==user.email?.toLowerCase();
   if(changedEmail||b.password){
    if(account.admin&&changedEmail)fail(400,'관리자 지정 이메일은 이 화면에서 변경할 수 없습니다.');
    await deps.reauthenticate(user,token,b.current_password);
    await deps.updateUser(user.id,{...(changedEmail?{email:b.email.trim().toLowerCase(),email_confirm:true}:{}),...(b.password?{password:b.password}:{})});
   }
   try{await deps.rpc(token,'member_profile_save',{p_user:user.id,p_name:b.name,p_company:b.company,p_kind:b.kind})}
   catch{fail(409,'인증 정보는 저장되었을 수 있습니다. 회원정보를 새로 조회한 후 다시 저장해 주세요.')}
   if(b.position!==undefined)await deps.rpc(token,'member_position_save',{p_user:user.id,p_position:b.position});
   return response({ok:true});
  }
  if(account.admin!==true||!await deps.isAdmin(token))fail(403,'관리자 권한이 필요합니다.');
  if(action==='bulk-preview'){
   if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>100)fail(400,'등록 명단을 확인해 주세요.');const rows=[],emails=new Set();
   for(const row of b.rows){validateProfile(row);validateEmail(row.email);if(!bulkCompanies.includes(row.company))fail(400,'지원하는 기업을 선택해 주세요.');const email=row.email.trim().toLowerCase();if(emails.has(email))fail(400,'중복 이메일을 확인해 주세요.');emails.add(email);
    const found=await deps.rpc(token,'member_bulk_lookup',{p_email:email});const conflict=found&&(found.status!=='active'||found.withdrawn_at||(found.banned_until&&Date.parse(found.banned_until)>Date.now())||found.display_name!==row.name.trim()||found.company!==row.company.trim());
    rows.push({email,existing:!!found,conflict:conflict?'기존 회원정보 또는 이용 상태가 명단과 다릅니다.':''});}return response({rows});
  }
  if(action==='provision-profile'){if(b.password!==undefined)fail(400,'이 등록 방식에는 비밀번호를 입력하지 않습니다.');return response(await provisionMember(deps,token,user,b,{withoutPassword:true}));}
  if(action==='provision')return response(await provisionMember(deps,token,user,b));
  if(!['create','update','password','withdraw'].includes(action)||!UUID.test(b.request_id||''))fail(400,'요청 형식이 올바르지 않습니다.');
  if(action!=='create'&&!UUID.test(b.user_id||''))fail(400,'회원을 선택해 주세요.');
  if(action==='create'||action==='update')validateProfile(b);
  if(action==='create'){validateEmail(b.email);validatePassword(b.password)}
  if(action==='update'&&b.email!==undefined)validateEmail(b.email);
  if(action==='password')validatePassword(b.password);
  op={token,id:b.request_id,action,target:b.user_id||null};
  const previous=await deps.rpc(token,'member_operation',{p_request:op.id,p_action:action,p_target:op.target});
  if(previous.state==='complete')return response({ok:true,user_id:previous.target_id,replayed:true});
  if(action==='create'){
   const existing=await deps.rpc(token,'member_provisioned_user',{p_request:op.id});
   if(existing){op.target=existing}
   else{
    const target=await deps.createUser({email:b.email.trim().toLowerCase(),password:b.password,email_confirm:true,app_metadata:{member_created_by:user.id,member_request_id:op.id},user_metadata:{name:b.name.trim()}});
    created=target.id;op.target=target.id;
   }
   await deps.rpc(token,'member_operation',{p_request:op.id,p_action:action,p_target:op.target});
   await deps.rpc(token,'member_admin_register',{p_user:op.target,p_name:b.name,p_company:b.company,p_kind:b.kind});created=null;
  }else if(action==='withdraw'){
   await deps.rpc(token,'member_admin_withdraw',{p_user:op.target});
   try{await deps.updateUser(op.target,{ban_duration:'876000h'})}catch{await deps.rpc(token,'member_operation',{p_request:op.id,p_action:action,p_target:op.target,p_state:'recovery_required'});op=null;return response({ok:true,warning:'사이트 접근은 차단했습니다. 인증 서비스 이용 중지 상태를 다시 확인해 주세요.'})}
  }else{
   if(action==='password')await deps.updateUser(op.target,{password:b.password});
   else{
    const target=await deps.getUser(op.target);
    if(b.email&&b.email.toLowerCase()!==target.email.toLowerCase()){
     if(target.id===user.id||target.email.toLowerCase()==='namwoongchan@gmail.com')fail(400,'관리자 지정 이메일은 변경할 수 없습니다.');
     await deps.updateUser(op.target,{email:b.email.trim().toLowerCase(),email_confirm:true});
    }
    await deps.rpc(token,'member_profile_save',{p_user:op.target,p_name:b.name,p_company:b.company,p_kind:b.kind});
   }
  }
  await deps.rpc(token,'member_operation',{p_request:op.id,p_action:action,p_target:op.target,p_state:'complete'});
  return response({ok:true,user_id:op.target});
 }catch(e){
  let recovery=false;
  if(created){try{await deps.deleteUser(created)}catch{recovery=true}}
  if(op){try{await deps.rpc(op.token,'member_operation',{p_request:op.id,p_action:op.action,p_target:recovery?op.target:null,p_state:recovery?'recovery_required':'failed'})}catch{}}
  const status=[400,401,403,405,409,413,429,503].includes(e.status)?e.status:400;
  const message=e.status?e.message: ['email_exists','user_already_exists','23505'].includes(e.code)?'이미 등록된 이메일입니다. 기존 회원을 확인해 주세요.':'요청을 처리하지 못했습니다. 입력값과 연결 상태를 확인해 주세요.';
  return response({error:recovery?'계정 정리가 필요합니다. 관리자 처리 이력을 확인해 주세요.':message},status);
 }
}};

// One row per request, no password persistence or invitation/reset-email APIs.
export async function provisionMember(deps,token,actor,b,{withoutPassword=false}={}){
 validateProfile(b);validateEmail(b.email);if(!withoutPassword)validatePassword(b.password);if(!bulkCompanies.includes(b.company))fail(400,'지원하는 기업을 선택해 주세요.');
 if(!UUID.test(b.request_id||'')||!b.position?.trim())fail(400,'직함과 요청 번호를 확인해 주세요.');
 let existing=await deps.rpc(token,'member_bulk_lookup',{p_email:b.email});
 const mine=existing?.provision_request===b.request_id;
 if(existing&&(existing.status!=='active'||existing.withdrawn_at||(existing.banned_until&&Date.parse(existing.banned_until)>Date.now())||(!mine&&(existing.display_name!==b.name.trim()||existing.company!==b.company.trim()))))fail(409,'기존 회원정보 또는 이용 상태가 명단과 다릅니다. 관리자 확인이 필요합니다.');
 const action=!existing||mine?'create':'update';
 const op=await deps.rpc(token,'member_operation',{p_request:b.request_id,p_action:action,p_target:existing?.id||null});
 if(op.state==='complete')return {ok:true,user_id:op.target_id,replayed:true};
 let target=existing?.id;
 try{
  if(!target){const u=await deps.createUser({email:b.email.trim().toLowerCase(),...(!withoutPassword?{password:b.password}:{}),email_confirm:true,app_metadata:{member_created_by:actor.id,member_request_id:b.request_id},user_metadata:{name:b.name.trim()}});target=u.id}
  await deps.rpc(token,'member_operation',{p_request:b.request_id,p_action:action,p_target:target});
  if(action==='create')await deps.rpc(token,'member_admin_register',{p_user:target,p_name:b.name,p_company:b.company,p_kind:b.kind});
  else if(!withoutPassword)await deps.updateUser(target,{password:b.password});
  await deps.rpc(token,'member_profile_save',{p_user:target,p_name:b.name,p_company:b.company,p_kind:b.kind});
  await deps.rpc(token,'member_position_save',{p_user:target,p_position:b.position});
  await deps.rpc(token,'member_bulk_attach',{p_user:target,p_company:b.company});
  if(!withoutPassword&&deps.verifyPassword)await deps.verifyPassword(b.email.trim().toLowerCase(),b.password,target);
  await deps.rpc(token,'member_operation',{p_request:b.request_id,p_action:action,p_target:target,p_state:'complete'});
  return {ok:true,user_id:target};
 }catch{if(target)await deps.rpc(token,'member_operation',{p_request:b.request_id,p_action:action,p_target:target,p_state:'recovery_required'}).catch(()=>{});fail(503,'일부 단계가 저장되었을 수 있습니다. 행 상태를 확인하고 같은 요청 번호로 재시도해 주세요.')}
}
