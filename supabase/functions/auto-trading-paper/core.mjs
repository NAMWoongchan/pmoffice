export const ACTIONS=new Set(['LONG_ENTRY','SHORT_ENTRY','LONG_EXIT','SHORT_EXIT']);
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateSignal(p,now=Date.now()){
 const keys=['version','event_id','event','symbol','timeframe','bar_open_ms','event_time_ms','price'];
 if(!p||Array.isArray(p)||Object.keys(p).length!==keys.length||keys.some(k=>!(k in p)))throw Error('신호 필드 오류');
 if(p.version!=='0.11'||p.symbol!=='BINANCE:SOXLUSDT.P'||p.timeframe!=='10S'||!ACTIONS.has(p.event))throw Error('신호 대상 오류');
 if(!Number.isSafeInteger(p.bar_open_ms)||p.bar_open_ms<=0||p.bar_open_ms%10000||!Number.isSafeInteger(p.event_time_ms)||p.event_time_ms<p.bar_open_ms||p.event_time_ms>=p.bar_open_ms+12000||p.event_time_ms>now+2000)throw Error('신호 시각 오류');
 if(p.event_id!==['soxl-0.11',p.symbol,p.timeframe,p.bar_open_ms,p.event].join('|')||typeof p.price==='boolean'||!Number.isFinite(Number(p.price))||Number(p.price)<=0)throw Error('신호 식별자·가격 오류');return p;
}
export async function quoteDemo(fetcher=fetch,clock=Date.now){
 const base='https://demo-fapi.binance.com';
 const get=async route=>{const r=await fetcher(base+route,{signal:AbortSignal.timeout(6500),redirect:'error'});if(!r.ok)throw Error('Demo 시세 연결 실패: '+r.status);return r.json()};
 const [time,mark,info]=await Promise.all([get('/fapi/v1/time'),get('/fapi/v1/premiumIndex?symbol=SOXLUSDT'),get('/fapi/v1/exchangeInfo')]);
 const symbol=info.symbols?.find(x=>x.symbol==='SOXLUSDT');if(symbol?.status!=='TRADING'||symbol.filters?.some(x=>x.filterType==='POSITION_RISK_CONTROL'&&x.positionControlSide!=='NONE'))throw Error('Demo 종목 거래 제한');
 const f=type=>symbol.filters.find(x=>x.filterType===type),lot=f('MARKET_LOT_SIZE'),min=f('MIN_NOTIONAL');
 const q={symbol:'SOXLUSDT',price:mark.markPrice,at_ms:mark.time,server_ms:time.serverTime,step:lot?.stepSize,min_qty:lot?.minQty,max_qty:lot?.maxQty,min_notional:min?.notional,source:'BINANCE DEMO MARK',fee_model:'가상 수수료 0.04% · 펀딩·강제청산·슬리피지 미포함'};
 if([q.price,q.step,q.min_qty,q.max_qty,q.min_notional].some(x=>!Number.isFinite(Number(x))||Number(x)<=0)||!Number.isSafeInteger(q.at_ms)||Math.abs(clock()-q.at_ms)>5000||Math.abs(clock()-q.server_ms)>5000)throw Error('최신 Demo 시세 검증 실패');return q;
}
export async function drain(id,worker,fetcher=fetch){
 let q;try{q=await quoteDemo(fetcher)}catch{return {processed:0,error:'Demo 시세 조회 실패 · 이벤트는 서버 장부에 보존됩니다.'}}
 await worker('quote',{id,quote:q});let count=0;
 for(let round=0;round<3;round++){
 const rows=await worker('next',{id});if(!rows.length)break;let progress=false;
 for(const e of rows){const out=await worker('apply',{id,seq:e.seq,quote:q});if(!['awaiting_exit','already_processed'].includes(out.state)){progress=true;count++}}
 if(!progress)break;
 }return {processed:count};
}
export function createPaperHandler({worker,admin,checkCron,fetcher=fetch,background=p=>p.catch(()=>{})}){return async req=>{
 const origin=req.headers.get('Origin'),allowed=origin==='https://pmoffice.co.kr'||/^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin||'');
 const headers={'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff',...(allowed?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
 const reply=(s,x)=>new Response(JSON.stringify(x),{status:s,headers});
 if(origin&&!allowed)return reply(403,{error:'허용되지 않은 접속 경로입니다.'});if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return reply(405,{error:'POST 요청만 허용됩니다.'});
 try{
 if(Number(req.headers.get('content-length')||0)>8192)return reply(413,{error:'요청 크기 초과'});
 const raw=await req.text();if(raw.length>8192)return reply(413,{error:'요청 크기 초과'});
 const parts=new URL(req.url).pathname.split('/').filter(Boolean);const tv=parts.indexOf('tv');
 if(tv>=0){
 const [tid,revision,secret]=parts.slice(tv+1);if(!id.test(tid||'')||!/^\d+$/.test(revision||'')||!/^[0-9a-f]{64}$/.test(secret||''))return reply(403,{error:'수신 경로 확인 필요'});
 const signal=validateSignal(JSON.parse(raw));const out=await worker('ingest',{id:tid,revision:Number(revision),secret,signal});if(out.state==='queued'||out.state==='awaiting_exit')background(drain(tid,worker,fetcher));return reply(202,out);
 }
 if(parts.at(-1)==='recover'){
 if(!await checkCron(req.headers.get('x-paper-worker')||''))return reply(403,{error:'서버 복구 인증 필요'});
 const ids=await worker('pending',{});background(Promise.allSettled(ids.map(tid=>drain(tid,worker,fetcher))));return reply(202,{queued:ids.length});
 }
 const body=JSON.parse(raw||'{}');const token=req.headers.get('Authorization')||'';
 if(!/^Bearer .+/.test(token))return reply(401,{error:'관리자 로그인이 필요합니다.'});
 const state=await admin(token,'get',{id:body.id});
 if(body.action!=='refresh')return reply(400,{error:'허용되지 않은 작업입니다.'});
 const result=await drain(state.item.id,worker,fetcher);return reply(200,{...result,mode:'SERVER PAPER'});
 }catch{return reply(403,{error:'관리자 권한·전용 주소·신호 형식을 확인해 주세요.'})}
}}
