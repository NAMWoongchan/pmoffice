import {zipSync,unzipSync} from 'fflate';
import {readSheet,patchSheet} from './server-xml';
import {DOMParser as ServerParser} from 'linkedom';
import {parseBook,taskChanges,applyChanges,exportBook,exportBookParts,extractTasks,refreshModel,refreshMilestoneDashboard,today} from './workbook';
import {validateTaskInput} from './validation';
import {organizationNames} from './milestones';
Object.assign(globalThis,{DOMParser:ServerParser,XMLSerializer:class {serializeToString(node:any){return node.toString()}}});
const allowed=['name','pct','duration','start','finish','actualFinish','predecessors','successors','notes','milestone'];
function fail(status:number,message:string):never{throw Object.assign(Error(message),{status})}
export function allowedTask(task:any,policy:any){return !task.summary&&(policy?.admin===true||policy?.allTasks===true||organizationNames(task.org).some(n=>policy?.organizations?.includes(n)))}
export function applyTaskEdits(book:any,updates:any,policy:any){
 if(!Array.isArray(updates)||!updates.length||updates.length>100)fail(400,'수정할 작업을 1~100개 선택해 주세요.');
 const seen=new Set<string>(),edits:any[]=[],assignments:any[]=[];
for(const row of updates){
  if(!row||Object.keys(row).some(k=>!['id','changes'].includes(k))||typeof row.id!=='string'||!row.changes||Array.isArray(row.changes)||typeof row.changes!=='object'||seen.has(row.id))fail(400,'작업 변경 형식이 올바르지 않습니다.');seen.add(row.id);
  const task=book.tasks.find(t=>t.id===row.id);if(!task||!allowedTask(task,policy))fail(403,'소속 기업에 배정된 개별 작업만 수정할 수 있습니다.');
  assignments.push({id:task.id,org:task.org,summary:task.summary});
  const keys=Object.keys(row.changes);if(!keys.length||keys.some(k=>!allowed.includes(k)))fail(400,'작업 ID·배정·WBS와 지정되지 않은 항목은 변경할 수 없습니다.');
  for(const k of keys){const v=row.changes[k];if(['pct','duration'].includes(k)){if(typeof v!=='number'||!Number.isFinite(v)||v<0||(k==='pct'&&v>1)||(k==='duration'&&v>100000))fail(400,'완료율과 기간을 확인해 주세요.');}
   else if(k==='milestone'){if(typeof v!=='boolean')fail(400,'마일스톤 값을 확인해 주세요.');}
   else if(typeof v!=='string'||v.length>(k==='notes'?20000:k==='name'?2000:1000))fail(400,'작업 입력값을 확인해 주세요.');}
  const next={...task,...row.changes};next.minutes=next.duration===task.duration?task.minutes:task.duration?task.minutes*next.duration/task.duration:next.duration*480;
  const error=validateTaskInput(next);if(error)fail(400,error);edits.push({task:next,changes:keys});
 }
 const changes=edits.flatMap(e=>taskChanges(book,e.task));applyChanges(book,changes);
 return {book,changes,assignments,fields:edits.map(e=>({id:e.task.id,fields:e.changes}))};
}
export function patchTasks(bytes:Uint8Array,name:string,updates:any,policy:any,measure?:(phase:string)=>void){
 measure?.('start');const book=parseBook(bytes,name,{readSheet});measure?.('parse');const edit=applyTaskEdits(book,updates,policy);measure?.('apply');
 const output=exportBook(book,edit.changes,today(),{preserveVba:true,patchSheet,preserveCoreLayout:true,zipLevel:1,measure});measure?.('export');return {...edit,bytes:output};
}
const emptySheet=()=>({cells:{},rows:0,cols:0,widths:{},heights:{},hiddenCols:[],merges:[]});
export const encodeBytes=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s)};
export const decodeBytes=(s:string)=>{const raw=atob(s),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes};
const lightBook=(b:any)=>({...b,files:undefined,bytes:undefined});
/** Each CPU-heavy stage is a separately authenticated Edge request below the per-request limit. */
export async function patchTasksRemote(bytes:Uint8Array,name:string,updates:any,policy:any,worker:(stage:string,input:any)=>Promise<any>){
 const sources:any[]=[];let book:any=parseBook(bytes,name,{allowEmpty:true,readSheet:(text,strings)=>{sources.push({text,strings});return emptySheet()}});
 const files=book.files;book=lightBook(book);
 for(let i=0;i<sources.length;i+=8){const inputs=[];for(let j=i;j<Math.min(i+8,sources.length);j+=2)inputs.push(sources.slice(j,j+2));const batch=(await Promise.all(inputs.map(sheets=>worker('sheets',{sheets})))).flat();batch.forEach((sheet,j)=>{book.sheets[i+j]={...book.sheets[i+j],...sheet}});}
 book.tasks=extractTasks(book);let edit=await worker('apply',{book,updates,policy});book=edit.book;
 const schedules=book.sheets.filter((s:any)=>s.cells.A1?.v==='작업 이름').map((s:any)=>s.name);
 for(let i=0;i<schedules.length;i+=2)book=await worker('model',{book,names:schedules.slice(i,i+2)});
 book=await worker('links',{book});book=await worker('dashboard',{book});
 const prepared=await worker('files',{book,changes:edit.changes,original:encodeBytes(bytes)});
 const layout=await worker('layout',{book,files:prepared});const output=await worker('zip',{files:layout});return {bytes:decodeBytes(output),assignments:edit.assignments,fields:edit.fields};
}
export function runWorkbookStage(stage:string,input:any){
 if(stage==='sheets')return input.sheets.map((s:any)=>readSheet(s.text,s.strings,{skipBlank:true}));
 if(stage==='apply')return applyTaskEdits(input.book,input.updates,input.policy);
 if(stage==='model'){refreshModel(input.book,today(),{sheetNames:input.names,skipLinks:true,skipDashboard:true,skipExtraction:true});return input.book;}
 if(stage==='links'){refreshModel(input.book,today(),{sheetNames:[],skipDashboard:true});return input.book;}
 if(stage==='dashboard'){const changes=refreshMilestoneDashboard(input.book);input.book.computed=[...new Map([...(input.book.computed||[]),...changes].map(c=>[c.sheet+'!'+c.address,c])).values()];return input.book;}
 if(stage==='files'){const files=input.files?Object.fromEntries(Object.entries(input.files).map(([k,v])=>[k,decodeBytes(v as string)])):unzipSync(decodeBytes(input.original));const b={...input.book,sheets:input.names?input.book.sheets.filter((s:any)=>input.names.includes(s.name)):input.book.sheets,bytes:new Uint8Array(),files};return Object.fromEntries(Object.entries(exportBookParts(b,input.changes,today(),{skipRefresh:true,preserveVba:true,patchSheet,preserveCoreLayout:true,patchOnly:true})).map(([k,v])=>[k,encodeBytes(v)]));}
 if(stage==='layout'){const files=Object.fromEntries(Object.entries(input.files).map(([k,v])=>[k,decodeBytes(v as string)]));const b={...input.book,computed:[],bytes:new Uint8Array(),files};return Object.fromEntries(Object.entries(exportBookParts(b,[],today(),{skipRefresh:true,preserveVba:true,patchSheet,preserveCoreLayout:true})).map(([k,v])=>[k,encodeBytes(v)]));}
 if(stage==='file-jobs'){
  const files:Record<string,Uint8Array>=input.files?Object.fromEntries(Object.entries(input.files).map(([k,v])=>[k,decodeBytes(v as string)])):unzipSync(decodeBytes(input.original));
  for(const job of input.jobs)if(job.updates.length)files[job.path]=new TextEncoder().encode(patchSheet(new TextDecoder().decode(files[job.path]),job.updates));
  return Object.fromEntries(Object.entries(files).map(([k,v])=>[k,encodeBytes(v)]));
 }
 if(stage==='zip'){const files=Object.fromEntries(Object.entries(input.files).map(([k,v])=>[k,decodeBytes(v as string)]));return encodeBytes(zipSync(files,{level:1}));}
 fail(400,'지원하지 않는 처리 단계입니다.');
}

