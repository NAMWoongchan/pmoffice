'use client';
import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {FileSpreadsheet,FileText,LoaderCircle} from 'lucide-react';
import type {Report,ReportContext} from '../lib/report-model';
import {reportExcel,reportFilename} from '../lib/report-xlsx';

const Context=createContext<{context:ReportContext;busy:string;setBusy:(v:string)=>void}|null>(null);
export function ReportProvider({context,children}:{context:ReportContext;children:React.ReactNode}){const [busy,setBusy]=useState('');return <Context.Provider value={{context,busy,setBusy}}>{children}</Context.Provider>;}
export default function ReportDownloads({getReports,label='현재 화면'}:{getReports:(context:ReportContext)=>Report[];label?:string}){
 const state=useContext(Context);const [file,setFile]=useState<{url:string;name:string}|null>(null),[error,setError]=useState(''),[progress,setProgress]=useState('');const ref=useRef('');
 useEffect(()=>()=>{if(ref.current)URL.revokeObjectURL(ref.current);},[]);
 if(!state)return null;
 async function download(kind:'xlsx'|'pdf'){
  if(!state||state.busy)return;state.setBusy(label);setError('');setProgress('보고서를 준비하고 있습니다.');
  try{
   const generatedAt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date())+' KST';
   const reports=getReports({...state.context,generatedAt});if(!reports.length)throw Error('내보낼 보고서가 없습니다.');
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
   const bytes=kind==='xlsx'?reportExcel(reports):await (await import('../lib/report-pdf')).reportPdf(reports,{onProgress:setProgress});
   const blob=new Blob([bytes as BlobPart],{type:kind==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name=reportFilename(reports,kind);
   if(ref.current)URL.revokeObjectURL(ref.current);const url=URL.createObjectURL(blob);ref.current=url;setFile({url,name});
   const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setProgress(`${reports.length}개 보고서 ${kind==='pdf'?'PDF':'Excel'} 생성 완료`);
  }catch(e:any){setError(e?.message||'보고서를 생성하지 못했습니다. 다시 시도해 주세요.');setProgress('');}finally{state.setBusy('');}
 }
 return <div className="report-downloads" aria-label={label+' 다운로드'}><div className="report-download-buttons"><span>{label}</span><button disabled={!!state.busy} onClick={()=>download('xlsx')} aria-label={label+' Excel 다운로드'}><FileSpreadsheet size={15}/> Excel</button><button disabled={!!state.busy} onClick={()=>download('pdf')} aria-label={label+' PDF 다운로드'}><FileText size={15}/> PDF</button></div>{progress&&<div className="export-status" role="status">{state.busy===label&&<LoaderCircle size={13}/>} {progress}</div>}{file&&<><a className="export-save" href={file.url} download={file.name}>생성된 파일 저장 · {file.name.endsWith('.pdf')?'PDF':'Excel'}</a>{file.name.endsWith('.pdf')&&<a className="export-save" href={file.url} target="_blank" rel="noopener">PDF 미리보기 ↗</a>}</>}{error&&<p className="export-error" role="alert">{error}</p>}</div>;
}
