import {runWorkbookStage} from '../pms/workbook-engine.mjs';
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
Deno.serve(async request=>{
 const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
 if(request.method!=='POST'||!secret||request.headers.get('authorization')!=='Bearer '+secret)return json({error:'서버 처리 전용 기능입니다.'},403);
 try{const body=await request.json();return json(runWorkbookStage(body.stage,body.input));}catch(e){return json({error:[400,403,413].includes(e.status)?e.message:'원본 처리 단계를 완료하지 못했습니다.'},[400,403,413].includes(e.status)?e.status:503)}
});
