import {strFromU8,strToU8} from 'fflate';
import type {Book,Change,Sheet} from './workbook';
import {milestoneTasks,organizationNames,assertUniqueTaskIds,type MilestoneSelection} from './milestones';
import {inYear,serial} from './task-model';
import {isISODate} from './validation';
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const DASHBOARD='마일스톤 대시보드';
export const OVERALL='전체 참여기관';
export const DETAIL_START=36;
const col=(n:number):string=>n>26?col(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):String.fromCharCode(64+n);
const xml=(s:string)=>{const d=new DOMParser().parseFromString(s,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('대시보드 XML 오류');return d;};
const list=(d:Document|Element,name:string)=>Array.from(d.getElementsByTagNameNS('*',name));
const serialize=(d:Document)=>strToU8(new XMLSerializer().serializeToString(d));
const esc=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export function dashboardYears(b:Book){const s=b.sheets.find(s=>s.name===DASHBOARD);const original=[6,8,10,12].map(c=>String(s?.cells[col(c)+'5']?.v||'')).filter(y=>/^\d{4}$/.test(y));return original.length===4?original:[...new Set(b.tasks.flatMap(t=>[t.start,t.finish]).filter(isISODate).map(d=>d.slice(0,4)))].sort();}
export function dashboardOrganizations(b:Book){const schedules=b.sheets.filter(s=>!s.hidden&&s.name!=='사업 일정표'&&s.cells.A1?.v==='작업 이름').map(s=>s.name);return ['',...(schedules.length?schedules:[...new Set(b.tasks.filter(t=>!t.summary).flatMap(t=>organizationNames(t.org)))])];}
export function dashboardCell(s:Sheet,a:string){const m=a.match(/^([A-Z]+)(\d+)$/);if(!m)return null;const c=[...m[1]].reduce((n,v)=>n*26+v.charCodeAt(0)-64,0),r=+m[2];if(r<7||r>27||c<6||c>12||c%2!==0||(r-7)%3!==0)return null;const year=String(s.cells[col(c)+'5']?.v||'');if(!/^\d{4}$/.test(year)||!s.cells['B'+r]?.v)return null;return {org:r===7?'':String(s.cells['B'+r].v),year};}
export function dashboardMatrix(b:Book){const years=dashboardYears(b);return dashboardOrganizations(b).map(org=>({org,cells:years.map(year=>({year,milestones:milestoneTasks(b.tasks,org,year).length,work:b.tasks.filter(t=>!t.summary&&(!org||organizationNames(t.org).includes(org))&&inYear(t,year)).length}))}));}
export function refreshNativeDashboard(b:Book,selection?:MilestoneSelection):Change[]{
 const s=b.sheets.find(s=>s.name===DASHBOARD),core=b.sheets.find(s=>s.name==='_MSP_C0');if(!s||!core)return[];assertUniqueTaskIds(b.tasks);
 const years=dashboardYears(b),orgs=dashboardOrganizations(b);if(years.length!==4||orgs.length!==7)throw Error('이 대시보드는 4개 사업연도와 6개 참여기관을 지원합니다. 원본은 유지됩니다.');
 const saved=String(s.cells.B32?.v||s.cells.O5?.v||'').match(/^(.*?)\s*\|\s*(\d{4})년/);const inferred={org:saved?.[1].trim()===OVERALL?'':saved?.[1].trim()||orgs[1],year:saved?.[2]||years[0]};
 const candidate=selection||b.milestoneSelection||inferred;const chosen={org:orgs.includes(candidate.org)?candidate.org:'',year:years.includes(candidate.year)?candidate.year:years[0]};b.milestoneSelection=chosen;
 const out:Change[]=[];function set(sheet:Sheet,a:string,value:any,formula?:string,style?:number){const old=sheet.cells[a];sheet.cells[a]={s:style??old?.s??0,v:value,f:formula};out.push({sheet:sheet.name,address:a,value,formula,style});}
 // One all-agency record per master ID, plus one record per exact agency token.
 const oldIndexEnd=Math.max(2,...Object.keys(core.cells).filter(a=>/^(AZ|BA|BB|BC|BD|BE|BF)\d+$/.test(a)).map(a=>Number(a.match(/\d+/)![0])));let row=2;
 for(const [i,key]of ['MSP_Org','MSP_Start','MSP_Finish','MSP_Name','MSP_Milestone','MSP_Notes','MSP_TaskID'].entries())set(core,col(52+i)+'1',key);
 for(const t of b.tasks.filter(t=>!t.summary)){
  const finish=isISODate(t.finish)?serial(t.finish,b.date1904):'';const start=isISODate(t.start)&&isISODate(t.finish)&&t.start<=t.finish?serial(t.start,b.date1904):'';
  for(const org of ['',...new Set(organizationNames(t.org))]){[org,start,finish,t.name,t.milestone?1:0,t.notes,t.id].forEach((v,i)=>set(core,col(52+i)+row,v));row++;}
 }
 const indexLast=Math.max(2,row-1);for(let r=row;r<=oldIndexEnd;r++)for(let c=52;c<=58;c++)set(core,col(c)+r,'');
 const existing=Object.keys(s.cells);for(const a of existing){const c=s.cells[a];if(c.v!==''||c.f)set(s,a,'');}
 s.merges=[];s.heights={};s.widths={1:18};for(let c=2;c<=13;c++)s.widths[c]=c<=5?58:88;s.cols=13;s.hiddenCols=[];
 function merge(a:string){s.merges.push(a);}const put=(a:string,v:any,f?:string)=>set(s,a,v,f);
 put('B2','참여기관 × 사업연도 마일스톤');merge('B2:M2');s.heights[2]=40;
 put('B3','마일스톤 개수를 선택하면 같은 기관·연도의 이름과 완료 예정일을 아래에서 확인합니다.');merge('B3:M3');s.heights[3]=28;
 put('B5','참여기관');merge('B5:E6');for(let i=0;i<years.length;i++){const c=6+i*2;put(col(c)+'5',Number(years[i]));merge(col(c)+'5:'+col(c+1)+'6');}s.heights[5]=25;s.heights[6]=18;
 const range=(c:string)=>`'_MSP_C0'!$${c}$2:$${c}$${indexLast}`;const matrix=dashboardMatrix(b);
 for(let i=0;i<orgs.length;i++){const r=7+i*3;put('B'+r,orgs[i]||OVERALL);merge(`B${r}:E${r+2}`);s.heights[r]=35;s.heights[r+1]=23;s.heights[r+2]=25;
  for(let y=0;y<years.length;y++){const c=6+y*2,a=col(c),criteria=i===0?'""':`$B${r}`,yr=`${a}$5`,finish=range('BB'),start=range('BA'),org=range('AZ'),flag=range('BD');
   put(a+r,matrix[i].cells[y].milestones,`COUNTIFS(${org},${criteria},${flag},1,${finish},">="&DATE(${yr},1,1),${finish},"<"&DATE(${yr}+1,1,1))`);
   put(a+(r+1),'마일스톤');put(a+(r+2),matrix[i].cells[y].work,`COUNTIFS(${org},${criteria},${start},">="&0,${start},"<>",${start},"<"&DATE(${yr}+1,1,1),${finish},">="&DATE(${yr},1,1))`);
   for(let k=0;k<3;k++)merge(`${a}${r+k}:${col(c+1)}${r+k}`);
  }
 }
 put('B29','중요 시점 Yes인 최하위 작업을 완료 예정 연도에 집계합니다. 전체 작업은 연도와 일정이 겹치는 작업 수입니다. 공동 작업은 전체 행에서 중복 제외합니다.');merge('B29:M29');s.heights[29]=36;
 const warnings=b.tasks.filter(t=>!t.summary&&(!isISODate(t.start)||!isISODate(t.finish)||t.start>t.finish)).length;
 put('B30',`날짜 확인 필요 작업: ${warnings}건 · 연도별 집계에서 유효한 날짜만 사용합니다.`);merge('B30:M30');s.heights[30]=25;
 const rows=milestoneTasks(b.tasks,chosen.org,chosen.year);put('B32',`${chosen.org||OVERALL} | ${chosen.year}년 | 마일스톤 ${rows.length}건`);merge('B32:M33');s.heights[32]=30;s.heights[33]=18;
 put('B35','마일스톤 이름');merge('B35:H35');put('I35','완료 예정일');merge('I35:J35');put('K35','메모');merge('K35:M35');s.heights[35]=28;
 const end=Math.max(DETAIL_START,DETAIL_START-1+rows.length);for(let r=DETAIL_START;r<=end;r++){const t=rows[r-DETAIL_START];put('B'+r,t?.name||'해당 연도 마일스톤 없음');put('I'+r,t?serial(t.finish,b.date1904):'');put('K'+r,t?.notes||'');merge(`B${r}:H${r}`);merge(`I${r}:J${r}`);merge(`K${r}:M${r}`);s.heights[r]=52;}
 b.milestonePanelEnd=end;s.rows=end;core.rows=Math.max(core.rows,indexLast);
 // Drop old dashboard cache entries, including its former O:Q detail panel.
 b.computed=[...new Map([...(b.computed||[]).filter(c=>c.sheet!==DASHBOARD),...out].map(c=>[c.sheet+'!'+c.address,c])).values()];return out;
}
export function writeNativeDashboard(b:Book,files:Record<string,Uint8Array>,options:{preserveCoreLayout?:boolean}={}){
 const s=b.sheets.find(s=>s.name===DASHBOARD),core=b.sheets.find(s=>s.name==='_MSP_C0');if(!s||!core||!b.milestoneSelection)return;
 const styles=xml(strFromU8(files['xl/styles.xml'])),root=styles.documentElement;
 function collection(name:string){let e=list(styles,name)[0];if(!e){e=styles.createElementNS(NS,name);root.appendChild(e);}return e;}
 function add(name:string,body:string){const group=collection(name),n=group.children.length,child=xml(`<r xmlns="${NS}">${body}</r>`).documentElement.firstElementChild!;group.appendChild(styles.importNode(child,true));group.setAttribute('count',String(group.children.length));return n;}
 // Reuse this export's native style IDs when exporting an already upgraded file.
 const wb=xml(strFromU8(files['xl/workbook.xml']));let defined=list(wb,'definedNames')[0];if(!defined){defined=wb.createElementNS(NS,'definedNames');wb.documentElement.insertBefore(defined,list(wb,'calcPr')[0]||null);}
 const styleName=list(wb,'definedName').find(n=>n.getAttribute('name')==='MSP_MilestoneStyles');let ids=styleName?.textContent?.replace(/^"|"$/g,'').split(',').map(Number);
 if(!ids||ids.length!==8||ids.some(n=>!Number.isInteger(n)||n>=collection('cellXfs').children.length)){
  const font=(size:number,color:string,bold=false)=>add('fonts',`<font>${bold?'<b/>':''}<sz val="${size}"/><color rgb="FF${color}"/><name val="맑은 고딕"/></font>`);
  const normal=font(10,'526882'),white=font(11,'FFFFFF',true),big=font(19,'2D5EAB',true),heading=font(19,'183550',true),small=font(9,'6B82A3');
  const fill=(color:string)=>add('fills',`<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`);const pale=fill('F3F7FC'),total=fill('EDF6FA'),navy=fill('183550'),selected=fill('EAF1FF');
  const border=add('borders','<border><left style="thin"><color rgb="FFE1E9F2"/></left><right style="thin"><color rgb="FFE1E9F2"/></right><top style="thin"><color rgb="FFE1E9F2"/></top><bottom style="thin"><color rgb="FFE1E9F2"/></bottom></border>');
  const formats=collection('numFmts'),existing=list(styles,'numFmt');const nf=(code:string)=>{const old=existing.find(e=>e.getAttribute('formatCode')===code);if(old)return Number(old.getAttribute('numFmtId'));const id=Math.max(163,...list(styles,'numFmt').map(n=>Number(n.getAttribute('numFmtId'))))+1;const e=styles.createElementNS(NS,'numFmt');e.setAttribute('numFmtId',String(id));e.setAttribute('formatCode',code);formats.appendChild(e);formats.setAttribute('count',String(formats.children.length));return id;};
  // numFmts must precede fonts in the OOXML stylesheet sequence.
  root.insertBefore(formats,root.firstElementChild);
  const xf=(fontId:number,fillId=0,numFmtId=0,align='left')=>add('cellXfs',`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="${align}" vertical="center" wrapText="1"/></xf>`);
  ids=[xf(heading),xf(white,navy,0,'center'),xf(normal,pale),xf(big,0,nf('0" 건"'),'center'),xf(small,0,0,'center'),xf(small,0,nf('"전체 작업 "0"건"'),'center'),xf(normal,selected),xf(normal,0,nf('yyyy-mm-dd'),'center')];
  // Total-row background and selected-cell emphasis use conditional formatting.
  const dxfs=collection('dxfs');add('dxfs','<dxf><font><b/><color rgb="FF275FC4"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFE4EEFF"/><bgColor rgb="FFE4EEFF"/></patternFill></fill><border><left style="medium"><color rgb="FF2863F6"/></left><right style="medium"><color rgb="FF2863F6"/></right><top style="medium"><color rgb="FF2863F6"/></top><bottom style="medium"><color rgb="FF2863F6"/></bottom></border></dxf>');
  const style=wb.createElementNS(NS,'definedName');style.setAttribute('name','MSP_MilestoneStyles');style.textContent='"'+ids.join(',')+'"';defined.appendChild(style);
 }
 const [title,header,agency,count,label,work,banner,date]=ids;const d=xml(strFromU8(files[s.path]));
 function styleAt(a:string){const m=a.match(/^([A-Z]+)(\d+)$/)!,r=+m[2],c=[...m[1]].reduce((n,v)=>n*26+v.charCodeAt(0)-64,0);if(r===2)return title;if(r===5||r===6||r===35)return header;if(r===32||r===33)return banner;if(r>=7&&r<=27){if(c<=5)return agency;return [count,label,work][(r-7)%3];}if(r>=36&&c>=9&&c<=10)return date;return agency;}
 const formatted=new Map(Object.entries(s.cells).filter(([,c])=>c.v!==''||c.f));for(let r=2;r<=s.rows;r++)if([2,3,5,6,29,30,32,33,35].includes(r)||r>=7&&r<=27||r>=36)for(let c=2;c<=13;c++){const a=col(c)+r;if(!formatted.has(a)||formatted.get(a)?.v==='')formatted.set(a,{s:0,v:''});}
 const cells=new Map<number,string[]>();for(const [a,cell]of formatted){const r=+a.match(/\d+/)![0];if(r>s.rows||!/^[A-M]\d+$/.test(a))continue;const value=typeof cell.v==='number'?`<v>${cell.v}</v>`:cell.v===''?'':`<is><t xml:space="preserve">${esc(cell.v)}</t></is>`;const valueWithFormula=cell.f?`<f>${esc(cell.f)}</f><v>${esc(cell.v)}</v>`:value;const body=`<c r="${a}" s="${styleAt(a)}"${typeof cell.v==='string'&&cell.v!==''&&!cell.f?' t="inlineStr"':''}>${valueWithFormula}</c>`;const row=cells.get(r)||[];row.push(body);cells.set(r,row);}
 const data=`<sheetData>${[...cells].sort((a,b)=>a[0]-b[0]).map(([r,items])=>`<row r="${r}" ht="${(s.heights[r]||27)/1.25}" customHeight="1">${items.sort((a,b)=>{const address=(s:string)=>s.match(/r="([A-Z]+)/)![1];const x=address(a),y=address(b);return x.length-y.length||x.localeCompare(y);}).join('')}</row>`).join('')}</sheetData>`;
 function replace(name:string,body:string){const e=xml(`<r xmlns="${NS}">${body}</r>`).documentElement.firstElementChild!,old=list(d,name)[0];if(old)old.replaceWith(d.importNode(e,true));else d.documentElement.appendChild(d.importNode(e,true));}
 replace('dimension',`<dimension ref="A1:M${s.rows}"/>`);
 replace('cols',`<cols>${Array.from({length:13},(_,i)=>`<col min="${i+1}" max="${i+1}" width="${((s.widths[i+1]||88)-5)/7}" customWidth="1"/>`).join('')}</cols>`);
 replace('sheetData',data);replace('mergeCells',`<mergeCells count="${s.merges.length}">${s.merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`);
 for(const e of list(d,'conditionalFormatting'))e.remove();
 const cfmt=xml(`<conditionalFormatting xmlns="${NS}" sqref="F7:M27"><cfRule type="expression" dxfId="${collection('dxfs').children.length-1}" priority="1"><formula>AND(ROW()&gt;=ROW(MSP_SelectedCell),ROW()&lt;ROW(MSP_SelectedCell)+3,COLUMN()&gt;=COLUMN(MSP_SelectedCell),COLUMN()&lt;COLUMN(MSP_SelectedCell)+2)</formula></cfRule></conditionalFormatting>`).documentElement;
 const before=list(d,'dataValidations')[0]||list(d,'hyperlinks')[0]||list(d,'printOptions')[0]||list(d,'pageMargins')[0]||null;d.documentElement.insertBefore(d.importNode(cfmt,true),before);
 const view=list(d,'sheetView')[0];if(view){view.setAttribute('showGridLines','0');for(const e of [...list(view,'pane'),...list(view,'selection')])e.remove();const p=d.createElementNS(NS,'pane');p.setAttribute('ySplit','6');p.setAttribute('topLeftCell','A7');p.setAttribute('activePane','bottomLeft');p.setAttribute('state','frozen');view.appendChild(p);const sel=d.createElementNS(NS,'selection');const orgIndex=dashboardOrganizations(b).indexOf(b.milestoneSelection.org),yearIndex=dashboardYears(b).indexOf(b.milestoneSelection.year),a=col(6+yearIndex*2)+(7+orgIndex*3);sel.setAttribute('pane','bottomLeft');sel.setAttribute('activeCell',a);sel.setAttribute('sqref',a);view.appendChild(sel);}
 const page=list(d,'pageSetup')[0];if(page){page.setAttribute('orientation','portrait');page.setAttribute('fitToWidth','1');page.setAttribute('fitToHeight','0');}const print=list(d,'printOptions')[0];if(print)print.setAttribute('horizontalCentered','1');
 files[s.path]=serialize(d);
 const names:Record<string,string>={MSP_MilestoneMatrix:`'${DASHBOARD}'!$F$7:$M$27`,MSP_MilestonePanel:`'${DASHBOARD}'!$B$36:$M$${s.rows}`,MSP_MilestoneStatus:`'${DASHBOARD}'!$B$32`,MSP_TaskIndex:`'_MSP_C0'!$AZ$2:$BF$${Math.max(2,...Object.keys(core.cells).filter(a=>/^BF\d+$/.test(a)&&core.cells[a].v!=='').map(a=>+a.slice(2)))}`,MSP_SelectedCell:`'${DASHBOARD}'!$${col(6+dashboardYears(b).indexOf(b.milestoneSelection.year)*2)}$${7+dashboardOrganizations(b).indexOf(b.milestoneSelection.org)*3}`,MSP_MilestoneLayout:'2'};
 for(const [key,value]of Object.entries(names)){let e=list(wb,'definedName').find(n=>n.getAttribute('name')===key);if(!e){e=wb.createElementNS(NS,'definedName');e.setAttribute('name',key);defined.appendChild(e);}e.textContent=value;}
 for(const e of list(wb,'definedName'))if(e.getAttribute('name')==='_xlnm.Print_Area'&&Number(e.getAttribute('localSheetId'))===b.sheets.indexOf(s))e.textContent=`'${DASHBOARD}'!$A$1:$M$${s.rows}`;
 files['xl/workbook.xml']=serialize(wb);files['xl/styles.xml']=serialize(styles);
 // Keep hidden helpers hidden after extending beyond the old fixed index.
 if(options.preserveCoreLayout)return;
 const db=xml(strFromU8(files[core.path]));let cols=list(db,'cols')[0];if(!cols){cols=db.createElementNS(NS,'cols');db.documentElement.insertBefore(cols,list(db,'sheetData')[0]);}for(const e of list(cols,'col')){const lo=Number(e.getAttribute('min')),hi=Number(e.getAttribute('max'));if(lo<=58&&hi>=52)e.setAttribute('hidden','1');}files[core.path]=serialize(db);
}
