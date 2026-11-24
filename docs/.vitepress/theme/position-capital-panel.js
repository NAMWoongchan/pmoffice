const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const fmt=(v,d=6)=>num(v)===null?'확인 중':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:d});
const cash=v=>num(v)===null?'확인 중':fmt(v)+' USDT';
const signed=(v,suffix)=>num(v)===null?'확인 중':(Number(v)>0?'+':'')+fmt(v,2)+suffix;
const labelConfig=c=>c?.mode==='available_percent'?'사용 가능 USDT의 '+fmt(c.value,4)+'%':'고정 주문 총액 '+cash(c?.value);
export function mountCapitalPanel(root,adapter){
 root.classList.add('capital-panel');
 const style=el('style');style.textContent=capitalStyles;root.append(style);
 const top=el('div',undefined,'cp-title');top.append(el('h2','현재 포지션 수익 현황'),el('span','미실현 손익 · USDT','cp-muted'));root.append(top);
 const hero=el('section',undefined,'cp-hero'),badge=el('span','','cp-badge'),gain=el('strong','확인 중','cp-gain'),roi=el('strong','확인 중','cp-roi'),caption=el('p','진입 원금 대비 수익률 · 수수료·펀딩비 차감 전','cp-muted');
 const metrics=el('div',undefined,'cp-metrics'),cards={};for(const [key,label] of [['principal','투자 원금 · 진입 증거금'],['notional','포지션 총액 · 레버리지 반영'],['entry','평균 진입가'],['mark','현재 평가가격']]){const c=el('div'),value=el('b','확인 중');cards[key]=value;c.append(el('span',label,'cp-muted'),value);metrics.append(c)}
 const trend=el('div',undefined,'cp-trend'),legend=el('p','이 화면에서 확인한 현재 포지션의 수익금 추이','cp-muted'),details=el('p','','cp-detail'),stamp=el('p','','cp-muted');hero.append(badge,gain,roi,caption,metrics,trend,legend,details,stamp);root.append(hero);
 const sizing=el('section',undefined,'cp-sizing'),head=el('div',undefined,'cp-title'),ack=el('span','','cp-ack');head.append(el('h2','다음 진입 투자금'),ack);sizing.append(head);
 const active=el('p','','cp-active'),help=el('p','보유 포지션은 바꾸지 않습니다. 설정은 다음 신규 진입부터 사용합니다.','cp-muted');sizing.append(active,help);
 const modeLabel=el('label','투자금 기준'),mode=el('select');mode.setAttribute('aria-label','다음 진입 투자금 기준');for(const [v,t] of [['fixed_notional','고정 주문 총액 (USDT)'],['available_percent','사용 가능 USDT 비율 (%)']]){const option=el('option',t);option.value=v;mode.append(option)}modeLabel.append(mode);sizing.append(modeLabel);
 const fixedLabel=el('label','주문 총액 (레버리지 포함)'),fixed=el('input');fixed.type='number';fixed.min='0.0001';fixed.max='99999999';fixed.step='0.1';fixed.value='10';fixed.setAttribute('aria-label','고정 주문 총액 USDT');fixedLabel.append(fixed);sizing.append(fixedLabel);
 const controls=el('div',undefined,'cp-percent'),percentLabel=el('label','사용할 자금 비율'),percent=el('input'),range=el('input');percent.type='number';percent.min='0';percent.max='100';percent.step='0.1';percent.value='0';percent.setAttribute('aria-label','투자 비율 숫자 입력');range.type='range';range.min='0';range.max='100';range.step='0.1';range.value='0';range.setAttribute('aria-label','다음 진입 자금 비율');percentLabel.append(percent,el('span','%'));controls.append(percentLabel,range);
 const presets=el('div',undefined,'cp-presets');for(const v of [10,25,50,75,100]){const b=el('button',v+'%');b.type='button';b.onclick=()=>{percent.value=range.value=String(v);dirty=true;preview()};presets.append(b)}controls.append(presets);sizing.append(controls);
 const account=el('p','','cp-muted'),previewBox=el('div',undefined,'cp-preview'),previewValues={};for(const [k,label] of [['budget','사용할 자금 예산'],['margin','예상 진입 증거금'],['fees','예상 진입 수수료'],['exposure','예상 포지션 총액 (30배)']]){const row=el('div'),v=el('b');previewValues[k]=v;row.append(el('span',label),v);previewBox.append(row)}sizing.append(account,previewBox);
 const bar=el('div',undefined,'cp-budget-bar'),fill=el('span');bar.append(fill);bar.setAttribute('aria-hidden','true');sizing.append(bar);
 const formula=el('p','비율 예산 안에서 진입 수수료를 남기고 증거금을 계산합니다. 주문 직전 잔고·가격·수량 단위로 다시 계산하며, 최소 주문·30배 한도 미달/초과 시 주문하지 않습니다.','cp-muted');sizing.append(formula);
 const apply=el('button','다음 진입부터 적용','cp-apply'),notice=el('p','','cp-notice');notice.setAttribute('role','status');sizing.append(apply,notice);root.append(sizing);
 let s,dirty=false,saving=false,request=null,pending=null,initialized=false,points=[],entryKey='',disposed=false,previewWarning=false;
 const draft=()=>({mode:mode.value,value:String(Number(mode.value==='available_percent'?percent.value:fixed.value))});
 const changed=()=>{dirty=true;request=null;preview()};mode.onchange=changed;fixed.oninput=changed;percent.oninput=()=>{range.value=percent.value;changed()};range.oninput=()=>{percent.value=range.value;changed()};
 function preview(){
  const isPercent=mode.value==='available_percent';controls.hidden=!isPercent;fixedLabel.hidden=isPercent;
  const av=num(s?.account?.usdtAvailable),fee=num(s?.sizing_limits?.taker_fee_rate),value=Number(draft().value),valid=Number.isFinite(value)&&value>0&&value<=(isPercent?100:99999999);
  const budget=isPercent&&av!==null?av*value/100:null,notional=isPercent?(budget!==null&&fee!==null&&fee>=0?budget/(1/30+fee):null):(valid?value:null),margin=notional===null?null:notional/30,fees=notional===null||fee===null?null:notional*fee;
  previewValues.budget.textContent=cash(isPercent?budget:(margin===null||fees===null?null:margin+fees));previewValues.margin.textContent=cash(margin);previewValues.fees.textContent=cash(fees);previewValues.exposure.textContent=cash(notional);
  account.textContent='사용 가능 USDT '+cash(av)+' · 실제 주문은 다음 진입 시점의 잔고로 재계산';fill.style.width=Math.max(0,Math.min(100,isPercent?value:av>0?(margin||0)/av*100:0))+'%';
  const max=num(s?.sizing_limits?.notional_cap_30x),over=max!==null&&notional!==null&&notional>=max;
  if(over&&!saving){notice.textContent='현재 예상 금액이 30배 허용 한도를 넘습니다. 투자 비율을 낮춰 주세요.';previewWarning=true}
  else if(!valid&&dirty&&!saving){notice.textContent=isPercent?'투자 비율을 0% 초과 100% 이하로 선택해 주세요.':'주문 총액을 0보다 크게 입력해 주세요.';previewWarning=true}
  else if(previewWarning&&!saving){notice.textContent='';previewWarning=false}
  const online=adapter.isOnline?adapter.isOnline(s||{}):true,pendingVersion=pending?.sizing_version??s?.sizing_version??s?.sizing?.version??0,pcVersion=s?.sizing?.version??-1;
  ack.textContent=pcVersion>=pendingVersion?'PC 적용 완료':'PC 적용 대기';ack.className='cp-ack '+(pcVersion>=pendingVersion?'cp-ok':'cp-pending');
  active.textContent='현재 PC 설정: '+labelConfig(s?.sizing)+' · 30배 · 설정을 저장해도 신규 진입을 자동으로 켜지 않습니다.';
  apply.disabled=!adapter.setSizing||!valid||over||saving||!online||!s?.sizing||pcVersion<pendingVersion;
  if(!adapter.setSizing)apply.textContent='투자금 변경은 피엠오피스 홈페이지에서';else apply.textContent=saving?'저장 중…':'다음 진입부터 적용';
 }
 apply.onclick=async()=>{
  if(apply.disabled||saving)return;const config=draft(),key=JSON.stringify(config);if(!request||request.key!==key)request={key,id:crypto.randomUUID(),version:Number(s.sizing_version??s.sizing.version)};
  saving=true;notice.textContent='설정 저장 중…';preview();
  try{pending=await adapter.setSizing(config,request.version,request.id);if(disposed)return;dirty=false;request=null;notice.textContent='서버에 저장했습니다. PC 적용 완료를 확인해 주세요.';await adapter.refresh?.()}
  catch(e){if(!disposed)notice.textContent=e.message||'저장 결과를 확인하지 못했습니다. 같은 설정으로 재시도할 수 있습니다.'}
  finally{saving=false;if(!disposed)preview()}
 };
 function chart(detail){
  const key=s.active_entry_id||String(detail.entry_price)+'|'+s.position;if(key!==entryKey){entryKey=key;points=[]}
  const t=num(detail.checked_ms),v=num(detail.unrealized);if(t!==null&&v!==null&&points.at(-1)?.time!==t){points.push({time:t,value:v});if(points.length>90)points.shift()}
  trend.replaceChildren();if(points.length<2){trend.append(el('p','평가값이 쌓이면 수익금 추이가 표시됩니다.','cp-muted'));return}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),line=document.createElementNS(ns,'polyline'),zero=document.createElementNS(ns,'line'),values=points.map(x=>x.value),lo=Math.min(0,...values),hi=Math.max(0,...values),span=hi-lo||1;
  svg.setAttribute('viewBox','0 0 600 110');svg.setAttribute('role','img');svg.setAttribute('aria-label','현재 포지션 미실현 수익금 추이');zero.setAttribute('x1','8');zero.setAttribute('x2','592');const y=100-(0-lo)/span*88;zero.setAttribute('y1',y);zero.setAttribute('y2',y);zero.setAttribute('class','cp-zero');line.setAttribute('points',points.map((p,i)=>[8+i*584/(points.length-1),100-(p.value-lo)/span*88].join(',')).join(' '));line.setAttribute('class','cp-line');svg.append(zero,line);trend.append(svg);
 }
 return {update(status){
  s=status;root.hidden=!s?.data_enabled;if(!s)return;
  const current=pending?.sizing??s.requested_sizing??s.sizing;
  if(!initialized||!dirty&&!saving){mode.value=current?.mode||'fixed_notional';if(mode.value==='available_percent')percent.value=range.value=String(current?.value||0);else fixed.value=String(current?.value||10);initialized=true}
  if(pending&&Number(s.sizing?.version)>=pending.sizing_version){pending=null;notice.textContent='PC 적용 완료 · 다음 신규 진입부터 사용합니다.'}
  const qty=num(s.position),p=s.position_detail,known=qty!==null,held=known&&qty!==0,matching=p&&num(p.quantity)===qty;
  hero.className='cp-hero '+(!held?'cp-flat':matching&&Number(p.unrealized)>=0?'cp-profit':'cp-loss');
  badge.textContent=(known?(held?(qty>0?'LONG':'SHORT'):'미보유'):'확인 중')+' · '+(s.symbol||'SOXLUSDT')+' · 30배 격리';
  gain.textContent=held&&matching?(Number(p.unrealized)>0?'+':'')+cash(p.unrealized):held?'평가값 갱신 중':'다음 진입 신호 대기';
  roi.textContent=held&&matching?signed(p.roi_percent,'%'):'—';
  cards.principal.textContent=held&&matching?cash(p.entry_margin):'—';cards.notional.textContent=held&&matching?cash(p.position_value):'—';cards.entry.textContent=held&&matching?cash(p.entry_price):'—';cards.mark.textContent=held&&matching?cash(p.mark_price):'—';
  details.textContent=held&&matching?'가격 수익률 '+signed(p.price_return_percent,'%')+' · 청산 가격 '+(Number(p.liquidation_price)>0?cash(p.liquidation_price):'거래소 제공값 없음')+' · 원금 = 진입가 × 보유 수량 ÷ 30배':'현재 포지션에 들어간 원금과 평가 수익금만 표시합니다.';
  stamp.textContent=p?.checked_ms?'평가 시각 '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',timeStyle:'medium'}).format(new Date(p.checked_ms))+' · 미실현 수익금은 청산 전 변동됩니다.':'';
  if(held&&matching)chart(p);else{trend.replaceChildren();points=[];entryKey=''}preview();
 },destroy(){disposed=true;root.replaceChildren()}};
}
export const capitalStyles='.capital-panel{margin:20px 0 28px}.capital-panel h2{font-size:19px;margin:0;color:#edf5ff}.cp-title{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.cp-muted{font-size:12px!important;color:#a3b6cd!important;line-height:1.65}.cp-hero{border:1px solid #315069;border-radius:18px;padding:25px;background:linear-gradient(120deg,#102e35,#122039)}.cp-hero.cp-loss{background:linear-gradient(120deg,#3a1f35,#172038);border-color:#704151}.cp-hero.cp-flat{background:#152337}.cp-badge{display:inline-block;font-size:12px;letter-spacing:.7px;color:#d3e7f2;border:1px solid #506878;border-radius:24px;padding:6px 12px}.cp-gain{display:block;font-size:clamp(25px,4vw,43px);letter-spacing:-1px;line-height:1.3;margin:18px 0 4px;overflow-wrap:anywhere}.cp-roi{font-size:28px;color:#7df1c9}.cp-loss .cp-roi{color:#ffadb9}.cp-flat .cp-roi{color:#a3b6cd}.cp-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;border-top:1px solid #3d5366;padding-top:20px;margin-top:18px}.cp-metrics b{display:block;font-size:18px;margin-top:7px;overflow-wrap:anywhere}.cp-trend svg{display:block;width:100%;height:110px;margin-top:14px}.cp-zero{stroke:#627587;stroke-dasharray:5 5}.cp-line{fill:none;stroke:#7df1c9;stroke-width:2.5}.cp-loss .cp-line{stroke:#ffadb9}.cp-detail{font-size:12px;line-height:1.8}.cp-sizing{margin-top:20px;border:1px solid #364e6c;border-radius:16px;background:#132339;padding:24px}.cp-ack{font-size:12px;border-radius:20px;padding:5px 10px}.cp-ok{background:#163d37;color:#80e7bf}.cp-pending{background:#4d3a1e;color:#ffce86}.cp-active{font-size:13px}.cp-sizing label{display:block;font-size:13px;margin:16px 0}.cp-sizing select,.cp-sizing input[type=number]{display:block;box-sizing:border-box;width:100%;max-width:380px;color:#f0f7ff;border:1px solid #58718b;background:#0c1a2b;border-radius:8px;padding:10px;font:inherit;margin-top:8px}.cp-percent label{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.cp-percent input[type=number]{width:110px}.cp-percent input[type=range]{display:block;width:100%;height:30px;accent-color:#6ee6c3;cursor:pointer}.cp-presets{display:flex;gap:8px;justify-content:space-between}.cp-presets button{flex:1;font-size:12px!important;padding:8px!important}.cp-preview{display:grid;grid-template-columns:1fr 1fr;gap:12px 25px;padding:18px;background:#0e1c2e;border-radius:12px}.cp-preview>div{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;color:#b3c5dc}.cp-preview b{color:#ecf5ff;font-size:14px}.cp-budget-bar{height:7px;background:#354c63;border-radius:8px;overflow:hidden;margin:16px 0}.cp-budget-bar span{display:block;height:100%;background:#75dfc3;transition:width .2s}.cp-apply{background:#70dfc2!important;color:#073b30!important;font-weight:700!important}.cp-notice{font-size:13px;color:#ffda99!important}.capital-panel [hidden]{display:none!important}@media(max-width:760px){.cp-hero,.cp-sizing{padding:17px}.cp-metrics,.cp-preview{grid-template-columns:1fr 1fr}.cp-preview>div{display:block}.cp-preview b{display:block;margin-top:7px}.cp-presets{gap:4px}}@media(prefers-reduced-motion:reduce){.cp-budget-bar span{transition:none}}';
