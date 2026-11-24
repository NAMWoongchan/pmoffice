<script setup>
import {ref,computed,onMounted,onUnmounted,nextTick} from 'vue'
import {tradingApi,tradingOnline,saveTradingSizing} from './auto-trading-client.js'
import {mountTradingDashboard,money,date} from './trading-dashboard.js'
import ServerPaperTrading from './ServerPaperTrading.vue'
import AutoTradingItemEditor from './AutoTradingItemEditor.vue'
const emit=defineEmits(['access-revoked']),rows=ref([]),search=ref(''),filter=ref(''),archived=ref(false),error=ref(''),notice=ref(''),busy=ref(false),id=ref(''),host=ref(null),item=ref(null),form=ref(null),editError=ref(''),pair=ref(null),expanded=ref(new Set())
const paperId=ref('')
let view,timer,disposed=false,loading=false,generation=0,listEpoch=0
const shown=computed(()=>rows.value.filter(x=>(!search.value||[x.name,x.symbol,x.account_alias].join(' ').toLowerCase().includes(search.value.toLowerCase()))&&(!filter.value||(filter.value==='error'?!tradingOnline(x)||(!x.snapshot?.ready&&!!x.last_seen):filter.value==='running'?tradingOnline(x)&&x.snapshot?.entries:tradingOnline(x)&&!x.snapshot?.entries))))
const conditions=value=>Array.isArray(value)?value:[]
async function api(action,p){try{return await tradingApi(action,p)}catch(e){if(e.accessDenied){++listEpoch;++generation;rows.value=[];item.value=null;form.value=null;pair.value=null;view?.destroy();emit('access-revoked')}throw e}}
async function load(force=false){
 if(disposed||loading&&!force)return
 const epoch=++listEpoch;loading=true
 try{const data=await api('list',{archived:archived.value});if(!disposed&&epoch===listEpoch){rows.value=data;error.value=''}}
 catch(e){if(!disposed&&epoch===listEpoch)error.value=e.message}
 finally{if(epoch===listEpoch)loading=false}
}
async function route(){
 const epoch=++generation;++listEpoch;view?.destroy();view=null;pair.value=null;form.value=null;editError.value='';notice.value=''
 paperId.value=new URLSearchParams(location.hash.split('?')[1]||'').get('paper')||'';id.value=new URLSearchParams(location.hash.split('?')[1]||'').get('trading')||'';item.value=null;error.value=''
 if(paperId.value)return;
 if(!id.value){await load(true);return}
 const selectedId=id.value
 try{const data=await api('get',{id:selectedId});if(disposed||epoch!==generation)return;item.value=data.item;await nextTick();if(!host.value)return
 view=mountTradingDashboard(host.value,{
 getStatus:async()=>{const fresh=await api('get',{id:selectedId});if(epoch===generation&&!disposed)item.value=fresh.item;return {...fresh.item.snapshot,requested_sizing:fresh.item.sizing,sizing_version:fresh.item.sizing_version,name:fresh.item.name,last_seen:fresh.item.last_seen,commands:fresh.commands}},
 isOnline:s=>!!s.last_seen&&Date.now()-Date.parse(s.last_seen)<15000,
 getEvents:offset=>api('events',{id:selectedId,offset}),
 setSizing:async(config,version,requestId)=>{try{return await saveTradingSizing(selectedId,version,config,requestId)}catch(e){if(e.accessDenied){++generation;view?.destroy();emit('access-revoked')}throw e}},
 command:(action,p)=>api('command',{id:selectedId,action,command_id:crypto.randomUUID(),...p})
 })}catch(e){if(epoch===generation)error.value=e.message}
}
async function toggleSummary(x){
 if(expanded.value.has(x.id)){expanded.value.delete(x.id);return}
 expanded.value.add(x.id);await editItem(x);await nextTick()
 document.getElementById('at-summary-'+x.id)?.scrollIntoView?.({block:'nearest',inline:'start',behavior:'smooth'})
}
async function editItem(x,focus='name'){
 if(busy.value)return
 if(form.value?.id!==x.id)form.value={id:x.id,name:x.name,description:x.description||'',version:x.version}
 editError.value='';notice.value='';expanded.value.add(x.id);await nextTick()
 const target=document.getElementById((focus==='description'?'at-description-':'at-name-')+x.id)
 target?.focus();target?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'smooth'})
}
function cancelEdit(){if(!busy.value){if(form.value)expanded.value.delete(form.value.id);form.value=null;editError.value=''}}
async function save(){
 if(busy.value||!form.value)return
 const value={...form.value,name:String(form.value.name||'').trim(),description:String(form.value.description||'')}
 if(!value.name||value.name.length>160){editError.value='거래 이름을 1~160자로 입력해 주세요.';return}
 if(value.description.length>200){editError.value='설명은 200자 이내로 입력해 주세요.';return}
 busy.value=true;editError.value='';notice.value='';++listEpoch
 try{
 const data=await api('save',value);if(disposed)return
 rows.value=rows.value.map(x=>x.id===data.id?data:x);if(item.value?.id===data.id)item.value=data
 form.value={id:data.id,name:data.name,description:data.description||'',version:data.version};notice.value='이름과 설명을 저장했습니다.';await load(true)
 }catch(e){editError.value=e.message;if(!e.accessDenied)await load(true)}
 finally{busy.value=false}
}
async function run(fn){if(busy.value)return;busy.value=true;error.value='';try{await fn()}catch(e){error.value=e.message}finally{busy.value=false}}
async function pairCode(){await run(async()=>{pair.value=await api('pair',{id:id.value})})}
async function change(action,x){if(!confirm(x.name+' · '+({'archive':'보관','restore':'복원','disconnect':'PC 연결 해제'}[action])+'할까요?'))return;await run(async()=>{const updated=await api(action,{id:x.id,version:x.version});if(id.value)item.value=updated;expanded.value.delete(x.id);if(form.value?.id===x.id)form.value=null;await load(true)})}
onMounted(()=>{route();window.addEventListener('hashchange',route);timer=setInterval(()=>{if(!id.value)load()},5000)})
onUnmounted(()=>{disposed=true;++generation;++listEpoch;clearInterval(timer);view?.destroy();window.removeEventListener('hashchange',route)})
</script>
<template><main class="at-center"><header><div><span class="at-eyebrow">PMOFFICE · AUTO TRADING</span><h1>Auto Trading 센터</h1><p>모의 자동 거래의 실행 현황과 손익을 확인하고 관리합니다.</p></div><a v-if="id||paperId" href="/admin/#auto-trading">전체 거래 목록</a></header>
<p v-if="error" role="alert">{{error}}</p><p v-if="notice" role="status" class="at-notice">{{notice}}</p>
<template v-if="!id&&!paperId">
<div class="at-toolbar"><label>거래 검색<input v-model="search" placeholder="이름·종목·계정"></label><label>상태<select v-model="filter"><option value="">전체</option><option value="running">실행</option><option value="stopped">중지</option><option value="error">오류·연결 확인</option></select></label><label><input v-model="archived" type="checkbox" @change="load(true)">보관 항목 보기</label></div>
<div class="at-table"><table><thead><tr><th>거래 이름</th><th>진입 조건</th><th>청산 조건</th><th>종목·시간봉</th><th>실행·연결</th><th>보유</th><th>오늘 순손익</th><th>마지막 확인(KST)</th><th>요약</th></tr></thead><tbody>
<template v-for="x in shown" :key="x.id">
<tr :data-trading-id="x.id"><td><a :href="'/admin/#auto-trading?trading='+x.id">{{x.name}}</a><small>{{x.exchange}} · {{x.account_alias}}</small></td>
<td class="at-entry-conditions"><ul v-if="conditions(x.entry_conditions).length" class="at-conditions"><li v-for="(name,n) in x.entry_conditions" :key="n">{{name}}</li></ul><span v-else>확인 가능한 근거 없음</span></td>
<td class="at-exit-conditions"><ul v-if="conditions(x.exit_conditions).length" class="at-conditions"><li v-for="(name,n) in x.exit_conditions" :key="n">{{name}}</li></ul><span v-else>확인 가능한 근거 없음</span></td>
<td>{{x.symbol}} · {{x.timeframe}}</td><td>{{tradingOnline(x)?(x.snapshot?.entries?'실행':'중지'):'연결 확인 필요'}}</td><td>{{x.snapshot?.data_enabled?x.snapshot?.position??'확인 전':'실행 전'}}</td><td>{{x.snapshot?.data_enabled?money(x.snapshot?.performance?.net):'실행 전'}}</td><td>{{date(x.last_seen)}}</td>
<td><button type="button" :aria-expanded="expanded.has(x.id)" :aria-controls="'at-summary-'+x.id" @click="toggleSummary(x)">{{expanded.has(x.id)?'요약 접기':'요약'}}</button></td>
</tr>
<tr v-if="expanded.has(x.id)" class="at-summary-row"><td colspan="9"><div :id="'at-summary-'+x.id" class="at-summary">
<div class="at-summary-grid"><section><h3>진입 조건</h3><ul v-if="conditions(x.entry_conditions).length" class="at-conditions"><li v-for="(name,n) in x.entry_conditions" :key="n">{{name}}</li></ul><p v-else>확인 가능한 근거 없음</p></section>
<section><h3>청산 조건</h3><ul v-if="conditions(x.exit_conditions).length" class="at-conditions"><li v-for="(name,n) in x.exit_conditions" :key="n">{{name}}</li></ul><p v-else>확인 가능한 근거 없음</p></section>
<section><h3>설명</h3><p class="at-description">{{x.description||'등록된 설명이 없습니다.'}}</p></section></div>
<p v-if="x.conditions_source" class="at-condition-source">{{x.conditions_source}}</p>
<AutoTradingItemEditor v-if="form?.id===x.id" v-model="form" :busy="busy" :error="editError" :archive-label="x.archived?'복원':'보관'" @save="save" @cancel="cancelEdit" @archive="change(x.archived?'restore':'archive',x)" />
</div></td></tr></template></tbody></table></div><p v-if="!shown.length">등록된 거래가 없거나 검색 조건에 맞지 않습니다.</p><ServerPaperTrading @access-revoked="emit('access-revoked')" /></template>
<template v-else-if="paperId"><ServerPaperTrading :key="paperId" :selected-id="paperId" @access-revoked="emit('access-revoked')" /></template>
<template v-else><div ref="host"></div><section v-if="item" class="at-settings"><h2>거래 연결 관리</h2><p>Binance 키 입력·계정 준비·HTTPS 연결은 거래 PC의 로컬 화면에서 관리합니다.</p><button type="button" :disabled="busy" @click="pairCode">PC 연결 코드 발급</button><button type="button" :disabled="busy" @click="change('disconnect',item)">PC 연결 해제</button>
<AutoTradingItemEditor v-if="form?.id===item.id" v-model="form" :busy="busy" :error="editError" @save="save" @cancel="cancelEdit" />
<div v-if="pair"><label>거래 PC 관리 화면에 입력할 일회용 코드<input :value="pair.code" readonly aria-label="일회용 PC 연결 코드"></label><p>유효 시각 {{date(pair.expires_at)}} · 한 번만 사용할 수 있습니다.</p></div></section></template>
</main></template>
<style scoped>
.at-center{padding:12px 10px 40px}.at-center header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.at-center h1{font-size:32px;font-weight:750;margin:10px 0}.at-center h2{font-size:21px;font-weight:700}.at-eyebrow{font-size:12px;color:#35628b;letter-spacing:1px}.at-toolbar{display:flex;gap:18px;align-items:end;flex-wrap:wrap;margin:22px 0}.at-center input,.at-center select{display:block;border:1px solid #a8bbcf;border-radius:7px;padding:10px;font:inherit;max-width:100%}.at-center input[type=checkbox]{display:inline}.at-center button{border:1px solid #9bb1c6;border-radius:7px;padding:9px 14px;background:#edf4fb;cursor:pointer;margin:5px}.at-center button:disabled{opacity:.4;cursor:wait}.at-table{overflow:auto}.at-table table{display:table;min-width:1250px;width:100%;border-collapse:collapse}.at-table td,.at-table th{padding:15px 10px;text-align:left;border-bottom:1px solid #d6e1ed;vertical-align:top}.at-table small{display:block;color:#596d82;margin-top:6px}.at-entry-conditions,.at-exit-conditions{min-width:120px}.at-conditions{list-style:none;padding:0;margin:0}.at-conditions li{display:block;margin:0 0 5px;white-space:normal;overflow-wrap:anywhere}.at-summary{box-sizing:border-box;max-width:min(1100px,calc(100vw - 70px));padding:18px;background:#f1f6fc;border:1px solid #cfdeec;border-radius:10px}.at-summary-grid{display:grid;grid-template-columns:1fr 1fr 1.5fr;gap:22px}.at-summary h3{font-size:17px;font-weight:700;margin:0 0 12px}.at-description{white-space:pre-wrap;overflow-wrap:anywhere}.at-condition-source{font-size:12px;color:#5d7187;margin-top:18px}.at-settings{border:1px solid #d2deeb;background:#f4f8fc;border-radius:12px;padding:22px;margin:22px 0}.at-settings label{display:block;margin:12px 0}.at-settings input{width:100%}.at-center [role=alert]{color:#9c2444}.at-notice{color:#17664b}@media(max-width:700px){.at-center header{display:block}.at-center h1{font-size:27px}.at-summary-grid{grid-template-columns:1fr}.at-summary{padding:14px}}
</style>
