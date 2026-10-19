'use client';
import {useMemo,useRef} from 'react';
import {Task,belongs,inYear} from '../lib/workbook';
import {milestoneTasks,milestoneAudit} from '../lib/milestones';
import ReportDownloads from './ReportDownloads';
import {milestonesReport} from '../lib/report-model';
import {TaskTable} from './Reports';

export default function Milestones({tasks,orgs,years,org,year,at,onSelect,onEdit}:{tasks:Task[];orgs:string[];years:string[];org:string;year:string;at:string;onSelect:(org:string,year:string)=>void;onEdit:(t:Task)=>void}){
 const detail=useRef<HTMLDivElement>(null);
 const model=useMemo(()=>{
  const rows=['',...orgs].map(o=>({org:o,cells:years.map(y=>({year:y,items:milestoneTasks(tasks,o,y),work:tasks.filter(t=>!t.summary&&belongs(t,o)&&inYear(t,y)).length}))}));
  return {rows,selected:milestoneTasks(tasks,org,year),audit:milestoneAudit(tasks)};
 },[tasks,orgs,years,org,year]);
 function select(o:string,y:string){onSelect(o,y);detail.current?.scrollIntoView({behavior:'smooth',block:'start'});}
 const scope=`${org||'전체 참여기관'} · ${year==='all'?'전체 연도':year+'년'}`;
 return <><ReportDownloads label="마일스톤 보고" getReports={c=>[milestonesReport(tasks,orgs,years,c)]}/>
  <section className="panel milestone-matrix-panel">
   <div className="panel-head"><div><h2>참여기관 × 사업연도 마일스톤</h2><p className="muted">마일스톤 개수를 선택하면 같은 기관·연도의 이름과 날짜를 아래에서 확인합니다.</p></div><span className="tag">완료 예정일 기준</span></div>
   <div className="table-scroll"><table className="matrix milestone-matrix"><caption className="sr-only">사업연도별 마일스톤 개수. 큰 숫자는 마일스톤, 작은 숫자는 일정 중첩 전체 작업입니다.</caption><thead><tr><th scope="col">참여기관</th>{years.map(y=><th scope="col" key={y}>{y}년</th>)}</tr></thead><tbody>{model.rows.map(row=><tr key={row.org||'all'} className={row.org?'':'project-total'}><th scope="row">{row.org||'전체 참여기관'}{!row.org&&<small>공동 작업 중복 제외</small>}</th>{row.cells.map(cell=>{const active=org===row.org&&year===cell.year;return <td key={cell.year}><button data-milestone-org={row.org} data-milestone-year={cell.year} aria-pressed={active} aria-label={`${row.org||'전체 참여기관'} ${cell.year}년 마일스톤 ${cell.items.length}건 상세 보기`} className={active?'picked':''} onClick={()=>select(row.org,cell.year)}><strong>{cell.items.length}<small>건</small></strong><span>마일스톤{active?' · 선택됨':''}</span><small className="matrix-work">전체 작업 {cell.work}건</small></button></td>;})}</tr>)}</tbody></table></div>
   <p className="footnote">사업연도는 1월 1일–12월 31일입니다. ‘중요 시점’이 Yes인 최하위 작업을 완료 예정 연도에 1건씩 집계합니다. 일반 작업의 일정 중첩 건수와 구분합니다. 공동 작업은 각 기관에 포함되며 전체 행에서는 중복 제외합니다.</p>
   {model.audit.summaries>0&&<p className="footnote">중요 시점으로 표시된 요약 작업 {model.audit.summaries}건은 하위 작업과 중복되지 않도록 제외했습니다.</p>}
  </section>
  {model.audit.undated.length>0&&<div className="notice milestone-warning" role="status">완료 예정일을 확인해야 할 마일스톤 {model.audit.undated.length}건이 있습니다. 연도별 집계에서는 제외합니다. <button onClick={()=>onSelect('','all')}>전체 연도에서 확인</button></div>}
  <div ref={detail} className="milestone-selection" aria-live="polite" aria-atomic="true"><span>선택한 일정</span><h2>{scope} 마일스톤 일정 <b>{model.selected.length}건</b></h2><p>위 표의 선택 표시와 상단 필터가 함께 변경됩니다. 날짜는 완료 예정일이며 yyyy-mm-dd로 표시합니다.</p></div>
  <TaskTable key={`${org}|${year}`} tasks={model.selected} at={at} onEdit={onEdit} title="마일스톤 일정 확인" initialSort="finish"/>
 </>;
}
