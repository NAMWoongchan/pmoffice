import {createClient} from 'npm:@supabase/supabase-js@2.118.0'
import {createPaperHandler} from './core.mjs'
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const c=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const worker=async(action:string,p:object)=>{const {data,error}=await c.rpc('auto_trading_paper_worker',{p_action:action,p});if(error)throw error;return data}
const admin=async(token:string,action:string,p:object)=>{const u=createClient(url,key,{global:{headers:{Authorization:token}},auth:{persistSession:false}});const {data,error}=await u.rpc('auto_trading_paper_admin',{p_action:action,p});if(error)throw error;return data}
const checkCron=async(token:string)=>{const {data,error}=await c.rpc('auto_trading_paper_recovery_auth',{p_token:token});return !error&&data===true}
Deno.serve(createPaperHandler({worker,admin,checkCron,background:(p:Promise<unknown>)=>EdgeRuntime.waitUntil(p.catch(()=>{}))}))
