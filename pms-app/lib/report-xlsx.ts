import {zipSync,strToU8} from 'fflate';
import type {Report,ReportSection,ReportColumn,ReportValue} from './report-model';
import {serial} from './task-model';
import {isISODate} from './validation';

const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relns='http://schemas.openxmlformats.org/package/2006/relationships';
const off='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const x=(v:unknown)=>String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const col=(n:number):string=>n>26?col(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):String.fromCharCode(64+n);
const xml=(v:string)=>'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+v;
function sheetNames(reports:Report[]){const used=new Set<string>();return reports.map(r=>{const base=r.title.replace(/[\[\]:*?/\\]/g,' ').replace(/^'+|'+$/g,'').trim().slice(0,27)||'보고서';let name=base,i=1;while(used.has(name.toLowerCase()))name=base+'_'+i++;used.add(name.toLowerCase());return name;});}
export function reportFilename(reports:Report[],extension:string){const c=reports[0]?.context;const title=reports.length===1?reports[0].title:'전체_주요보고서';return `${title}_${c?.year==='all'?'전체연도':c?.year||''}_기준일_${c?.at||''}.${extension}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_');}
export function reportExcel(reports:Report[]):Uint8Array{
 if(!reports.length)throw Error('내보낼 보고서가 없습니다.');
 const files:Record<string,Uint8Array>={},put=(p:string,s:string)=>files[p]=strToU8(xml(s));
 const names=sheetNames(reports),overrides:string[]=[];let chartId=0;
 const contentTypes=['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>','<Default Extension="xml" ContentType="application/xml"/>','<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>','<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
 const printNames:string[]=[];
 reports.forEach((report,si)=>{
  let row=1,maxCol=9;const rows:string[]=[],merges:string[]=[],drawings:string[]=[],chartRels:string[]=[];let drawingCount=0;
  const widths:number[]=Array(64).fill(14);
  const textCell=(a:string,v:unknown,style=5)=>`<c r="${a}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  const cell=(a:string,v:ReportValue,c:ReportColumn)=>{
   if(v===null||v==='')return `<c r="${a}" s="${c.kind==='date'?8:c.kind==='percent'?7:5}"/>`;
   const number=c.kind==='date'&&isISODate(String(v))?serial(String(v)):typeof v==='number'?v:null;
   return number!==null&&Number.isFinite(number)?`<c r="${a}" s="${c.kind==='date'?8:c.kind==='percent'?7:6}"><v>${number}</v></c>`:textCell(a,v);
  };
  const addTitle=(value:string,style:number,height=26)=>{rows.push(`<row r="${row}" ht="${height}" customHeight="1">${textCell('A'+row,value,style)}</row>`);merges.push(`A${row}:I${row}`);row++;};
  addTitle(report.title,1,33);
  addTitle(report.context.project,2,25);
  addTitle(`연도: ${report.context.year==='all'?'전체 연도':report.context.year+'년'} / 기관: ${report.context.org||'전체 참여기관'} / 기준일: ${report.context.at} / 집계: ${report.context.basis==='finish'?'완료 예정 연도':'일정 중첩'}`,2,25);
  addTitle(`원본: ${report.context.source} / ${report.context.version} / 생성: ${report.context.generatedAt||new Date().toISOString()}`,2,25);
  if(report.note)addTitle(report.note,2,32);
  row++;
  for(const section of report.sections){
   addTitle(section.title,3,26);
   if(section.gantt){
    const g=section.gantt,columns:ReportColumn[]=[{label:'ID',width:42},{label:'WBS',width:70},{label:'작업 이름',width:280},{label:'시작',kind:'date',width:85},{label:'완료',kind:'date',width:85},{label:'완료율',kind:'percent',width:70},...g.months.map(m=>({label:m,width:50}))];
    maxCol=Math.max(maxCol,columns.length);columns.forEach((c,i)=>widths[i]=Math.max(widths[i],(c.width||90)/7));
    rows.push(`<row r="${row}" ht="26" customHeight="1">${columns.map((c,i)=>textCell(col(i+1)+row,c.label,4)).join('')}</row>`);row++;
    for(const t of g.tasks){const values:ReportValue[]=[t.id,t.wbs,t.name,t.start,t.finish,Number.isFinite(t.pct)?t.pct:null];rows.push(`<row r="${row}" ht="25" customHeight="1" outlineLevel="${Math.max(0,Math.min(7,t.level-1))}">${columns.map((c,i)=>i<6?cell(col(i+1)+row,values[i],c):`<c r="${col(i+1)+row}" s="${isISODate(t.start)&&isISODate(t.finish)&&t.start.slice(0,7)<=g.months[i-6]&&t.finish.slice(0,7)>=g.months[i-6]?10:5}"/>`).join('')}</row>`);row++;}
    addTitle('간트의 긴 작업명은 작업 상세 목록에서 전체 내용을 확인하세요.',2,24);row++;continue;
   }
   const header=row;maxCol=Math.max(maxCol,section.columns.length);
   section.columns.forEach((c,i)=>widths[i]=Math.max(widths[i],Math.min(54,(c.width||95)/7)));
   rows.push(`<row r="${row}" ht="27" customHeight="1">${section.columns.map((c,i)=>textCell(col(i+1)+row,c.label,4)).join('')}</row>`);row++;
   for(const data of section.rows){const lines=Math.max(1,...data.map((v,i)=>String(v??'').split('\n').reduce((n,l)=>n+Math.ceil((l.length||1)/Math.max(8,widths[i]*.7)),0)));const height=Math.min(409,Math.max(24,lines*14+8));rows.push(`<row r="${row}" ht="${height}" customHeight="1">${section.columns.map((c,i)=>cell(col(i+1)+row,data[i]??null,c)).join('')}</row>`);row++;}
   if(!section.rows.length){addTitle('해당 조건의 데이터가 없습니다.',2,25);}
   if(section.chart&&section.rows.length){
    chartId++;drawingCount++;const cr=chartId;
    put(`xl/charts/chart${cr}.xml`,chartXml(section,names[si],header+1,cr));
    overrides.push(`<Override PartName="/xl/charts/chart${cr}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
    drawings.push(`<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row+17}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${drawingCount}" name="보고 차트 ${cr}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${drawingCount}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`);
    chartRels.push(`<Relationship Id="rId${drawingCount}" Type="${off}/chart" Target="../charts/chart${cr}.xml"/>`);row+=19;
   }
   if(section.note)addTitle(section.note,2,32);row+=2;
  }
  const drawing=drawings.length?`<drawing r:id="rId1"/>`:'';
  if(drawings.length){put(`xl/drawings/drawing${si+1}.xml`,`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${off}">${drawings.join('')}</xdr:wsDr>`);put(`xl/drawings/_rels/drawing${si+1}.xml.rels`,`<Relationships xmlns="${relns}">${chartRels.join('')}</Relationships>`);put(`xl/worksheets/_rels/sheet${si+1}.xml.rels`,`<Relationships xmlns="${relns}"><Relationship Id="rId1" Type="${off}/drawing" Target="../drawings/drawing${si+1}.xml"/></Relationships>`);overrides.push(`<Override PartName="/xl/drawings/drawing${si+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);}
  put(`xl/worksheets/sheet${si+1}.xml`,`<worksheet xmlns="${main}" xmlns:r="${off}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${col(maxCol)}${row}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.slice(0,maxCol).map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w.toFixed(2)}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(r=>`<mergeCell ref="${r}"/>`).join('')}</mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;LPMOffice&amp;R&amp;P / &amp;N</oddFooter></headerFooter>${drawing}</worksheet>`);
  overrides.push(`<Override PartName="/xl/worksheets/sheet${si+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  printNames.push(`<definedName name="_xlnm.Print_Area" localSheetId="${si}">'${x(names[si].replace(/'/g,"''"))}'!$A$1:$${col(maxCol)}$${row}</definedName>`);
 });
 put('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${contentTypes.join('')}${overrides.join('')}</Types>`);
 put('_rels/.rels',`<Relationships xmlns="${relns}"><Relationship Id="rId1" Type="${off}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
 put('xl/workbook.xml',`<workbook xmlns="${main}" xmlns:r="${off}"><sheets>${names.map((n,i)=>`<sheet name="${x(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><definedNames>${printNames.join('')}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
 put('xl/_rels/workbook.xml.rels',`<Relationships xmlns="${relns}">${names.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${off}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${names.length+1}" Type="${off}/styles" Target="styles.xml"/></Relationships>`);
 put('xl/styles.xml',styles);
 return zipSync(files,{level:6});
}
function chartXml(s:ReportSection,name:string,start:number,id:number){
 const chart=s.chart!,sheet="'"+name.replace(/'/g,"''")+"'!",end=start+s.rows.length-1;
 const cat=s.rows.map((r,i)=>`<c:pt idx="${i}"><c:v>${x(r[chart.labelColumn])}</c:v></c:pt>`).join('');
 const series=chart.series.map((v,i)=>`<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${x(v.label)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${v.color}"/></a:solidFill></c:spPr><c:cat><c:strRef><c:f>${x(sheet+`$${col(chart.labelColumn+1)}$${start}:$${col(chart.labelColumn+1)}$${end}`)}</c:f><c:strCache><c:ptCount val="${s.rows.length}"/>${cat}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${x(sheet+`$${col(v.column+1)}$${start}:$${col(v.column+1)}$${end}`)}</c:f><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="${s.rows.length}"/>${s.rows.map((r,j)=>`<c:pt idx="${j}"><c:v>${Number(r[v.column])||0}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val></c:ser>`).join('');
 const a=id*2+100,b=a+1;return `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series}<c:axId val="${a}"/><c:axId val="${b}"/></c:barChart><c:catAx><c:axId val="${a}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="${b}"/><c:tickLblPos val="nextTo"/></c:catAx><c:valAx><c:axId val="${b}"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:axPos val="l"/><c:numFmt formatCode="0" sourceLinked="0"/><c:crossAx val="${a}"/><c:crosses val="autoZero"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}
const styles=`<styleSheet xmlns="${main}"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="4"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><sz val="10"/><color rgb="FF64748B"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173553"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF168B91"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF477FD1"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFE4EAF1"/></left><right style="thin"><color rgb="FFE4EAF1"/></right><top style="thin"><color rgb="FFE4EAF1"/></top><bottom style="thin"><color rgb="FFE4EAF1"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="2" borderId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf fontId="2" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf fontId="3" fillId="2" borderId="0"/><xf fontId="3" fillId="3" borderId="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf fontId="0" fillId="0" borderId="1" numFmtId="3" applyNumberFormat="1"/><xf fontId="0" fillId="0" borderId="1" numFmtId="165" applyNumberFormat="1"/><xf fontId="0" fillId="0" borderId="1" numFmtId="164" applyNumberFormat="1"/><xf fontId="0" fillId="0" borderId="1"/><xf fontId="0" fillId="4" borderId="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
