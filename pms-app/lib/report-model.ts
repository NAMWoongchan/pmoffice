import type {Book,Task} from './workbook';
import {agencies,belongs,displayCell,scheduleNamesFor,scheduleTasks} from './workbook';
import {inYear,metrics,monthlyCounts,state,statusText,monthRange,progressValue} from './task-model';
import {milestoneTasks} from './milestones';
import {isISODate} from './validation';

export type ReportValue=string|number|null;
export type ReportColumn={label:string;kind?:'text'|'date'|'number'|'percent';width?:number};
export type ReportSection={title:string;columns:ReportColumn[];rows:ReportValue[][];chart?:{labelColumn:number;series:{column:number;label:string;color:string}[]};gantt?:{tasks:Task[];months:string[]};note?:string};
export type ReportContext={project:string;source:string;org:string;year:string;basis:string;at:string;version:string;generatedAt?:string};
export type Report={title:string;context:ReportContext;sections:ReportSection[];note?:string};
export const countColumns=[{label:'전체',kind:'number'},{label:'완료',kind:'number'},{label:'남은',kind:'number'},{label:'지연',kind:'number'},{label:'진행 중',kind:'number'},{label:'미착수',kind:'number'},{label:'확인 필요',kind:'number'},{label:'완료율',kind:'percent'}] as ReportColumn[];
const mrow=(tasks:Task[],at:string)=>{const m=metrics(tasks,at);return [m.total,m.done,m.remain,m.late,m.active,m.waiting,m.unknown,m.rate/100];};
export const statusSeries=[{column:2,label:'완료',color:'139f98'},{column:4,label:'지연',color:'db6868'},{column:5,label:'진행 중',color:'3d75d6'},{column:6,label:'미착수',color:'b6c5d6'},{column:7,label:'확인 필요',color:'af8b45'}];
export function taskSection(tasks:Task[],at:string,title='작업 상세 목록'):ReportSection{return {title,columns:[{label:'ID',width:45},{label:'WBS',width:65},{label:'작업 이름',width:250},{label:'참여기관',width:125},{label:'시작',kind:'date',width:82},{label:'완료',kind:'date',width:82},{label:'완료율',kind:'percent',width:60},{label:'기간(일)',kind:'number',width:58},{label:'상태',width:75},{label:'중요 시점',width:65},{label:'작업 구분',width:65},{label:'메모',width:230}],rows:tasks.map(t=>[t.id,t.wbs,t.name,t.org,t.start,t.finish,progressValue(t.pct*100)===null?null:t.pct,Number.isFinite(t.duration)?t.duration:null,statusText[state(t,at)],t.milestone?'Yes':'No',t.summary?'요약':'최하위',t.notes]),note:'전체 검색·필터 결과를 포함합니다. 화면의 페이지당 행 수 제한은 적용하지 않습니다.'};}
export function taskReport(tasks:Task[],context:ReportContext,title='작업 검토',note=''):Report{return {title,context,sections:[taskSection(tasks,context.at)],note};}
export function overviewReport(tasks:Task[],orgs:string[],c:ReportContext):Report{
 const scope=tasks.filter(t=>belongs(t,c.org)),annual=scope.filter(t=>inYear(t,c.year,c.basis));
 const selected=orgs.filter(o=>!c.org||o===c.org);
 return {title:'프로젝트 통합 현황',context:c,sections:[
  {title:'전체 기간 / 선택 연도 KPI',columns:[{label:'기간'},...countColumns],rows:[['전체 기간',...mrow(scope,c.at)],[c.year==='all'?'전체 연도':c.year+'년',...mrow(annual,c.at)]]},
  {title:'참여기관별 전체 기간 작업 현황',columns:[{label:'참여기관',width:160},...countColumns],rows:selected.map(o=>[o,...mrow(tasks.filter(t=>belongs(t,o)),c.at)]),chart:{labelColumn:0,series:statusSeries}},
  {title:`참여기관별 ${c.year==='all'?'전체 연도':c.year+'년'} 작업 현황`,columns:[{label:'참여기관',width:160},...countColumns],rows:selected.map(o=>[o,...mrow(tasks.filter(t=>belongs(t,o)&&inYear(t,c.year,c.basis)),c.at)])},
  taskSection(milestoneTasks(scope).filter(t=>state(t,c.at)!=='done'),c.at,'전체 기간 미완료 마일스톤'),
  taskSection(annual.filter(t=>!t.summary),c.at,'선택 연도 작업 전체')
 ],note:'완료율 100%이며 날짜·완료 정보가 유효한 최하위 작업을 완료로 집계합니다. 상태 범주는 서로 중복되지 않습니다. 공동 작업은 기관별로 포함되며 전체는 중복 제외합니다.'};
}
export function agencyReport(tasks:Task[],c:ReportContext):Report{
 const scope=tasks.filter(t=>belongs(t,c.org)),annual=scope.filter(t=>inYear(t,c.year,c.basis));
 const months=monthlyCounts(annual,c.year,c.at);
 return {title:(c.org||'전체 참여기관')+' 작업 보고',context:c,sections:[
  {title:'전체 기간 / 선택 연도 KPI',columns:[{label:'기간'},...countColumns],rows:[['전체 기간',...mrow(scope,c.at)],[c.year==='all'?'전체 연도':c.year+'년',...mrow(annual,c.at)]]},
  {title:'월별 완료 예정 작업',columns:[{label:'완료 예정월'},{label:'전체',kind:'number'},{label:'완료',kind:'number'}],rows:months.map(m=>[m.month,m.total,m.done]),chart:{labelColumn:0,series:[{column:1,label:'전체',color:'366ed2'},{column:2,label:'완료',color:'139f98'}]}},
  taskSection(annual.filter(t=>!t.summary),c.at)
 ]};
}
export function milestonesReport(tasks:Task[],orgs:string[],years:string[],c:ReportContext):Report{return {title:'사업연도별 마일스톤',context:c,sections:[
 {title:'참여기관 × 사업연도 마일스톤 개수',columns:[{label:'참여기관',width:170},...years.map(y=>({label:y+'년',kind:'number' as const}))],rows:['',...orgs].map(o=>[o||'전체(중복 제외)',...years.map(y=>milestoneTasks(tasks,o,y).length)]),note:'중요 시점 Yes인 최하위 작업을 예정 완료 연도에 집계합니다. 요약 작업은 제외합니다.'},
 taskSection(milestoneTasks(tasks,c.org,c.year),c.at,`${c.org||'전체 참여기관'} · ${c.year==='all'?'전체 연도':c.year+'년'} 마일스톤 상세`)
 ]};}
