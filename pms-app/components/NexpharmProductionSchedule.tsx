import React, { useMemo, useState } from 'react';
import { productionColors, type ProductionSchedule, type ProductionTask } from '../lib/nexpharm-production';

const pageSize = 60;
const columns: [keyof ProductionTask, string][] = [
  ['id', 'ID'], ['name', '작업 이름'], ['code', '전산코드'], ['lot', '제조번호'], ['quantity', '제조량'],
  ['duration', '기간'], ['hours', '작업 시간'], ['start', '시작'], ['finish', '완료'], ['resource', '자원 이름'],
  ['predecessor', '선행 작업'], ['unit', '포장 단위'], ['category', '구분'], ['contractor', '위수탁사'], ['notes', '메모'],
];
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
const display = (value: string | number) => typeof value === 'number' ? number.format(value) : value;

export function NexpharmProductionSchedule({ schedule }: { schedule: ProductionSchedule }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('ko');
    return search ? schedule.tasks.filter(task => [task.name, task.code, task.resource]
      .some(value => value.toLocaleLowerCase('ko').includes(search))) : schedule.tasks;
  }, [schedule, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return <section className="panel nex-production">
    <div className="nex-production-toolbar">
      <label>작업 검색<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }}/></label>
      <span role="status">{query.trim() ? `${number.format(filtered.length)}개 검색 · ` : ''}{number.format(schedule.tasks.length)}개 일정 항목</span>
      <nav aria-label="일정표 페이지">
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button>
        <span>{page + 1} / {pages}</span>
        <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>다음</button>
      </nav>
    </div>
    <div className="nex-production-scroll" tabIndex={0} role="region" aria-label="작업 목록과 일별 간트 차트">
      <table>
        <thead><tr>
          {columns.map(([key, label]) => <th key={key} scope="col" className={'prod-' + key}>{label}</th>)}
          {schedule.days.map(day => <th key={day.date} scope="col" title={day.date}
            className={'prod-day' + (day.workday ? '' : ' prod-off')}>{day.date.slice(5).replace('-', '/')}</th>)}
        </tr></thead>
        <tbody>{rows.map(task => {
          const summary = task.level < 3;
          const dark = task.level === 2 || task.color === '진한 파랑';
          return <tr key={task.id} className={summary ? 'prod-summary' : undefined}>
            {columns.map(([key]) => key === 'name'
              ? <th key={key} scope="row" className="prod-name" title={task.name}
                style={{ paddingInlineStart: 10 + (task.level - 1) * 14 }}>{task.name}</th>
              : <td key={key} className={'prod-' + key} title={String(task[key])}>{display(task[key])}</td>)}
            {schedule.days.map(day => {
              const first = day.date === task.start && !!task.finish;
              const active = !!task.start && !!task.finish && day.date >= task.start && day.date <= task.finish
                && (summary || day.workday || first);
              return <td key={day.date} className={'prod-day' + (day.workday ? '' : ' prod-off')}>
                {active && <div className="prod-bar" style={{
                  backgroundColor: dark ? productionColors['진한 파랑'] : productionColors[task.color],
                  color: dark ? '#fff' : '#182637',
                }} title={`${task.name} · ${task.start} ~ ${task.finish}`}>
                  {first && <span className="prod-label" style={{ color: dark ? '#fff' : '#182637' }}>{task.name}</span>}
                </div>}
              </td>;
            })}
          </tr>;
        })}</tbody>
      </table>
    </div>
    {!rows.length && <p>검색 조건에 맞는 작업이 없습니다.</p>}
  </section>;
}
