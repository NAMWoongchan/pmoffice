import type {Report,ReportSection,ReportColumn,ReportValue} from './report-model';
import {embedReportFont} from './pdf-glyph-font';
import {isISODate} from './validation';

const format=(value:ReportValue,c:ReportColumn)=>value===null?'확인 필요':c.kind==='percent'&&typeof value==='number'?(value*100).toFixed(1)+'%':typeof value==='number'?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(value):String(value??'');
export async function reportPdf(reports:Report[],options:{canvasFactory?:()=>any;onProgress?:(value:string)=>void}={}):Promise<Uint8Array>{
 if(!reports.length)throw Error('내보낼 보고서가 없습니다.');
 if(typeof document!=='undefined')await Promise.race([document.fonts.load('100px "PMOffice Report"','프로젝트 보고서'),new Promise(resolve=>setTimeout(resolve,8000))]);
 const lib=await import('./vendor/pdf-lib.mjs'),doc=await lib.PDFDocument.create();
 doc.setTitle(reports.length===1?reports[0].title:'프로젝트 주요 보고서');doc.setAuthor('PMOffice');doc.setSubject('프로젝트 일정·작업·마일스톤 보고');
 const seed=JSON.stringify(reports)+'PMOffice 페이지 생성 기준일 보고서 기관 전체 기간 연도 원본 집계 완료 예정 일정 중첩 월별 간트 작업 상세 목록 확인 필요 데이터 없음 이어짐 작업명 줄임 전체 이름 상세 목록에 수록 총 건 해당 조건의 데이터가 없습니다 이어짐 차트 최대 년 기관 전체 참여기관 원본 판정 기준일 생성 페이지 간트의 긴 작업명은 줄여 표시합니다 뒤의 작업 상세 목록에 수록합니다 월별 간트 일정표 0123456789%/.-(): → · …';
 options.onProgress?.('한글 글꼴과 보고서를 준비하고 있습니다.');
 const font=await embedReportFont(doc,lib,seed,options.canvasFactory);
 const W=841.89,H=595.28,M=31,BOTTOM=39,usable=W-M*2;
 const color=(hex:string)=>lib.rgb(parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255);
 const navy=color('183654'),muted=color('6c7e92'),ink=color('20364c'),blue=color('366ed2'),white=lib.rgb(1,1,1),border=color('dfe7ef');
 let page:any,y=0,current:Report=reports[0];const starts:{title:string;page:any}[]=[];
 const text=(s:string,x:number,yy:number,size=8.5,c=ink)=>font.draw(page,s,x,yy,size,c);
 const wrap=(s:string,width:number,size:number)=>{const out:string[]=[];for(const line of String(s).replace(/\r/g,'').split('\n')){let part='';for(const c of Array.from(line)){if(part&&font.measure(part+c,size)>width){out.push(part);part=c;}else part+=c;}out.push(part);}return out;};
 function newPage(){page=doc.addPage([W,H]);page.drawRectangle({x:0,y:H-65,width:W,height:65,color:navy});text(current.title,M,H-30,16,white);text(current.context.project,M,H-49,8.4,white);
  const c=current.context,year=c.year==='all'?'전체 연도':c.year+'년';text(`연도 ${year} · 기관 ${c.org||'전체 참여기관'} · 판정 기준일 ${c.at} · ${c.basis==='finish'?'완료 예정 연도':'일정 중첩'}`,M,H-84,8.2,ink);
  const source=`원본 ${c.source} · ${c.version} · 생성 ${c.generatedAt||new Date().toISOString()}`;const lines=wrap(source,usable,7.2);lines.forEach((s,i)=>text(s,M,H-99-i*10,7.2,muted));y=H-117-(lines.length-1)*10;
 }
 function ensure(height:number){if(y-height<BOTTOM)newPage();}
 function paragraph(value:string,size=8.2,c=muted){for(const line of wrap(value,usable,size)){ensure(size+5);text(line,M,y,size,c);y-=size+5;}y-=6;}
 function heading(value:string){ensure(36);text(value,M,y,11.5,navy);y-=20;}
 function table(section:ReportSection,indices:number[],suffix:string){
  // Keep the section title, column headings and first data/empty row together.
  ensure(80);
  heading(section.title+suffix);
  const columns=indices.map(i=>section.columns[i]);const desired=columns.map(c=>c.width||(c.kind==='date'?82:c.kind==='number'||c.kind==='percent'?55:105));const sum=desired.reduce((n,v)=>n+v,0),widths=desired.map(v=>v/sum*usable);const size=8,lh=11;
  function header(){ensure(39);let x=M;columns.forEach((c,i)=>{page.drawRectangle({x,y:y-26,width:widths[i],height:26,color:navy});wrap(c.label,widths[i]-9,8).slice(0,2).forEach((s,j)=>text(s,x+4,y-11-j*9,8,white));x+=widths[i];});y-=26;}
  header();
  if(!section.rows.length){ensure(30);text('해당 조건의 데이터가 없습니다. 0건',M+6,y-17,9,muted);y-=34;}
  section.rows.forEach((data,ri)=>{
   const lines=indices.map((ci,i)=>wrap(format(data[ci]??null,columns[i]),widths[i]-10,size));const max=Math.max(1,...lines.map(a=>a.length));let offset=0;
   while(offset<max){
    if(y-BOTTOM<25){newPage();heading(section.title+suffix+' (이어짐)');header();}
    const fit=Math.max(1,Math.floor((y-BOTTOM-9)/lh)),count=Math.min(max-offset,fit),height=count*lh+9;let x=M;
    columns.forEach((c,i)=>{page.drawRectangle({x,y:y-height,width:widths[i],height,color:ri%2?color('f5f8fc'):white,borderColor:border,borderWidth:.4});const part=lines[i].slice(offset,offset+count);if(!part.length&&i<Math.min(3,columns.length))part.push(lines[i][0]||'');part.forEach((s,j)=>text(s,x+5,y-12-j*lh,size,ink));x+=widths[i];});y-=height;offset+=count;
    if(offset<max){newPage();heading(section.title+suffix+' (이어짐)');header();}
   }
  });y-=15;
 }
 function chart(section:ReportSection){
  const chart=section.chart!;
  for(let begin=0;begin<section.rows.length;begin+=10){const rows=section.rows.slice(begin,begin+10),rowH=chart.series.length>2?34:28,height=rows.length*rowH+40;ensure(height+25);heading(section.title+' · 차트');
   const max=Math.max(1,...rows.flatMap(r=>chart.series.map(s=>Number(r[s.column])||0))),labelW=160,chartW=usable-labelW-60;
   rows.forEach(r=>{const label=String(r[chart.labelColumn]??'');text(label,M,y-10,8,ink);chart.series.forEach((s,i)=>{const v=Number(r[s.column])||0;const hh=chart.series.length>2?3:4;page.drawRectangle({x:M+labelW,y:y-3-i*(hh+1),width:chartW*v/max,height:hh,color:color(s.color)});});text(chart.series.map(s=>`${s.label} ${r[s.column]??0}`).join(' / '),M+labelW,y-rowH+7,6.7,muted);y-=rowH;});
   text(`0${' '.repeat(6)}최대 ${max}건`,M+labelW,y-8,7,muted);y-=30;
  }
 }
 function gantt(section:ReportSection){
  const g=section.gantt!;if(!g.months.length||!g.tasks.length){heading(section.title);paragraph('해당 조건의 일정이 없습니다.');return;}
  for(let band=0;band<g.months.length;band+=12)for(let first=0;first<g.tasks.length;first+=22){
   if(band||first||y<H-120)newPage();const months=g.months.slice(band,band+12);heading(`${section.title} · ${months[0]} ~ ${months.at(-1)}`);
   const fixed=[249,67,67],mw=(usable-fixed.reduce((n,v)=>n+v,0))/months.length,x0=M+383,head=25,rh=16;
   const labels=['ID · WBS · 작업 이름','시작','완료',...months],ws=[...fixed,...months.map(()=>mw)];let xx=M;
   labels.forEach((s,i)=>{page.drawRectangle({x:xx,y:y-head,width:ws[i],height:head,color:navy});text(s,xx+3,y-15,i>2?6.5:8,white);xx+=ws[i];});y-=head;
   for(const t of g.tasks.slice(first,first+22)){
    page.drawRectangle({x:M,y:y-rh,width:usable,height:rh,color:t.summary?color('eaf1fa'):white,borderColor:border,borderWidth:.4});
    const raw=`${t.id} · ${t.wbs} · ${t.name}`;let label=raw;while(font.measure(label,7)>fixed[0]-8&&label.length>1)label=label.slice(0,-1);if(label!==raw)label=label.slice(0,-1)+'…';text(label,M+3,y-11,7);text(t.start,M+252,y-11,7);text(t.finish,M+319,y-11,7);
    months.forEach((month,i)=>{const days=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).getUTCDate(),last=month+'-'+days,start=month+'-01',x=x0+i*mw;page.drawLine({start:{x,y},end:{x,y:y-rh},thickness:.3,color:border});if(!isISODate(t.start)||!isISODate(t.finish)||t.start>t.finish||t.start>last||t.finish<start)return;
     const left=t.start.startsWith(month)?(+t.start.slice(8)-1)/days:0,right=t.finish.startsWith(month)?+t.finish.slice(8)/days:1;const bx=x+left*mw,bw=Math.max(1,(right-left)*mw);page.drawRectangle({x:bx,y:y-11,width:bw,height:t.summary?3:6,color:t.pct===1?color('159e97'):blue});
     if(t.milestone&&t.finish.startsWith(month))page.drawSvgPath('M 0 3 L 3 0 L 0 -3 L -3 0 Z',{x:x+right*mw-1,y:y-8,color:navy});
    });y-=rh;
   }
   y-=15;paragraph('간트의 긴 작업명은 줄여 표시합니다. 전체 작업 이름과 메모는 뒤의 작업 상세 목록에 수록합니다.',7.5);
  }
 }
 for(const report of reports){current=report;newPage();starts.push({title:report.title,page});options.onProgress?.(report.title+' 생성 중');if(report.note)paragraph(report.note);
  for(const section of report.sections){if(section.gantt){gantt(section);continue;}if(section.chart&&section.rows.length)chart(section);
   const n=section.columns.length;if(!n)continue;const repeat=n>9&&section.columns.some(c=>c.label==='작업 이름')?3:1;
   const bands:number[][]=[];if(n<=9)bands.push(Array.from({length:n},(_,i)=>i));else for(let offset=repeat;offset<n;offset+=8-repeat)bands.push([...Array.from({length:repeat},(_,i)=>i),...Array.from({length:Math.min(8-repeat,n-offset)},(_,i)=>i+offset)]);
   bands.forEach((indices,i)=>table(section,indices,bands.length>1?` (${i+1}/${bands.length})`:''));if(section.note)paragraph(section.note);
  }
 }
 const pages=doc.getPages();pages.forEach((p:any,i:number)=>{page=p;text(`PMOffice · 판정 기준일 ${reports[0].context.at}`,M,19,7,muted);text(`${i+1} / ${pages.length}`,W-M-48,19,8,muted);});
 const root=doc.context.obj({Type:'Outlines'}),rootRef=doc.context.register(root),items=starts.map(()=>doc.context.register(doc.context.obj({})));
 starts.forEach((s,i)=>{const item=doc.context.lookup(items[i]);item.set(lib.PDFName.of('Title'),lib.PDFHexString.fromText(s.title));item.set(lib.PDFName.of('Parent'),rootRef);item.set(lib.PDFName.of('Dest'),doc.context.obj([s.page.ref,'Fit']));if(i)item.set(lib.PDFName.of('Prev'),items[i-1]);if(i<items.length-1)item.set(lib.PDFName.of('Next'),items[i+1]);});
 root.set(lib.PDFName.of('First'),items[0]);root.set(lib.PDFName.of('Last'),items.at(-1));root.set(lib.PDFName.of('Count'),doc.context.obj(items.length));doc.catalog.set(lib.PDFName.of('Outlines'),rootRef);
 return doc.save();
}