// Each authenticated internal request performs one phase before continuing.
// This bounds coordinator serialization CPU as well as spreadsheet processing CPU.
export async function patchTasksChainedRemote(bytes:Uint8Array,name:string,updates:any,policy:any,worker:(stage:string,input:any)=>Promise<any>){
 const result=await worker('pipeline',{phase:'parse',source:encodeBytes(bytes),name,updates,policy});
 return {bytes:decodeBytes(result.content),assignments:result.assignments,fields:result.fields};
}
export async function runWorkbookPipeline(input:any,next:(input:any)=>Promise<any>):Promise<any>{
 const advance=(phase:string,fields:any={})=>{const state={...input,...fields,phase};for(const key of Object.keys(input))delete input[key];return next(state)};
 if(input.phase==='parse'){
  const sources:any[]=[];const book=parseBook(decodeBytes(input.source),input.name,{allowEmpty:true,readSheet:(text,strings)=>{sources.push({text,strings});return emptySheet()}});
  return advance('sheets',{book:lightBook(book),sources,index:0});
 }
 if(input.phase==='sheets'){
  const batch=runWorkbookStage('sheets',{sheets:input.sources.slice(0,4)});batch.forEach((sheet:any,i:number)=>{input.book.sheets[input.index+i]={...input.book.sheets[input.index+i],...sheet}});
  const sources=input.sources.slice(4);if(sources.length)return advance('sheets',{sources,index:input.index+batch.length});
  input.book.tasks=extractTasks(input.book);return advance('apply',{sources:undefined,index:undefined});
 }
 if(input.phase==='apply'){
  const edit=applyTaskEdits(input.book,input.updates,input.policy);const schedules=input.book.sheets.filter((s:any)=>s.cells.A1?.v==='작업 이름').map((s:any)=>s.name);
  return advance('model',{changes:edit.changes,assignments:edit.assignments,fields:edit.fields,schedules,updates:undefined,policy:undefined});
 }
 if(input.phase==='model'){
  const book=runWorkbookStage('model',{book:input.book,names:input.schedules.slice(0,2)});const schedules=input.schedules.slice(2);
  return advance(schedules.length?'model':'links',{book,schedules:schedules.length?schedules:undefined});
 }
 if(input.phase==='links')return advance('dashboard',{book:runWorkbookStage('links',{book:input.book})});
 if(input.phase==='dashboard'){
  const book=runWorkbookStage('dashboard',{book:input.book}),all=[...input.changes,...(book.computed||[])];
  const fileJobs=book.sheets.map((sheet:any)=>{const cells=new Map();for(const change of all)if(change.sheet===sheet.name)cells.set(change.address,change);return {path:sheet.path,updates:[...cells.values()]}}).filter((job:any)=>job.updates.length);
  const layoutBook={...book,computed:[],sheets:book.sheets.map((sheet:any)=>({...sheet,cells:sheet.name==='마일스톤 대시보드'?sheet.cells:Object.fromEntries(Object.entries(sheet.cells).filter(([address])=>address==='A1'||(sheet.name==='_MSP_C0'&&/^BF[0-9]+$/.test(address))))}))};
  return advance('files',{book:layoutBook,fileJobs,changes:undefined});
 }
 if(input.phase==='files'){
  const remaining=input.fileJobs.slice(2),files=runWorkbookStage('file-jobs',{jobs:input.fileJobs.slice(0,2),files:input.files,original:input.source});
  return advance(remaining.length?'files':'layout',{files,fileJobs:remaining.length?remaining:undefined,source:undefined});
 }
 if(input.phase==='layout')return advance('zip',{files:runWorkbookStage('layout',{book:input.book,files:input.files}),book:undefined});
 if(input.phase==='zip')return {content:runWorkbookStage('zip',{files:input.files}),assignments:input.assignments,fields:input.fields};
 fail(400,'지원하지 않는 처리 단계입니다.');
}
