import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import {assertUniqueTaskIds,isMilestoneFlag,milestoneTasks,organizationNames,type MilestoneSelection} from './milestones';
import {isISODate} from './validation';
import {state,metrics,inYear,excelDate,serial} from './task-model';
export {state,metrics,inYear,excelDate,serial,statusText} from './task-model';

export type Cell={v:any; f?:string; s:number; t?:string};
export type Sheet={name:string;path:string;hidden:boolean;cells:Record<string,Cell>;rows:number;cols:number;merges:string[];widths:Record<number,number>;heights:Record<number,number>;hiddenCols:number[]};
export type Book={name:string;bytes:Uint8Array;files:Record<string,Uint8Array>;sheets:Sheet[];styles:any[];formats:Record<number,string>;tasks:Task[];date1904:boolean;computed?:Change[];milestoneSelection?:MilestoneSelection;milestonePanelEnd?:number};
export type Task={id:string;row:number;name:string;pct:number;duration:number;start:string;finish:string;org:string;wbs:string;level:number;milestone:boolean;summary:boolean;notes:string;predecessors:string;successors:string;actualFinish:string;minutes:number};
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const colName=(n:number):string=>n>26?colName(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):String.fromCharCode(64+n);
export function address(a:string){const m=a.replace(/\$/g,'').match(/^([A-Z]+)(\d+)$/);return m?{c:[...m[1]].reduce((n,v)=>n*26+v.charCodeAt(0)-64,0),r:+m[2]}:{c:1,r:1};}
const xml=(s:string)=>{const d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))throw Error('엑셀 XML을 읽을 수 없습니다.');return d;};
const nodes=(d:Document|Element,n:string)=>Array.from(d.getElementsByTagNameNS('*',n));
export const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
export function parseBook(bytes:Uint8Array,name:string):Book{
 let expanded=0;const files=unzipSync(bytes,{filter:f=>{expanded+=f.originalSize;if(expanded>80*1024*1024)throw Error('압축 해제 크기가 80MB를 초과합니다.');return true;}});
 if(!files['xl/workbook.xml'])throw Error('지원되는 Excel(.xlsx, .xlsm) 파일이 아닙니다.');
 const wb=xml(strFromU8(files['xl/workbook.xml']));const date1904=nodes(wb,'workbookPr')[0]?.getAttribute('date1904')==='1';
 const strings=files['xl/sharedStrings.xml']?nodes(xml(strFromU8(files['xl/sharedStrings.xml'])),'si').map(e=>nodes(e,'t').map(t=>t.textContent).join('').replace(/_x000D_/g,'\n')):[];
 const rels=xml(strFromU8(files['xl/_rels/workbook.xml.rels']));const rel:Record<string,string>={};nodes(rels,'Relationship').forEach(e=>rel[e.getAttribute('Id')!]=e.getAttribute('Target')!);
 const styleDoc=xml(strFromU8(files['xl/styles.xml']));const formats:Record<number,string>={};nodes(styleDoc,'numFmt').forEach(e=>formats[+e.getAttribute('numFmtId')!]=e.getAttribute('formatCode')!);
 const fonts=nodes(styleDoc,'fonts')[0]?.children||[];const fills=nodes(styleDoc,'fills')[0]?.children||[];
 const color=(e:Element|undefined)=>{const c=e?.getAttribute('rgb');return c?'#'+c.slice(-6):undefined;};
 const styles=Array.from(nodes(styleDoc,'cellXfs')[0]?.children||[]).map(e=>{const font=fonts[+e.getAttribute('fontId')!];const fill=fills[+e.getAttribute('fillId')!];const fmt=+e.getAttribute('numFmtId')!;return {fmt,bold:!!font?.querySelector('b'),color:color(font?.querySelector('color')||undefined),background:color(fill?.querySelector('fgColor')||undefined),align:e.querySelector('alignment')?.getAttribute('horizontal'),wrap:e.querySelector('alignment')?.getAttribute('wrapText')==='1'};});
 const sheets=nodes(wb,'sheet').map(e=>{let target=rel[e.getAttribute('r:id')!];const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');const d=xml(strFromU8(files[path]));const cells:Record<string,Cell>={};let maxR=0,maxC=0;
 nodes(d,'c').forEach(c=>{const a=c.getAttribute('r')!;const t=c.getAttribute('t')||'';const txt=nodes(c,'v')[0]?.textContent;let v:any=txt??'';if(t==='s')v=strings[+v]??'';else if(t==='inlineStr')v=nodes(c,'t').map(e=>e.textContent).join('');else if(t==='b')v=v==='1';else if(t!=='str'&&t!=='e'&&v!=='')v=+v;const f=nodes(c,'f')[0]?.textContent||undefined;cells[a]={v,f,s:+(c.getAttribute('s')||0),t};if(v!==''||f){const p=address(a);maxR=Math.max(maxR,p.r);maxC=Math.max(maxC,p.c);}});
 const widths:Record<number,number>={},heights:Record<number,number>={};const hiddenCols:number[]=[];nodes(d,'col').forEach(c=>{for(let i=+c.getAttribute('min')!;i<=Math.min(300,+c.getAttribute('max')!);i++){widths[i]=+(c.getAttribute('width')||10)*7+5;if(c.getAttribute('hidden')==='1')hiddenCols.push(i);}});nodes(d,'row').forEach(r=>{if(r.hasAttribute('ht'))heights[+r.getAttribute('r')!]=+r.getAttribute('ht')!*1.25;});
 return {name:e.getAttribute('name')!,path,hidden:['hidden','veryHidden'].includes(e.getAttribute('state')||''),cells,rows:maxR,cols:maxC,merges:nodes(d,'mergeCell').map(e=>e.getAttribute('ref')!),widths,heights,hiddenCols};});
 const panelName=nodes(wb,'definedName').find(n=>n.getAttribute('name')==='MSP_MilestonePanel')?.textContent||'';
 const b:Book={name,bytes,files,sheets,styles,formats,tasks:[],date1904,milestonePanelEnd:Number(panelName.match(/\$Q\$(\d+)/)?.[1]||10)};b.tasks=extractTasks(b);if(!b.tasks.length)throw Error('작업 이름·시작·완료·참여 기관 열이 있는 사업 일정표가 필요합니다.');return b;
}
export function extractTasks(b:Book):Task[]{const s=b.sheets.find(s=>s.name==='사업 일정표')||b.sheets.find(s=>s.cells.A1?.v==='작업 이름');if(!s)return[];const core=b.sheets.find(s=>s.name==='_MSP_C0');const helper:Record<string,string>={};if(core)Object.entries(core.cells).forEach(([a,c])=>{if(address(a).r===1)helper[String(c.v)]=colName(address(a).c);});
 const out:Task[]=[];for(let r=2;r<=s.rows;r++){const g=(c:string)=>s.cells[c+r]?.v;const id=g('H');if(id===''||id==null||!g('A')||!g('N'))continue;let cr=r;if(core&&String(core.cells['H'+r]?.v)!==String(id)){const entry=Object.entries(core.cells).find(([a,c])=>/^H\d+$/.test(a)&&String(c.v)===String(id));if(entry)cr=address(entry[0]).r;}
 const cg=(key:string)=>core?.cells[(helper[key]||'')+cr]?.v;const d=(v:any)=>typeof v==='number'?excelDate(v,b.date1904):/^\d{4}-\d{2}-\d{2}/.test(String(v))?String(v).slice(0,10):'';
 out.push({id:String(id),row:r,name:String(g('A')),pct:typeof g('B')==='number'?g('B'):NaN,duration:+g('C')||0,start:d(g('D')),finish:d(g('E')),org:String(g('F')||cg('참여 기관')||''),wbs:String(g('N')),level:+g('M')||0,milestone:isMilestoneFlag(g('O')),summary:cg('Summary')!=null?isMilestoneFlag(cg('Summary')):false,notes:String(g('K')||''),predecessors:String(g('I')||''),successors:String(g('J')||''),actualFinish:d(cg('ActualFinish')),minutes:typeof cg('DurationMinutes')==='number'?cg('DurationMinutes'):(+g('C')||0)*480});}
 const parents=new Set<string>();for(const t of out){const parts=t.wbs.split('.');while(parts.length>1){parts.pop();parents.add(parts.join('.'));}}for(const t of out)if(t.wbs==='0'||parents.has(t.wbs))t.summary=true;
 assertUniqueTaskIds(out);return out;}
