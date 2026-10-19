import {createClient} from '@supabase/supabase-js';
import config from '../docs/.vitepress/theme/inquiry-public.json';
export const auth=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:true}});
export const slug=new URLSearchParams(location.search).get('project')||'';
export async function pmsFetch(path:string,options:RequestInit={}):Promise<Response>{
 const old=new URL(path,location.origin),action=options.method==='POST'?'publish':old.searchParams.has('file')?'file':'meta';
 const url=new URL(config.url+'/functions/v1/pms');url.searchParams.set('project',slug);url.searchParams.set('action',action);
 if(old.searchParams.has('version'))url.searchParams.set('version',old.searchParams.get('version')!);
 const {data,error}=await auth.auth.getSession();if(error)throw error;
 const headers=new Headers(options.headers);headers.set('apikey',config.publishableKey);if(data.session)headers.set('Authorization','Bearer '+data.session.access_token);
 return fetch(url,{...options,headers,cache:'no-store'});
}

