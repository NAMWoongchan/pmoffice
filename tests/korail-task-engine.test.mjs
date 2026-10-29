import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import {zipSync,strToU8} from 'fflate';
const dir=path.resolve('node_modules/.cache/korail-tests-'+process.pid);fs.mkdirSync(dir,{recursive:true});
await build({entryPoints:['pms-app/lib/server-engine.ts','pms-app/lib/workbook.ts','pms-app/lib/server-xml.ts'],bundle:true,platform:'node',packages:'external',format:'esm',outdir:dir,outExtension:{'.js':'.mjs'},logLevel:'silent'});
const {patchTasks,allowedTask,patchTasksRemote,runWorkbookStage,patchTasksChainedRemote,runWorkbookPipeline}=await import(pathToFileURL(path.join(dir,'server-engine.mjs')));const w=await import(pathToFileURL(path.join(dir,'workbook.mjs')));
const orgs=['공사','한국공사','기관C','기관D','기관E','기관F'];const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
const cells=entries=>entries.map(([a,value])=>`<c r="${a}"${typeof value==='string'?' t="inlineStr"':''}>${typeof value==='string'?`<is><t>${escape(value)}</t></is>`:`<v>${value}</v>`}</c>`).join('');
const task=(id,org,finish,flag='Yes',start='2026-01-01',name='작업 '+id,wbs='1.'+id)=>({id,org,finish,flag,start,name,wbs});
function fixture(extra=[]){
 const tasks=[task(1,'공사;한국공사','2026-12-31'),task(2,'공사','2027-01-01','No'),task(3,'한국공사','2027-01-01','true'),...orgs.slice(2).map((org,i)=>task(i+4,org,'2028-07-01','No')),...extra];
 const taskRows=[`<row r="1">${cells([['A1','작업 이름']])}</row>`,`<row r="2">${cells([['A2','요약'],['B2',0],['D2',w.serial('2026-01-01')],['E2',w.serial('2029-12-31')],['H2',0],['M2',0],['N2','0'],['O2','Yes']])}</row>`,...tasks.map((t,i)=>{const r=i+3;return `<row r="${r}">${cells([['A'+r,t.name],['B'+r,0],['C'+r,1],['D'+r,w.serial(t.start)],['E'+r,w.serial(t.finish)],['F'+r,t.org],['H'+r,t.id],['M'+r,2],['N'+r,t.wbs],['O'+r,t.flag]])}</row>`;})].join('');
 const names=['사업 일정표',...orgs,'마일스톤 대시보드','_MSP_C0'];const files={};
 files['xl/workbook.xml']=strToU8(`<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets>${names.map((name,i)=>`<sheet name="${name}" sheetId="${i+1}" r:id="rId${i+1}"${i===8?' state="veryHidden"':''}/>`).join('')}</sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="7">'마일스톤 대시보드'!$A$1:$Q$27</definedName><definedName name="MSP_MilestonePanel">'마일스톤 대시보드'!$O$8:$Q$10</definedName></definedNames><calcPr/></workbook>`);
 files['xl/_rels/workbook.xml.rels']=strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`);
 files['xl/styles.xml']=strToU8(`<styleSheet xmlns="${NS}"><fonts count="1"><font><name val="Calibri"/><sz val="11"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>`);
 names.forEach((name,i)=>{const data=i===7?`<row r="5">${cells([['F5',2026],['H5',2027],['J5',2028],['L5',2029]])}</row><row r="7">${cells([['B7','공사']])}</row><row r="5">${cells([['O5','공사 | 2026년 | 마일스톤 1건']])}</row>`:i===0?taskRows:`<row r="1">${cells([['A1','작업 이름']])}</row>`;files[`xl/worksheets/sheet${i+1}.xml`]=strToU8(`<worksheet xmlns="${NS}"><dimension ref="A1:BF50"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="58" width="12"/></cols><sheetData>${data}</sheetData><mergeCells count="0"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape"/></worksheet>`);});
 files['xl/drawings/preserve.bin']=Uint8Array.from([1,8,2,9]);return w.parseBook(zipSync(files),'fixture.xlsx');
}