export const agencies=(tasks:Task[])=>[...new Set(tasks.filter(t=>!t.summary).flatMap(t=>organizationNames(t.org)))];
export const belongs=(t:Task,org:string)=>!org||organizationNames(t.org).includes(org);
export function displayCell(b:Book,c?:Cell){if(!c)return '';const v=c.v;if(typeof v==='boolean')return v?'TRUE':'FALSE';if(typeof v!=='number')return String(v??'');const style=b.styles[c.s],fmt=b.formats[style?.fmt]||'';if((style?.fmt>=14&&style?.fmt<=17)||style?.fmt===22||/(?:yy|dd)/i.test(fmt.replace(/"[^"]*"/g,'')))return excelDate(v,b.date1904);if((style?.fmt>=18&&style?.fmt<=21)||/h+:m+/i.test(fmt)){const minutes=Math.round((fmt.includes('[h]')?v:v%1)*1440);return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');}if(fmt.includes('%')||style?.fmt===9||style?.fmt===10)return (v*100).toFixed(Math.min(8,fmt.match(/0\.(0+)%/)?.[1].length||(style?.fmt===10?2:0)))+'%';return Number.isInteger(v)?String(v):String(Math.round(v*1000)/1000);}
export type Change={sheet:string;address:string;value:any;formula?:string;style?:number};
export function taskChanges(b:Book,t:Task):Change[]{const changes:Change[]=[];const fields:Record<string,any>={A:t.name,B:t.pct,C:t.duration,D:serial(t.start,b.date1904),E:serial(t.finish,b.date1904),F:t.org,I:t.predecessors,J:t.successors,K:t.notes,O:t.milestone?'Yes':'No'};
 for(const s of b.sheets){if(s.cells.A1?.v!=='작업 이름')continue;for(let r=2;r<=s.rows;r++)if(String(s.cells['H'+r]?.v)===t.id){for(const [c,value]of Object.entries(fields)){let v=value;if(c==='D'||c==='E'){const original=s.cells[c+r]?.v;if(typeof original==='number')v=Number(value)+(original-Math.floor(original));}changes.push({sheet:s.name,address:c+r,value:v});}if(s.hidden){const headers=Object.entries(s.cells).filter(([a])=>address(a).r===1);for(const [a,c]of headers){const cn=colName(address(a).c);if(c.v==='DurationMinutes')changes.push({sheet:s.name,address:cn+r,value:t.minutes});if(c.v==='ActualFinish')changes.push({sheet:s.name,address:cn+r,value:t.actualFinish?serial(t.actualFinish,b.date1904):''});}}}}
 // Source workbook helper tables power its native milestone dashboard.
 const core=b.sheets.find(s=>s.name==='_MSP_C0');if(core?.cells.BF1?.v==='MSP_TaskID')for(let r=2;r<=core.rows;r++)if(String(core.cells['BF'+r]?.v)===t.id){for(const [c,value]of Object.entries({AZ:t.org,BA:serial(t.start,b.date1904),BB:serial(t.finish,b.date1904),BC:t.name,BD:t.milestone?'Yes':'No',BE:t.notes}))changes.push({sheet:core.name,address:c+r,value});}
 return changes;}
export function applyChanges(b:Book,changes:Change[]){for(const ch of changes){const s=b.sheets.find(s=>s.name===ch.sheet)!;const old=s.cells[ch.address]||{s:0,v:''};s.cells[ch.address]={...old,v:ch.value,f:ch.formula};}b.tasks=extractTasks(b);}
/** Rebuild the native dashboard cache without changing its original work-count formulas. */
export function refreshMilestoneDashboard(b:Book,selection?:MilestoneSelection):Change[]{
 const s=b.sheets.find(s=>s.name==='마일스톤 대시보드');if(!s)return[];
 const out:Change[]=[];
 const set=(a:string,v:any,style?:number)=>{const old=s.cells[a];if(old?.v===v&&(style===undefined||old.s===style))return;const ch:Change={sheet:s.name,address:a,value:v,formula:old?.f,style};out.push(ch);s.cells[a]={...(old||{s:style??0}),s:style??old?.s??0,v,f:old?.f};};
 for(const [a,c] of Object.entries(s.cells))if(c.f?.startsWith('COUNTIFS(')){
  const p=address(a),org=String(s.cells['B'+p.r]?.v||''),year=String(s.cells[colName(p.c)+'5']?.v||'');
  if(org&&/^\d{4}$/.test(year))set(a,b.tasks.filter(t=>!t.summary&&belongs(t,org)&&inYear(t,year)).length);
 }
 const saved=String(s.cells.O5?.v||'').match(/^(.*?)\s*\|\s*(\d{4})년/);
 const chosen=selection&&selection.org&&/^\d{4}$/.test(selection.year)?selection:b.milestoneSelection||{org:saved?.[1].trim()||agencies(b.tasks)[0]||'',year:saved?.[2]||String(s.cells.F5?.v||'')};
 b.milestoneSelection=chosen;
 const rows=milestoneTasks(b.tasks,chosen.org,chosen.year);
 const oldEnd=b.milestonePanelEnd??10;
 const end=Math.max(8,7+rows.length),styles={O:s.cells.O8?.s||0,P:s.cells.P8?.s||0,Q:s.cells.Q8?.s||0};
 set('O5',`${chosen.org} | ${chosen.year}년 | 마일스톤 ${rows.length}건`);
 for(let r=8;r<=Math.max(oldEnd,end);r++){const t=rows[r-8];set('O'+r,t?.name||'',styles.O);set('P'+r,t?serial(t.finish,b.date1904):'',styles.P);set('Q'+r,t?.notes||'',styles.Q);}
 b.milestonePanelEnd=end;s.rows=Math.max(s.rows,end);
 b.computed=[...new Map([...(b.computed||[]),...out].map(c=>[c.sheet+'!'+c.address,c])).values()];return out;
}
export function refreshModel(b:Book,at=today()):Change[]{const out:Change[]=[];const set=(s:Sheet,a:string,v:any)=>{const old=s.cells[a];if(old?.v===v)return;const ch={sheet:s.name,address:a,value:v,formula:old?.f};out.push(ch);s.cells[a]={...(old||{s:0}),v,f:old?.f};};const leaves=b.tasks.filter(t=>!t.summary);const master=b.sheets.find(s=>s.name==='사업 일정표')||b.sheets.find(s=>s.cells.A1?.v==='작업 이름');const coreNames=['사업 일정표',...b.sheets.filter(s=>!s.hidden&&s.cells.A1?.v==='작업 이름'&&s.name!=='사업 일정표').map(s=>s.name)];
 for(const s of b.sheets.filter(s=>s.cells.A1?.v==='작업 이름')){const statusHead=Object.entries(s.cells).find(([a,c])=>address(a).r===1&&c.v==='StatusCode');const statusColumn=statusHead?colName(address(statusHead[0]).c):null;const agency=s.hidden?coreNames[Number(s.name.replace('_MSP_C',''))]:s.name;const scope=agency==='사업 일정표'||!agency?leaves:leaves.filter(t=>belongs(t,agency));for(let r=2;r<=s.rows;r++){const t=b.tasks.find(t=>t.id===String(s.cells['H'+r]?.v));if(!t)continue;const list=t.summary?scope.filter(x=>t.wbs==='0'||x.wbs.startsWith(t.wbs+'.')):scope.filter(x=>x.id===t.id);const m=metrics(list,at);for(const [c,v]of Object.entries({Q:m.total,R:m.done,S:m.remain,T:`${m.done}/${m.total}`,U:m.total?m.done/m.total:0}))set(s,c+r,v);if(t.summary&&list.length){const weight=list.reduce((n,t)=>n+t.minutes,0);const starts=list.filter(t=>isISODate(t.start)).map(t=>serial(t.start,b.date1904));const finishes=list.filter(t=>isISODate(t.finish)).map(t=>serial(t.finish,b.date1904));set(s,'B'+r,list.every(t=>Number.isFinite(t.pct)&&t.pct>=0&&t.pct<=1)?(weight?list.reduce((n,t)=>n+t.minutes*t.pct,0)/weight:list.reduce((n,t)=>n+t.pct,0)/list.length):'');set(s,'D'+r,starts.length===list.length?Math.min(...starts):'');set(s,'E'+r,finishes.length===list.length?Math.max(...finishes):'');}const status=t.summary?(list.some(x=>state(x,at)==='late')?'late':list.some(x=>state(x,at)==='unknown')?'unknown':list.every(x=>state(x,at)==='done')?'done':list.some(x=>state(x,at)==='active')?'active':'waiting'):state(t,at);set(s,'G'+r,status==='late'?'●':status==='done'||status==='active'?'☺':'');if(statusColumn)set(s,statusColumn+r,({late:1,done:2,active:3,waiting:0,unknown:-1} as any)[status]);}}
 b.tasks=extractTasks(b);
 for(let pass=0;pass<2;pass++)for(const s of b.sheets)for(const [a,c]of Object.entries(s.cells)){const f=c.f||(/^=/.test(String(c.v))?String(c.v).slice(1):'');const ref=f.match(/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/);if(ref){const from=b.sheets.find(x=>x.name===ref[1])?.cells[ref[2]+ref[3]];if(from)set(s,a,from.v);}}
 b.computed=[...new Map([...(b.computed||[]),...out].map(c=>[c.sheet+'!'+c.address,c])).values()];out.push(...refreshMilestoneDashboard(b));return out;}
function patchXml(text:string,updates:Change[]){const d=xml(text);const sd=nodes(d,'sheetData')[0];const cellMap=new Map(nodes(sd,'c').map(c=>[c.getAttribute('r'),c]));for(const u of updates){let c=cellMap.get(u.address);if(!c){const r=address(u.address).r;let row=nodes(sd,'row').find(e=>e.getAttribute('r')===String(r));if(!row){row=d.createElementNS(ns,'row');row.setAttribute('r',String(r));const before=nodes(sd,'row').find(e=>+e.getAttribute('r')!>r);sd.insertBefore(row,before||null);}c=d.createElementNS(ns,'c');c.setAttribute('r',u.address);const before=nodes(row,'c').find(x=>address(x.getAttribute('r')||'A1').c>address(u.address).c);row.insertBefore(c,before||null);cellMap.set(u.address,c);}while(c.firstChild)c.removeChild(c.firstChild);c.removeAttribute('t');if(u.style!==undefined)c.setAttribute('s',String(u.style));if(u.formula){const f=d.createElementNS(ns,'f');f.textContent=u.formula.replace(/^=/,'');c.appendChild(f);}if(typeof u.value==='string'){if(u.formula){c.setAttribute('t','str');const v=d.createElementNS(ns,'v');v.textContent=u.value;c.appendChild(v);continue;}c.setAttribute('t','inlineStr');const is=d.createElementNS(ns,'is'),t=d.createElementNS(ns,'t');t.setAttribute('xml:space','preserve');t.textContent=u.value;is.appendChild(t);c.appendChild(is);}else{const v=d.createElementNS(ns,'v');v.textContent=String(u.value??'');c.appendChild(v);}}const dim=nodes(d,'dimension')[0];if(dim){const last=address(dim.getAttribute('ref')?.split(':').at(-1)||'A1');for(const u of updates){const p=address(u.address);last.r=Math.max(last.r,p.r);last.c=Math.max(last.c,p.c);}dim.setAttribute('ref','A1:'+colName(last.c)+last.r);}return new XMLSerializer().serializeToString(d);}
export function exportBook(b:Book,changes:Change[],at=today()):Uint8Array{
 const files={...b.files};const all=[...changes];
 refreshModel(b,at);all.push(...(b.computed||[]));
 for(const s of b.sheets){const m=new Map<string,Change>();all.filter(c=>c.sheet===s.name).forEach(c=>m.set(c.address,c));if(m.size)files[s.path]=strToU8(patchXml(strFromU8(files[s.path]),[...m.values()]));}
 const styles=xml(strFromU8(files['xl/styles.xml']));const custom=nodes(styles,'numFmt');custom.forEach(e=>{const fmt=e.getAttribute('formatCode')||'';if(/(?:yy|dd)/i.test(fmt.replace(/"[^"]*"/g,'').replace(/\[[^\]]*\]/g,'')))e.setAttribute('formatCode','yyyy-mm-dd');});
 // Built-in Excel date formats are locale-dependent. Normalize their XF references too.
 const dateId=Math.max(163,...custom.map(e=>Number(e.getAttribute('numFmtId'))))+1;
 let formats=nodes(styles,'numFmts')[0];if(!formats){formats=styles.createElementNS(ns,'numFmts');styles.documentElement.insertBefore(formats,styles.documentElement.firstChild);}
 const dateFormat=styles.createElementNS(ns,'numFmt');dateFormat.setAttribute('numFmtId',String(dateId));dateFormat.setAttribute('formatCode','yyyy-mm-dd');formats.appendChild(dateFormat);formats.setAttribute('count',String(formats.children.length));
 for(const xf of nodes(styles,'xf')){const id=Number(xf.getAttribute('numFmtId'));if((id>=14&&id<=17)||id===22){xf.setAttribute('numFmtId',String(dateId));xf.setAttribute('applyNumberFormat','1');}}
 files['xl/styles.xml']=strToU8(new XMLSerializer().serializeToString(styles));
 const wb=xml(strFromU8(files['xl/workbook.xml']));
 const dashboard=b.sheets.find(s=>s.name==='마일스톤 대시보드');
 if(dashboard&&b.milestoneSelection){
  const selection=b.milestoneSelection;
  const row=Object.entries(dashboard.cells).find(([a,c])=>/^B\d+$/.test(a)&&c.v===selection.org)?.[0].slice(1);
  const column=Object.entries(dashboard.cells).find(([a,c])=>/^[A-Z]+5$/.test(a)&&String(c.v)===selection.year)?.[0].replace(/5$/,'');
  for(const n of nodes(wb,'definedName')){
   if(n.getAttribute('name')==='_xlnm.Print_Area'&&Number(n.getAttribute('localSheetId'))===b.sheets.indexOf(dashboard))n.textContent=`'마일스톤 대시보드'!$A$1:$Q$${Math.max(27,b.milestonePanelEnd||8)}`;
   if(n.getAttribute('name')==='MSP_MilestonePanel')n.textContent=`'마일스톤 대시보드'!$O$8:$Q$${b.milestonePanelEnd||8}`;
   if(n.getAttribute('name')==='MSP_SelectedCell'&&row&&column)n.textContent=`'마일스톤 대시보드'!$${column}$${row}`;
  }
 }
 let calc=nodes(wb,'calcPr')[0];if(!calc){calc=wb.createElementNS(ns,'calcPr');wb.documentElement.appendChild(calc);}calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');files['xl/workbook.xml']=strToU8(new XMLSerializer().serializeToString(wb));
 // All original ZIP parts, VBA, drawings, styles, relationships and hidden sheets are retained.
 return zipSync(files,{level:6});
}

export const scheduleNames=['사업 일정표','한국철도공사','샬롬엔지니어링','투아이시스','알에프컴','한국산업기술시험원','국립한국교통대학교'];
export function scheduleNamesFor(b:Book){return ["사업 일정표",...agencies(b.tasks).filter(n=>n!=="사업 일정표")];}
export function validateSchedules(b:Book){
 const scheduleNames=scheduleNamesFor(b);
 const missing=scheduleNames.filter(name=>!b.sheets.some(s=>s.name===name));
 if(missing.length)throw Error('전체 기관 일정표를 함께 게시하려면 다음 시트가 필요합니다: '+missing.join(', '));
 for(const name of scheduleNames){const sheet=b.sheets.find(s=>s.name===name)!;if(sheet.cells.A1?.v!=='작업 이름'||!scheduleTasks(b,name).length)throw Error(name+' 시트의 작업 ID·WBS·일정을 확인해 주세요. 기존 게시본은 유지됩니다.');const seen=new Set<string>();for(let row=2;row<=sheet.rows;row++){const id=String(sheet.cells['H'+row]?.v??'');if(!id||!sheet.cells['A'+row]?.v)continue;if(seen.has(id)||!b.tasks.some(t=>t.id===id))throw Error(name+' 시트의 작업 ID '+id+'가 중복되거나 사업 일정표에 없습니다.');seen.add(id);}}
}
/** Exact worksheet membership, including the agency's own ancestor and summary rows. */
export function scheduleTasks(b:Book,name:string):Task[]{
 const sheet=b.sheets.find(s=>s.name===name);if(!sheet)return[];
 const byId=new Map(b.tasks.map(t=>[t.id,t]));const out:Task[]=[];
 const date=(v:any)=>typeof v==='number'?excelDate(v,b.date1904):/^\d{4}-\d{2}-\d{2}/.test(String(v))?String(v).slice(0,10):'';
 for(let row=2;row<=sheet.rows;row++){
  const g=(c:string)=>sheet.cells[c+row]?.v;const original=byId.get(String(g('H')));if(!original||!g('A')||!g('N'))continue;
  out.push({...original,row,name:String(g('A')),pct:typeof g('B')==='number'?g('B'):original.pct,duration:+g('C')||0,start:date(g('D')),finish:date(g('E')),org:String(g('F')||''),wbs:String(g('N')),level:+g('M')||0,notes:String(g('K')||''),predecessors:String(g('I')||''),successors:String(g('J')||'')});
 }
 return out;
}
