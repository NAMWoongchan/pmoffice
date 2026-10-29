import {createClient} from 'npm:@supabase/supabase-js@2.118.0'
import {createMemberHandler} from './core.mjs'
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
const admin=createClient(url,secret,opts)
const userClient=(token:string)=>createClient(url,key,{...opts,global:{headers:{Authorization:'Bearer '+token}}})
const unwrap=({data,error}:any)=>{if(error)throw error;return data}
const rpc=async(token:string,name:string,args:object)=>unwrap(await userClient(token).rpc(name,args))
Deno.serve(createMemberHandler({rpc,
 verifyPassword:async(email:string,password:string,id:string)=>{const c=createClient(url,key,opts);const {data,error}=await c.auth.signInWithPassword({email,password});if(error||data.user?.id!==id)throw Error('초기 로그인 확인이 필요합니다.');await c.auth.signOut({scope:'local'})},
 authenticate:async(token:string)=>{const {data,error}=await admin.auth.getUser(token);return error?null:data.user},
 isAdmin:async(token:string)=>await rpc(token,'is_admin',{})===true,
 createUser:async(attrs:any)=>unwrap(await admin.auth.admin.createUser(attrs)).user,
 updateUser:async(id:string,attrs:any)=>unwrap(await admin.auth.admin.updateUserById(id,attrs)).user,
 deleteUser:async(id:string)=>unwrap(await admin.auth.admin.deleteUser(id)),
 getUser:async(id:string)=>unwrap(await admin.auth.admin.getUserById(id)).user,
 signIn:async(email:string,password:string)=>unwrap(await createClient(url,key,opts).auth.signInWithPassword({email,password})).session,
 reauthenticate:async(user:any,token:string,password?:string)=>{
  if(password){const c=createClient(url,key,opts);const result=await c.auth.signInWithPassword({email:user.email,password});if(result.error)throw Object.assign(Error('현재 비밀번호를 확인해 주세요.'),{status:403});await c.auth.signOut({scope:'local'});return}
  const payload=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
  if(payload.sub===user.id&&payload.amr?.some((x:any)=>x.method==='oauth'&&Number(x.timestamp)>Date.now()/1000-300))return
  throw Object.assign(Error('현재 비밀번호를 입력하거나 Google로 다시 로그인한 뒤 변경해 주세요.'),{status:403})
 },
 rateLimit:async(request:Request)=>{
  const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||request.headers.get('cf-connecting-ip')||'unknown'
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret+'|'+ip))
  const fingerprint=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('')
  const {error}=await admin.rpc('member_registration_gate',{p_fingerprint:fingerprint});if(error)throw Object.assign(Error('가입 요청이 많습니다. 잠시 후 다시 시도해 주세요.'),{status:429})
 }
}))