test('server workbook updates own/shared assignments only and preserves foreign raw task cells',()=>{
 const b=fixture();const base=w.exportBook(b,[],'2026-10-29');const original=w.parseBook(base,'original.xlsx');
 const result=patchTasks(base,'original.xlsx',[{id:'1',changes:{notes:'서버 변경',pct:0.5}}],{admin:false,organizations:['공사']});
 const after=w.parseBook(result.bytes,'saved.xlsx');assert.equal(after.tasks.find(t=>t.id==='1').notes,'서버 변경');assert.equal(after.tasks.find(t=>t.id==='1').pct,0.5);
 for(const t of original.tasks.filter(t=>!t.summary&&t.id!=='1'))assert.deepEqual(after.tasks.find(x=>x.id===t.id),t,'foreign/unchanged task '+t.id);
 assert.deepEqual(after.files['xl/drawings/preserve.bin'],original.files['xl/drawings/preserve.bin']);
 assert.doesNotThrow(()=>patchTasks(base,'shared.xlsx',[{id:'1',changes:{notes:'공동 작업'}}],{admin:false,organizations:['한국공사']}));
 assert.throws(()=>patchTasks(base,'foreign.xlsx',[{id:'3',changes:{notes:'거부'}}],{admin:false,organizations:['공사']}),e=>e.status===403);
 assert.throws(()=>patchTasks(base,'unknown.xlsx',[{id:'1',changes:{notes:'거부'}}],{organizations:[]}),e=>e.status===403);
 assert.throws(()=>patchTasks(base,'summary.xlsx',[{id:'0',changes:{notes:'거부'}}],{admin:true}),e=>e.status===403);
 assert.throws(()=>patchTasks(base,'forged.xlsx',[{id:'1',changes:{org:'공사'}}],{admin:true}),e=>e.status===400);
 assert.throws(()=>patchTasks(base,'invalid.xlsx',[{id:'1',changes:{finish:'2026-02-30'}}],{admin:true}),e=>e.status===400);
 assert.equal(allowedTask({summary:false,org:'한국공사'},{organizations:['공사']}),false,'no substring permission');
});

test('private workbook task update preserves other leaf records and reports CPU budget',{skip:!process.env.PMS_WORKBOOK_FIXTURE},()=>{
 const bytes=new Uint8Array(fs.readFileSync(process.env.PMS_WORKBOOK_FIXTURE));const original=w.parseBook(bytes,'source.xlsm');const target=original.tasks.find(t=>!t.summary&&t.org);
 const cpu=process.cpuUsage(),start=performance.now(),phases={};let last=process.cpuUsage();const measure=name=>{const d=process.cpuUsage(last);phases[name]=(d.user+d.system)/1000;last=process.cpuUsage()};const result=patchTasks(bytes,'source.xlsm',[{id:target.id,changes:{notes:target.notes+' 검증'}}],{organizations:target.org.split(/[,;\n]/).map(x=>x.trim())},measure);
 const used=process.cpuUsage(cpu),stats={cpu_ms:(used.user+used.system)/1000,wall_ms:performance.now()-start,tasks:original.tasks.length,source_bytes:bytes.length,result_bytes:result.bytes.length,phases};
 const after=w.parseBook(result.bytes,'saved.xlsm');for(const t of original.tasks.filter(t=>!t.summary&&t.id!==target.id))assert.deepEqual(after.tasks.find(x=>x.id===t.id),t);
 assert.equal(after.tasks.find(x=>x.id===target.id).notes,target.notes+' 검증');
 if(process.env.KORAIL_CPU_REPORT)fs.writeFileSync(process.env.KORAIL_CPU_REPORT,JSON.stringify(stats,null,2));console.log('server workload CPU ms',stats.cpu_ms);
 assert.ok(stats.cpu_ms>0,'reference engine diagnostic; production uses bounded stages');
});

test('legacy segmented pipeline preserves reference task results and records stage costs',{skip:!process.env.PMS_WORKBOOK_FIXTURE},async()=>{
 const bytes=new Uint8Array(fs.readFileSync(process.env.PMS_WORKBOOK_FIXTURE));const original=w.parseBook(bytes,'source.xlsm');const target=original.tasks.find(t=>!t.summary&&t.org),stages=[];
 const result=await patchTasksRemote(bytes,'source.xlsm',[{id:target.id,changes:{notes:target.notes+' 검증'}}],{organizations:target.org.split(/[,;\n]/).map(x=>x.trim())},async(stage,input)=>{const cpu=process.cpuUsage();const answer=runWorkbookStage(stage,structuredClone(input));const used=process.cpuUsage(cpu);stages.push({stage,cpu_ms:(used.user+used.system)/1000});return structuredClone(answer)});
 const after=w.parseBook(result.bytes,'saved.xlsm');for(const t of original.tasks.filter(t=>!t.summary&&t.id!==target.id))assert.deepEqual(after.tasks.find(x=>x.id===t.id),t);assert.equal(after.tasks.find(x=>x.id===target.id).notes,target.notes+' 검증');assert.deepEqual(after.files['xl/vbaProject.bin'],original.files['xl/vbaProject.bin']);
 assert.ok(stages.length<30);if(process.env.KORAIL_STAGE_REPORT)fs.writeFileSync(process.env.KORAIL_STAGE_REPORT,JSON.stringify(stages,null,2));assert.ok(stages.every(s=>s.cpu_ms>=0),'legacy stage timings recorded; strict CPU budget is enforced on the chained production path');
});

