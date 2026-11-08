import React, { useMemo, useState } from 'react';
import { timeline, timelineBar, type Scale } from '../lib/nexpharm-timescale';
import { type Task } from '../lib/workbook';

export function NexpharmSchedule({ tasks, start, finish, asOf }: { tasks: Task[]; start: string; finish: string; asOf: string }) {
  const [scale, setScale] = useState<Scale>('month');
  const [periodPage, setPeriodPage] = useState(0);
  const [rowPage, setRowPage] = useState(0);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('');
  const [selected, setSelected] = useState<Task | null>(null);
  const levels = [...new Set(tasks.map(task => task.level))].sort((a, b) => a - b);
  const rows = useMemo(() => tasks.filter(task => (!level || task.level <= Number(level)) &&
    (task.name.toLowerCase().includes(query.toLowerCase().trim()) || task.wbs.includes(query.trim()))), [tasks, query, level]);
  const { periods, hasNext } = useMemo(() => timeline(start, finish, scale, periodPage), [start, finish, scale, periodPage]);
  const pageCount = Math.max(1, Math.ceil(rows.length / 60));

  return <>
    <div className="view-toolbar nex-toolbar">
      <div className="segmented" role="group" aria-label="날짜 표시줄">
        {(['month', 'week'] as const).map(mode => <button key={mode} className={scale === mode ? 'active' : ''}
          aria-pressed={scale === mode} onClick={() => { setScale(mode); setPeriodPage(0); }}>
          {mode === 'month' ? '월별' : '주별'}
        </button>)}
      </div>
      <input aria-label="작업명 또는 WBS 검색" placeholder="작업명 또는 WBS 검색" value={query}
        onChange={event => { setQuery(event.target.value); setRowPage(0); }}/>
      <select value={level} aria-label="개요 수준" onChange={event => { setLevel(event.target.value); setRowPage(0); }}>
        <option value="">모든 개요 수준</option>
        {levels.map(value => <option key={value} value={value}>{value}수준까지</option>)}
      </select>
    </div>
    <section className="panel gantt-panel">
      <div className="pagination nex-period-controls">
        <span>{periods[0]?.start} ~ {periods.at(-1)?.end}{scale === 'week' && ' · 월요일~일요일'}</span>
        <div>
          <button disabled={periodPage === 0} onClick={() => setPeriodPage(periodPage - 1)}>이전 기간</button>
          <button disabled={!hasNext} onClick={() => setPeriodPage(periodPage + 1)}>다음 기간</button>
        </div>
      </div>
      <div className="gantt-scroll" tabIndex={0} role="region" aria-label="사업 일정표 가로 스크롤">
        <table className="gantt nex-gantt">
          <thead><tr><th className="sticky-name" scope="col">작업 이름 / WBS</th><th scope="col">시작</th><th scope="col">완료</th><th scope="col">완료율</th>
            {periods.map(period => <th key={period.start} scope="col" className="month-head" title={period.start + ' ~ ' + period.end}>{period.label}</th>)}</tr></thead>
          <tbody>{rows.slice(rowPage * 60, (rowPage + 1) * 60).map(task => <tr key={task.id} className={task.summary ? 'summary' : ''}>
            <th className="sticky-name" scope="row"><button className="nex-task" style={{ paddingInlineStart: Math.min(task.level, 5) * 10 }}
              onClick={() => setSelected(task)}><small>{task.wbs}</small> {task.name}</button></th>
            <td className="date">{task.start}</td><td className="date">{task.finish}</td><td>{Math.round(task.pct * 100)}%</td>
            {periods.map(period => {
              const bar = timelineBar(task.start, task.finish, task.milestone, period);
              return <td key={period.start} className={'gantt-cell ' + (asOf >= period.start && asOf <= period.end ? 'current-month' : '')}>
                {bar && (task.milestone
                  ? <span className="nex-diamond" style={{ left: bar.left + '%' }} aria-label="마일스톤"/>
                  : <div className={'gantt-bar ' + (task.summary ? 'summary-bar ' : '') + (task.pct === 1 ? 'complete-bar' : '')}
                    style={{ left: bar.left + '%', width: bar.width + '%' }} />)}
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      {!rows.length && <p className="nex-empty-detail">조건에 맞는 작업이 없습니다.</p>}
      <div className="pagination">
        <span>{rows.length}개 행 · {rowPage + 1} / {pageCount} · ◆ 마일스톤</span>
        <div><button disabled={rowPage === 0} onClick={() => setRowPage(rowPage - 1)}>이전 작업</button>
          <button disabled={rowPage + 1 >= pageCount} onClick={() => setRowPage(rowPage + 1)}>다음 작업</button></div>
      </div>
    </section>
    {selected && <section className="panel nex-task-detail" aria-label="선택한 작업">
      <h2>{selected.name}</h2>
      <p>WBS {selected.wbs} · {selected.start} ~ {selected.finish} · 완료율 {Math.round(selected.pct * 100)}%</p>
      {selected.org && <p>자원 {selected.org}</p>}
      {selected.predecessors && <p>선행 작업 {selected.predecessors}</p>}
      {selected.successors && <p>후속 작업 {selected.successors}</p>}
      {selected.notes && <p className="nex-task-notes">{selected.notes}</p>}
      <button onClick={() => setSelected(null)}>작업 상세 닫기</button>
    </section>}
  </>;
}