export function scheduleReport(tasks:Task[],c:ReportContext,title:string,includeGantt=true,note=''):Report{
 return {title,context:c,sections:[...(includeGantt?[{title:'월별 간트 일정표',columns:[],rows:[],gantt:{tasks,months:monthRange(tasks,c.year)}} as ReportSection]:[]),taskSection(tasks,c.at,'일정표 전체 작업')],note:note||'요약 계층을 포함한 해당 일정표의 전체 필터 결과입니다.'};
}
export type DataIssue={task:Task;issue:string};
export function dataIssues(book:Book,at:string):DataIssue[]{const out:DataIssue[]=[];
 for(const t of book.tasks){const add=(issue:string)=>out.push({task:t,issue});
  if(!isISODate(t.start)||!isISODate(t.finish))add('시작 또는 완료일 누락·잘못된 날짜');else if(t.start>t.finish)add('시작일이 완료일보다 늦음');
  if(progressValue(t.pct*100)===null)add('완료율 누락·0~100% 범위 오류');
  if(!Number.isFinite(t.duration)||t.duration<0)add('기간이 유효하지 않음');
  if(t.actualFinish&&(!isISODate(t.actualFinish)||t.actualFinish<t.start||t.pct!==1))add('실제 완료일과 시작일·완료율 불일치');
  if(t.actualFinish&&isISODate(t.actualFinish)&&t.actualFinish>at)add('실제 완료일이 판정 기준일 이후');
  if(!t.summary&&!t.org.trim())add('참여기관 미배정');
 }
 for(const name of scheduleNamesFor(book)){const s=book.sheets.find(s=>s.name===name);if(!s)continue;const seen=new Set<string>();for(let row=2;row<=s.rows;row++){const id=String(s.cells['H'+row]?.v??'');if(!id)continue;const t=book.tasks.find(t=>t.id===id);if(!t)continue;if(seen.has(id))out.push({task:t,issue:`${name} 시트에서 작업 ID 중복`});seen.add(id);}}
 return out;
}
export function qualityReport(book:Book,c:ReportContext):Report{const issues=dataIssues(book,c.at);return {title:'데이터 검토',context:{...c,org:'',year:'all'},sections:[{title:'확인할 데이터',columns:[{label:'ID',width:45},{label:'WBS',width:65},{label:'작업 이름',width:250},{label:'참여기관',width:120},{label:'확인 사항',width:250}],rows:issues.map(i=>[i.task.id,i.task.wbs,i.task.name,i.task.org,i.issue]),note:issues.length?`${issues.length}개 확인 사항. 원본 값은 임의로 보정하지 않습니다.`:'현재 검사 기준에서 날짜·완료율·기간·참여기관 오류가 발견되지 않았습니다.'}]};}
export function rawSheetReport(book:Book,sheetName:string,showHidden:boolean,c:ReportContext):Report{
 const sheet=book.sheets.find(s=>s.name===sheetName)||book.sheets[0];
 if(sheet.cells.A1?.v==='작업 이름')return scheduleReport(scheduleTasks(book,sheet.name),{...c,year:'all',org:sheet.name==='사업 일정표'?'':sheet.name},sheet.name+' 전체 시트');
 const cols=Array.from({length:sheet.cols},(_,i)=>i+1).filter(i=>showHidden||!sheet.hiddenCols.includes(i));
 const col=(n:number):string=>n>26?col(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):String.fromCharCode(64+n);
 return {title:sheet.name+' 표시값 보고',context:{...c,year:'all',org:''},sections:[{title:sheet.name+' 전체 사용 범위',columns:[{label:'행',kind:'number',width:36},...cols.map(i=>({label:col(i),width:110}))],rows:Array.from({length:sheet.rows},(_,i)=>[i+1,...cols.map(j=>displayCell(book,sheet.cells[col(j)+(i+1)]))]),note:'현재 시트 전체 표시값입니다. 원본 수식·매크로·모든 시트 보존은 전체 엑셀 다운로드를 사용하세요.'}]};
}
export function allReports(book:Book,c:ReportContext):Report[]{const orgs=agencies(book.tasks),years=[...new Set(book.tasks.flatMap(t=>[t.start,t.finish]).filter(isISODate).map(s=>s.slice(0,4)))].sort();const all={...c,org:''};return [overviewReport(book.tasks,orgs,all),...orgs.map(org=>agencyReport(book.tasks,{...c,org})),milestonesReport(book.tasks,orgs,years,{...c,org:''}),...scheduleNamesFor(book).map(name=>scheduleReport(scheduleTasks(book,name).filter(t=>inYear(t,c.year,c.basis)),{...c,org:name==='사업 일정표'?'':name},name)),qualityReport(book,c)];}
