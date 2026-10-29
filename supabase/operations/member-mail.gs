// Append to the existing inquiry Apps Script. No new credentials or triggers.
function memberMailRpc_(action,data){
 const p=props_(),message=JSON.stringify(Object.assign({action:action,ts:Math.floor(Date.now()/1000),nonce:Utilities.getUuid()},data||{}));
 const response=UrlFetchApp.fetch(API_URL+'/rest/v1/rpc/member_mail_bridge',{method:'post',contentType:'application/json',headers:{apikey:p.PUBLISHABLE_KEY},payload:JSON.stringify({p_message:message,p_signature:sign_(message,p.BRIDGE_SECRET)}),muteHttpExceptions:true});
 if(response.getResponseCode()!==200)throw Error('회원 메일 처리 상태 확인 필요');return JSON.parse(response.getContentText());
}
function processMemberMail_(){
 const batch=memberMailRpc_('poll');
 for(const item of batch){
  if(MailApp.getRemainingDailyQuota()<1)return;
  const claim=memberMailRpc_('claim',{id:item.id});if(!claim.claimed)continue;
  let state='sent',error='';
  try{MailApp.sendEmail({to:item.recipient,subject:item.subject,body:item.body,name:'피엠오피스(nam@pmoffice.co.kr)',replyTo:'nam@pmoffice.co.kr'});}
  catch(e){const rejected=/Invalid email|Invalid argument|Limit exceeded|daily quota|Service invoked too many times/i.test(String(e.message));state=rejected?'failed':'unknown';error=rejected?'발송 한도 또는 수신자 입력 확인 필요':'발송 결과 확인 필요';}
  try{memberMailRpc_('result',{id:item.id,claim_id:claim.claim_id,state:state,error:error});}
  catch(_){/* A stale sending claim becomes unknown; never automatically resend. */}
 }
}
