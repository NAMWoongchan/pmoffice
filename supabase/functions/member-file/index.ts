import {createClient} from 'npm:@supabase/supabase-js@2.118.0'
const origin='https://pmoffice.co.kr'
Deno.serve(async request=>{
 const headers={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey','Cache-Control':'private, no-store'}
 if(request.headers.get('origin')&&request.headers.get('origin')!==origin)return new Response(null,{status:403,headers})
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers})
 if(request.method!=='GET')return new Response(null,{status:405,headers})
 const token=request.headers.get('authorization')||''
 const c=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:token}}})
 try{
  const {data:account,error:accountError}=await c.rpc('member_account');if(accountError||!account?.member)throw Error('forbidden')
  const url=new URL(request.url),object=url.searchParams.get('object'),attachment=url.searchParams.get('attachment')
  let bucket='member-knowledge',path=object||'',filename=path.split('/').pop()||'file'
  if(attachment){const {data,error}=await c.from('attachments').select('object_path,file_name').eq('id',attachment).single();if(error||!data)throw Error('forbidden');path=data.object_path;filename=data.file_name;bucket='member-files'}
  else{const {data,error}=await c.from('member_document_media').select('object_path').eq('object_path',path).single();if(error||!data)throw Error('forbidden')}
  const {data,error}=await c.storage.from(bucket).download(path);if(error||!data)throw Error('forbidden')
  const {data:check,error:checkError}=await c.rpc('member_account');if(checkError||!check?.member)throw Error('forbidden')
  if(object){const {data:row}=await c.from('member_document_media').select('object_path').eq('object_path',path).maybeSingle();if(!row)throw Error('forbidden')}
  else{const {data:row}=await c.from('attachments').select('id').eq('id',attachment).maybeSingle();if(!row)throw Error('forbidden')}
  return new Response(data,{headers:{...headers,'Content-Type':data.type||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(filename)}})
 }catch{return new Response(JSON.stringify({error:'자료 열람 권한을 확인해 주세요.'}),{status:403,headers:{...headers,'Content-Type':'application/json'}})}
})