test('chained internal pipeline retains scope checks, task values and opaque workbook parts',async()=>{
 const b=fixture(),base=w.exportBook(b,[],'2026-10-29');let phases=0;const next=async input=>{phases++;return runWorkbookPipeline(JSON.parse(JSON.stringify(input)),next)};
 const result=await patchTasksChainedRemote(base,'source.xlsx',[{id:'1',changes:{notes:'연속 처리'}}],{organizations:['공사']},async(_,input)=>next(input));const after=w.parseBook(result.bytes,'saved.xlsx'),before=w.parseBook(base,'before.xlsx');
 assert.equal(after.tasks.find(t=>t.id==='1').notes,'연속 처리');for(const t of before.tasks.filter(t=>!t.summary&&t.id!=='1'))assert.deepEqual(after.tasks.find(x=>x.id===t.id),t);assert.deepEqual(after.files['xl/drawings/preserve.bin'],before.files['xl/drawings/preserve.bin']);assert.ok(phases<30);
 await assert.rejects(()=>patchTasksChainedRemote(base,'source.xlsx',[{id:'3',changes:{notes:'거부'}}],{organizations:['공사']},async(_,input)=>next(input)),e=>e.status===403);
});
test('private chained pipeline bounds per-request coordinator CPU and preserves all leaf values',{skip:!process.env.PMS_WORKBOOK_FIXTURE},async()=>{
 const bytes=new Uint8Array(fs.readFileSync(process.env.PMS_WORKBOOK_FIXTURE)),before=w.parseBook(bytes,'before.xlsm'),target=before.tasks.find(t=>!t.summary&&t.org),stages=[];
 const next=async input=>{let wire=JSON.stringify(input);input=null;while(true){const start=process.cpuUsage(),current=JSON.parse(wire),phase=current.phase;wire='';const answer=await runWorkbookPipeline(current,async following=>({nextWire:JSON.stringify(following)}));const used=process.cpuUsage(start);stages.push({stage:phase,cpu_ms:(used.user+used.system)/1000});if(!answer.nextWire)return answer;wire=answer.nextWire;}};
 const result=await patchTasksChainedRemote(bytes,'source.xlsm',[{id:target.id,changes:{notes:target.notes}}],{organizations:target.org.split(/[,;\n]/).map(x=>x.trim())},async(_,input)=>next(input));const after=w.parseBook(result.bytes,'after.xlsm');
 for(const t of before.tasks.filter(t=>!t.summary))assert.deepEqual(after.tasks.find(x=>x.id===t.id),t);assert.deepEqual(after.files['xl/vbaProject.bin'],before.files['xl/vbaProject.bin']);assert.ok(stages.length<30);if(process.env.KORAIL_CHAIN_REPORT)fs.writeFileSync(process.env.KORAIL_CHAIN_REPORT,JSON.stringify(stages,null,2));assert.ok(stages.every(x=>x.cpu_ms<1800),'phase including input serialization below CPU ceiling');
});

test('streaming XML patch inserts many missing rows once and preserves untouched raw cells',async()=>{
 const x=await import(pathToFileURL(path.join(dir,'server-xml.mjs')));const original='<worksheet><dimension ref="A1:A5"/><sheetData><row r="1"><c r="A1" s="7"><v>1</v></c></row><row r="5"><c r="A5" s="9"><v>5</v></c></row></sheetData></worksheet>';
 const out=x.patchSheet(original,[2,3,4].map(n=>({address:'B'+n,value:n})));assert.deepEqual([...out.matchAll(/<row r="([0-9]+)"/g)].map(m=>Number(m[1])),[1,2,3,4,5]);assert.ok(out.includes('<c r="A1" s="7"><v>1</v></c>'));assert.equal(x.readSheet(out,[]).cells.B3.v,3);assert.ok(out.includes('A1:B5'));
});
