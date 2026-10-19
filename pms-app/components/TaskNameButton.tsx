'use client';
import {ArrowUpRight} from 'lucide-react';
import {Task} from '../lib/workbook';
export default function TaskNameButton({task,onOpen,showWbs=false,indent=0}:{task:Task;onOpen:(task:Task)=>void;showWbs?:boolean;indent?:number}){
 const label=task.name.replace(/\s+/g,' ').trim();
 return <button type="button" className="task-name-button" style={{paddingLeft:indent}} aria-label={label+' · 오른쪽 상세 정보 열기'} title="클릭하여 오른쪽 상세 정보에서 전체 내용을 확인하세요" onClick={e=>{e.stopPropagation();onOpen(task);}} onKeyDown={e=>e.stopPropagation()}>{showWbs&&<small>{task.wbs}</small>}{task.milestone&&<i className="diamond"/>}<span className="task-name-text">{label}</span><ArrowUpRight size={12} aria-hidden="true"/></button>;
}
