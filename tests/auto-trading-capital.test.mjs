import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {mountCapitalPanel} from '../docs/.vitepress/theme/position-capital-panel.js';
const sample=()=>({data_enabled:true,position:'.23',symbol:'SOXLUSDT',active_entry_id:'entry-a',observed_ms:Date.now(),sizing:{mode:'fixed_notional',value:'10',version:0},requested_sizing:{mode:'fixed_notional',value:'10'},sizing_version:0,account:{usdtAvailable:'100',usdtWallet:'1000'},sizing_limits:{taker_fee_rate:'.0004',notional_cap_30x:'10000'},position_detail:{quantity:'.23',entry_price:'40',mark_price:'41',entry_margin:'.3066666667',position_value:'9.43',roi_percent:'75',price_return_percent:'2.5',unrealized:'.23',checked_ms:Date.now()}});
test('capital dashboard separates current profit/principal, plots only observed points, drafts slider without ordering, and waits for PC acknowledgement',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let calls=[];const panel=mountCapitalPanel(root,{setSizing:async(config,version,id)=>{calls.push({config,version,id});return {sizing:config,sizing_version:1}},isOnline:()=>true});
 try{
 let s=sample();panel.update(s);assert.equal(root.querySelector('.cp-roi').textContent,'+75%');assert.match(root.querySelector('.cp-gain').textContent,/0.23 USDT/);assert.match(root.querySelector('.cp-metrics').textContent,/0.306667 USDT/);
 s.position_detail={...s.position_detail,checked_ms:s.position_detail.checked_ms+1000,unrealized:'.30'};panel.update(s);assert.equal(root.querySelectorAll('svg polyline').length,1);
 const mode=root.querySelector('select');mode.value='available_percent';mode.dispatchEvent(new dom.window.Event('change'));const slider=root.querySelector('input[type=range]');slider.value='25';slider.dispatchEvent(new dom.window.Event('input'));assert.equal(calls.length,0);assert.match(root.querySelector('.cp-preview').textContent,/25 USDT/);assert.match(root.querySelector('.cp-preview').textContent,/741.106719 USDT/);
 root.querySelector('.cp-apply').click();await new Promise(r=>setTimeout(r,10));assert.equal(calls.length,1);assert.deepEqual(calls[0].config,{mode:'available_percent',value:'25'});assert.equal(calls[0].version,0);assert.equal(root.querySelector('.cp-ack').textContent,'PC 적용 대기');assert.equal(root.querySelector('.cp-apply').disabled,true);
 s={...s,requested_sizing:calls[0].config,sizing_version:1,sizing:{...calls[0].config,version:1}};panel.update(s);assert.equal(root.querySelector('.cp-ack').textContent,'PC 적용 완료');assert.equal(s.position,'.23');
 s.active_entry_id='entry-b';panel.update(s);assert.equal(root.querySelectorAll('svg polyline').length,0);
 s={...s,position:'0',position_detail:null};panel.update(s);assert.equal(root.querySelector('.cp-roi').textContent,'—');assert.equal(root.querySelector('.cp-gain').textContent,'다음 진입 신호 대기');
 }finally{panel.destroy();dom.window.close()}
});
test('slider rejects zero/out-of-limit previews and renders no position data before explicit activation',()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main'),p=mountCapitalPanel(root,{setSizing:async()=>{},isOnline:()=>true});try{
 let s=sample();s.data_enabled=false;p.update(s);assert.equal(root.hidden,true);s.data_enabled=true;s.sizing_limits.notional_cap_30x='10';p.update(s);const mode=root.querySelector('select');mode.value='available_percent';mode.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelector('.cp-apply').disabled,true);
 const slider=root.querySelector('input[type=range]');slider.value='100';slider.dispatchEvent(new dom.window.Event('input'));assert.equal(root.querySelector('.cp-apply').disabled,true);assert.match(root.querySelector('.cp-notice').textContent,/한도/);
 }finally{p.destroy();dom.window.close()}
});
