const origins=new Set(['https://pmoffice.co.kr','http://127.0.0.1:18764','http://localhost:18764'])
const identifier=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i
const allowedSnapshot=new Set(['schema_version','observed_ms','environment','symbol','timeframe','notional','leverage','entries','ready','busy','reason','position','position_detail','account','connections','performance','analytics','active_entry_id','api_key_loaded'])
export function cleanSnapshot(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid snapshot')
 if(value.environment!=='BINANCE DEMO ONLY')throw Error('Demo only')
 return Object.fromEntries(Object.entries(value).filter(([k])=>allowedSnapshot.has(k)))
}
export function createTradingHandler(deps){return async req=>{
 const origin=req.headers.get('Origin');const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'content-type,x-worker-token','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})}
 const reply=(code,data)=>new Response(JSON.stringify(data),{status:code,headers})
 if(origin&&!origins.has(origin))return reply(403,{error:'접속 경로가 허용되지 않습니다.'})
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers})
 if(req.method!=='POST')return reply(405,{error:'허용되지 않은 요청입니다.'})
 try{
 const raw=await req.text();if(raw.length>2*1024*1024)return reply(413,{error:'요청이 너무 큽니다.'})
 const {action,...body}=JSON.parse(raw)
 if(!['pair','sync','claim','ack'].includes(action))return reply(400,{error:'허용되지 않은 작업입니다.'})
 const p={}
 if(action==='pair'){
 if(typeof body.code!=='string'||!/^[0-9a-f-]{36}\.[0-9a-f]{40}$/i.test(body.code))return reply(400,{error:'연결 코드를 확인해 주세요.'})
 if(!/^[0-9a-f]{64}$/.test(body.account_hash||''))return reply(400,{error:'Demo 계정 확인이 필요합니다.'});
 Object.assign(p,{code:body.code,symbol:body.symbol,timeframe:body.timeframe,account_hash:body.account_hash})
 }else{
 const token=req.headers.get('X-Worker-Token');if(!identifier.test(body.id||'')||!token||!/^[0-9a-f]{64}$/.test(token))return reply(401,{error:'PC 연결 인증이 필요합니다.'})
 Object.assign(p,{id:body.id,token})
 if(action==='sync'){
 if(!Number.isSafeInteger(body.revision)||body.revision<1||!Array.isArray(body.events)||body.events.length>200)return reply(400,{error:'상태 형식을 확인해 주세요.'})
 p.revision=body.revision;p.snapshot=cleanSnapshot(body.snapshot)
 p.events=body.events.map(e=>{if(typeof e.event_id!=='string'||e.event_id.length>220||!Number.isSafeInteger(e.revision)||!Number.isSafeInteger(e.received_ms))throw Error('Invalid event');return {event_id:e.event_id,revision:e.revision,received_ms:e.received_ms,seq:e.seq,state:e.state,note:String(e.note||'').slice(0,300),order_json:e.order_json,fills_json:e.fills_json}})
 }else{
 if(!identifier.test(body.command_id||''))return reply(400,{error:'명령을 확인해 주세요.'})
 p.command_id=body.command_id
 if(action==='ack'){if(!['completed','failed','uncertain'].includes(body.state))return reply(400,{error:'명령 결과 형식 오류'});p.state=body.state;p.result=body.result}
 }
 }
 const data=await deps.worker(action,p);return reply(200,data)
 }catch{return reply(403,{error:'연결·권한·입력값을 확인해 주세요.'})}
}}
