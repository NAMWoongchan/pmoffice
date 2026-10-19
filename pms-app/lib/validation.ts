/** Calendar-valid ISO date; Date.parse alone normalizes impossible days. */
export function isISODate(value:string):boolean{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const stamp=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value;
}
export function validateTaskInput(t:{name:string;start:string;finish:string;pct:number;duration:number;actualFinish:string}):string{
 if(!t.name.trim()||!isISODate(t.start)||!isISODate(t.finish)||t.start>t.finish||!Number.isFinite(t.pct)||t.pct<0||t.pct>1||!Number.isFinite(t.duration)||t.duration<0)return '작업명, 실제로 존재하는 시작·완료일(yyyy-mm-dd), 완료율(0–100%), 기간을 확인해 주세요.';
 if(t.actualFinish&&(!isISODate(t.actualFinish)||t.actualFinish<t.start||t.pct!==1))return '실제 완료일은 유효한 날짜이며 시작일 이후여야 합니다. 완료율은 100%로 입력해 주세요.';
 return '';
}
