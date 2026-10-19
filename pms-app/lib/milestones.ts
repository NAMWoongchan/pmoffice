import type {Task} from './workbook';
import {isISODate} from './validation';

export type MilestoneSelection={org:string;year:string};
export const organizationNames=(value:string)=>value.split(/[,;\n]/).map(s=>s.trim()).filter(Boolean);
export const isMilestoneFlag=(value:unknown)=>/^(yes|true|예|1|y)$/i.test(String(value??'').trim());
/** One master task is one milestone; summary rows are never counted twice. */
export function milestoneTasks(tasks:Task[],org='',year='all'):Task[]{
 return tasks.filter(t=>!t.summary&&t.milestone&&(!org||organizationNames(t.org).includes(org))&&(year==='all'||isISODate(t.finish)&&t.finish.slice(0,4)===year))
  .sort((a,b)=>(isISODate(a.finish)?a.finish:'9999').localeCompare(isISODate(b.finish)?b.finish:'9999')||a.row-b.row);
}
export function milestoneAudit(tasks:Task[]){return {
 undated:milestoneTasks(tasks).filter(t=>!isISODate(t.finish)),
 summaries:tasks.filter(t=>t.summary&&t.milestone).length,
};}
export function assertUniqueTaskIds(tasks:Task[]){
 const seen=new Set<string>();for(const t of tasks){if(seen.has(t.id))throw Error(`사업 일정표에 작업 ID ${t.id}가 중복됩니다. ID를 고친 후 다시 게시해 주세요.`);seen.add(t.id);}
}
