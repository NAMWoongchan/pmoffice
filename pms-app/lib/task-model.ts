import type {Task} from './workbook';
import {isISODate} from './validation';

export type WorkState='done'|'late'|'active'|'waiting'|'unknown';
export const statusText:Record<WorkState,string>={done:'완료',late:'지연',active:'진행 중',waiting:'시작 전·미착수',unknown:'확인 필요'};
export function state(t:Task,at:string):WorkState{
 if(!isISODate(at)||!Number.isFinite(t.pct)||t.pct<0||t.pct>1||!isISODate(t.start)||!isISODate(t.finish)||t.start>t.finish)return 'unknown';
 if(t.actualFinish&&(!isISODate(t.actualFinish)||t.actualFinish>at||t.actualFinish<t.start||t.pct!==1))return 'unknown';
 if(t.pct===1)return 'done';
 if(t.finish<at)return 'late';
 if(t.start<=at&&t.pct>0)return 'active';
 return 'waiting';
}
export function metrics(tasks:Task[],at:string){
 const m={total:0,done:0,remain:0,late:0,active:0,waiting:0,unknown:0,rate:0};
 for(const t of tasks)if(!t.summary){m.total++;m[state(t,at)]++;}
 m.remain=m.total-m.done;m.rate=m.total?100*m.done/m.total:0;return m;
}
export function inYear(t:Task,year:string,basis='overlap'){
 if(year==='all')return true;
 if(!/^\d{4}$/.test(year)||!isISODate(t.finish))return false;
 if(basis==='finish')return t.finish.slice(0,4)===year;
 return isISODate(t.start)&&t.start<=t.finish&&t.start<=year+'-12-31'&&t.finish>=year+'-01-01';
}
export function excelDate(n:number,date1904=false){
 if(!Number.isFinite(n)||n<(date1904?0:1)||(!date1904&&Math.floor(n)===60))return '';
 const days=Math.floor(n)-(date1904?24107:n<60?25568:25569);
 const stamp=days*86400000;if(!Number.isFinite(stamp)||Math.abs(stamp)>8640000000000000)return '';
 const value=new Date(stamp).toISOString().slice(0,10);return isISODate(value)?value:'';
}
export const serial=(s:string,date1904=false)=>isISODate(s)?Date.parse(s+'T00:00:00Z')/86400000+(date1904?24107:s<'1900-03-01'?25568:25569):NaN;
export const progressValue=(value:number)=>Number.isFinite(value)&&value>=0&&value<=100?value:null;
export function filterTasks(tasks:Task[],at:string,search='',status='all',sort='wbs'){
 const q=search.trim().toLocaleLowerCase('ko');
 return tasks.filter(t=>(!q||`${t.name} ${t.org} ${t.wbs} ${t.notes}`.toLocaleLowerCase('ko').includes(q))&&(status==='all'||status==='total'||(status==='remain'?state(t,at)!=='done':state(t,at)===status)))
 .sort((a,b)=>sort==='finish'?(isISODate(a.finish)?a.finish:'9999').localeCompare(isISODate(b.finish)?b.finish:'9999')||a.row-b.row:a.wbs.localeCompare(b.wbs,'ko',{numeric:true})||a.row-b.row);
}
export function scheduleRows(tasks:Task[],year:string,basis:string,query='',level='all'){
 const q=query.trim().toLocaleLowerCase('ko');return tasks.filter(t=>inYear(t,year,basis)&&(level==='all'||t.level<=+level)&&(!q||`${t.name} ${t.wbs}`.toLocaleLowerCase('ko').includes(q)));
}
export function monthRange(tasks:Task[],year:string){
 if(/^\d{4}$/.test(year))return Array.from({length:12},(_,i)=>year+'-'+String(i+1).padStart(2,'0'));
 const dates=tasks.flatMap(t=>[t.start,t.finish]).filter(isISODate).sort();if(!dates.length)return [];
 const lo=Number(dates[0].slice(0,4)),hi=Number(dates.at(-1)!.slice(0,4));
 if(hi-lo>29)return [...new Set(dates.map(s=>s.slice(0,7)))];
 return Array.from({length:(hi-lo+1)*12},(_,i)=>`${lo+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`);
}
export function monthlyCounts(tasks:Task[],year:string,at:string){return monthRange(tasks,year).map(month=>{
 const rows=tasks.filter(t=>!t.summary&&isISODate(t.finish)&&t.finish.startsWith(month));return {month,total:rows.length,done:rows.filter(t=>state(t,at)==='done').length};
});}
