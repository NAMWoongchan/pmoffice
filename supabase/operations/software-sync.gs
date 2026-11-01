// Additive module for the existing, authorized PMOffice inquiry bridge project.
// Reuses props_(), sign_(), API_URL. Never reads or logs credentials in the UI.
const SW_SHEET_ID='1U4wzlb89jKt6sF8JU8Q0yE0d9xXcaGIMdYYXffA97fM';
const SW_HEADERS=['발급일','고객 지원 작업명','대상','소프트웨어 이름','Admin ID','만기일','만료일까지 남은 기간','수량','단가','합계','메모'];
function swRpc_(action,data){
 const p=props_(),message=JSON.stringify(Object.assign({action:action,ts:Math.floor(Date.now()/1000),nonce:Utilities.getUuid()},data||{}));
 const response=UrlFetchApp.fetch(API_URL+'/rest/v1/rpc/software_sheet_bridge',{method:'post',contentType:'application/json',headers:{apikey:p.PUBLISHABLE_KEY},payload:JSON.stringify({p_message:message,p_signature:sign_(message,p.BRIDGE_SECRET)}),muteHttpExceptions:true});
 if(response.getResponseCode()!==200)throw Error('소프트웨어 동기화 API 확인 필요 ('+response.getResponseCode()+')');return JSON.parse(response.getContentText());
}
function swDate_(v){if(v===''||v===null||v===undefined)return null;let d;if(v instanceof Date)d=v;else{let t=String(v).trim().replace(' ','T').replace(/T(\d):/,'T0$1:');if(t.length===10)t+='T00:00';if(!/Z$|[+-]\d\d:\d\d$/.test(t))t+='+09:00';d=new Date(t);}if(isNaN(d.getTime()))throw Error('날짜 형식 확인 필요');return new Date(Math.round(d.getTime()/60000)*60000).toISOString();}
function swNumber_(v){const n=Number(String(v===null||v===undefined?'':v).replace(/[,₩\s]/g,''));if(!isFinite(n)||n<0)throw Error('수량·단가 형식 확인 필요');return n;}
function swData_(r){return {issued_at:swDate_(r[0]),work_name:String(r[1]||''),target:String(r[2]||''),software_name:String(r[3]||''),admin_id:String(r[4]||''),expires_at:swDate_(r[5]),quantity:swNumber_(r[7]),unit_price:swNumber_(r[8]),memo:String(r[10]||'')};}
function swHash_(data){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(data),Utilities.Charset.UTF_8).map(x=>('0'+(x<0?x+256:x).toString(16)).slice(-2)).join('');}
function swSerial_(v){return v?(new Date(v).getTime()+9*3600000)/86400000+25569:'';}
function swCanonical_(r){return swData_([r.issued_at?new Date(r.issued_at):'',r.work_name,r.target,r.software_name,r.admin_id,r.expires_at?new Date(r.expires_at):'','',r.quantity,r.unit_price,'',r.memo]);}
function swWrite_(ranges){
 const sheet=SpreadsheetApp.openById(SW_SHEET_ID).getSheetByName('시트1');
 ranges.forEach(item=>{const address=item.range.split('!')[1],target=sheet.getRange(address),row=item.values[0];
  if(row.length===1){target.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(String(row[0]||'')).build());return;}
  target.setValues([row.map(v=>typeof v==='string'?'':v)]);
  // Rich text stores user text literally; no formula execution or separate Sheets API activation.
  [[1,4],[10,2],[13,2]].forEach(group=>{const start=group[0],count=group[1];sheet.getRange(target.getRow(),start+1,1,count).setRichTextValues([row.slice(start,start+count).map(v=>SpreadsheetApp.newRichTextValue().setText(String(v==null?'':v)).build())]);});
 });
}
function syncSoftwareIssues(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(25000))return;
 try{
  const book=SpreadsheetApp.openById(SW_SHEET_ID),sheet=book.getSheetByName('시트1');if(!sheet)throw Error('시트1을 찾을 수 없습니다.');
  const headers=sheet.getRange(1,1,1,11).getDisplayValues()[0];if(JSON.stringify(headers)!==JSON.stringify(SW_HEADERS))throw Error('11개 열 이름·순서를 확인해 주세요.');
  let last=sheet.getLastRow(),values=last>1?sheet.getRange(2,1,last-1,15).getValues():[],inputs=[],positions={};
  values.forEach((r,i)=>{const present=[0,1,2,3,4,5,7,8,10].some(c=>r[c]!==''&&r[c]!==null);if(!present&&!r[11])return;const data=swData_(r),hash=swHash_(data),id=String(r[11]||'');inputs.push(Object.assign({id:id||null,version:r[12]||null,row:i+2,changed:hash!==String(r[14]||r[13]||'')},data));if(id){if(positions[id])throw Error('중복된 소프트웨어 행 ID가 있습니다.');positions[id]=i+2;}});
  const result=swRpc_('sync',{rows:inputs});result.created.forEach(x=>{positions[x.id]=Number(x.row);});
  const ranges=[],formulaRows=[],conflictRows=[];
  result.rows.forEach(r=>{let row=positions[r.id];if(!row)row=++last;
   if(r.conflict){const original=values[row-2];if(original){ranges.push({range:"'시트1'!O"+row,values:[[swHash_(swData_(original))]]});conflictRows.push(row);}return;}
   const data=swCanonical_(r),hash=swHash_(data);ranges.push({range:"'시트1'!A"+row+':O'+row,values:[[swSerial_(r.issued_at),r.work_name,r.target,r.software_name,r.admin_id,swSerial_(r.expires_at),'',Number(r.quantity),Number(r.unit_price),'',r.memo,r.id,Number(r.version),hash,'']]});formulaRows.push(row);
  });
  if(last>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),last-sheet.getMaxRows()+100);
  swWrite_(ranges);
  formulaRows.forEach(row=>{sheet.getRange(row,7).setFormula('=IF(F'+row+'="","",INT(F'+row+')-TODAY())');sheet.getRange(row,10).setFormula('=IF(OR(H'+row+'="",I'+row+'=""),"",ROUND(H'+row+'*I'+row+',2))');sheet.getRange(row,11).clearNote();});
  conflictRows.forEach(row=>sheet.getRange(row,11).setNote('웹과 시트에서 동시에 수정되었습니다. /admin/#sw에서 두 값을 확인하고 선택해 주세요. 해결 전 이 행의 추가 편집을 보류해 주세요.'));
  if(sheet.getLastRow()>1)sheet.getRange(2,1,sheet.getLastRow()-1,15).sort({column:1,ascending:false});
 }catch(e){try{swRpc_('error',{error:String(e.message).slice(0,300)});}catch(_){}throw e;}finally{lock.releaseLock();}
}
function onSoftwareIssueEdit(e){if(!e||!e.source||e.source.getId()!==SW_SHEET_ID||!e.range||e.range.getSheet().getName()!=='시트1'||e.range.getLastRow()<2||e.range.getColumn()>11)return;syncSoftwareIssues();}
function installSoftwareSync(){
 if(Session.getEffectiveUser().getEmail().toLowerCase()!=='namwoongchan@gmail.com')throw Error('지정 관리자 계정에서 실행해 주세요.');props_();
 const book=SpreadsheetApp.openById(SW_SHEET_ID),sheet=book.getSheetByName('시트1');if(!sheet)throw Error('시트1을 찾을 수 없습니다.');
 sheet.getRange(1,12,1,4).setValues([['_record_id','_version','_base_hash','_pending_hash']]);sheet.hideColumns(12,4);sheet.setFrozenRows(1);
 const count=Math.max(1,sheet.getMaxRows()-1);sheet.getRange(2,1,count,1).setNumberFormat('yyyy-mm-dd hh:mm');sheet.getRange(2,6,count,1).setNumberFormat('yyyy-mm-dd hh:mm');sheet.getRange(2,8,count,1).setNumberFormat('0.###');sheet.getRange(2,9,count,2).setNumberFormat('₩#,##0.##');
 const filter=sheet.getFilter();if(filter)filter.remove();sheet.getRange(1,1,sheet.getMaxRows(),15).createFilter();
 const triggers=ScriptApp.getProjectTriggers();['onSoftwareIssueEdit','syncSoftwareIssues'].forEach(name=>{triggers.filter(t=>t.getHandlerFunction()===name).forEach(t=>ScriptApp.deleteTrigger(t));});
 ScriptApp.newTrigger('onSoftwareIssueEdit').forSpreadsheet(SW_SHEET_ID).onEdit().create();syncSoftwareIssues();
 console.log('소프트웨어 시트 양방향 동기화 설치 완료. 소프트웨어 정기 실행 없이 수정 이벤트만 사용합니다.');
}
