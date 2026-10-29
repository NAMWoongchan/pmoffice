import {runWorkbookStage,runWorkbookPipeline} from '../pms/workbook-engine.mjs';
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const endpoint=Deno.env.get('SUPABASE_URL')+'/functions/v1/pms-workbook';
Deno.serve(async request=>{
 const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
 if(request.method!=='POST'||!secret||request.headers.get('authorization')!=='Bearer '+secret)return json({error:'서버 처리 전용 기능입니다.'},403);
 try{
  const body=await request.json();
  if(body.stage!=='pipeline')return json(runWorkbookStage(body.stage,body.input));
  console.info('workbook_phase',body.input?.phase);
  const result=await runWorkbookPipeline(body.input,async input=>{
   const body=JSON.stringify({stage:'pipeline',input}),phase=input.phase;input=null;const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body});
   const value=await r.json();if(!r.ok)throw Object.assign(Error('작업 처리 단계를 완료하지 못했습니다. ('+phase+')'),{status:[400,403,413].includes(r.status)?r.status:503});return value;
  });return json(result);
 }catch(e){return json({error:[400,403,413].includes(e.status)?e.message:'원본 처리 단계를 완료하지 못했습니다.'},[400,403,413].includes(e.status)?e.status:503)}
});
