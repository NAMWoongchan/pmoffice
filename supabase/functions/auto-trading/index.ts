import {createClient} from 'npm:@supabase/supabase-js@2.118.0'
import {createTradingHandler} from './core.mjs'
const url=Deno.env.get('SUPABASE_URL')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const client=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
Deno.serve(createTradingHandler({worker:async(action:string,p:object)=>{
 const {data,error}=await client.rpc('auto_trading_worker',{p_action:action,p});if(error)throw error;return data
}}))
