export function paperMetrics(item){
 const qty=Number(item?.qty||0),entry=Number(item?.entry_price||0),mark=Number(item?.quote?.price||0),wallet=Number(item?.wallet||0),margin=Number(item?.margin||0);
 const fresh=mark>0&&Number.isSafeInteger(Number(item?.quote?.at_ms))&&Date.now()-Number(item.quote.at_ms)<15000;
 const pnl=qty&&fresh?qty*(mark-entry):qty?null:0;
 return {qty,entry,mark,fresh,margin,pnl,roi:qty&&margin&&pnl!==null?pnl/margin*100:qty?null:0,equity:pnl===null?null:wallet+pnl,available:Math.max(0,wallet-margin+(pnl===null?0:Math.min(0,pnl))),net:wallet-Number(item?.initial_cash||0),wallet};
}
export function paperSizingPreview(item,mode,value){
 const v=Number(value),m=paperMetrics(item);if(!(v>0)||!Number.isFinite(v)||mode==='available_percent'&&v>100)return null;
 const total=mode==='available_percent'?m.available*v/100/(1/30+0.0004):v;
 return {notional:total,margin:total/30,fee:total*0.0004};
}
