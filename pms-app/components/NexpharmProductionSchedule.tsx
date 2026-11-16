import React, { useMemo, useState } from 'react';
import { productionColors, type ProductionSchedule } from '../lib/nexpharm-production';
import { displayHours, scheduleColumns, scheduleLabels, type ScheduleLayout } from '../lib/nexpharm-schedule-layout';

const pageSize = 60;
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
const display = (value: string | number) => typeof value === 'number' ? number.format(value) : value;

export function NexpharmProductionSchedule({ schedule, layout, level = '' }: {
  schedule: ProductionSchedule; layout?: ScheduleLayout; level?: string;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    if (layout) return level ? schedule.tasks.filter(task => task.level <= Number(level)) : schedule.tasks;
    const search = query.trim().toLocaleLowerCase('ko');
    return search ? schedule.tasks.filter(task => [task.name, task.code, task.resource]
      .some(value => value.toLocaleLowerCase('ko').includes(search))) : schedule.tasks;
  }, [schedule, query, level, layout]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = layout ? filtered : filtered.slice(page * pageSize, (page + 1) * pageSize);
  const fields = layout ? layout.fields.filter(field => field.key === 'name' || field.visible)
    : scheduleColumns.map(([key, , width]) => ({ key, width }));
  const days = layout?.ganttVisible === false ? [] : schedule.days;
  const width = layout ? fields.reduce((sum, field) => sum + field.width, 0) + days.length * layout.ganttWidth : undefined;

  return <section className={'panel nex-production' + (layout ? ' nex-production-full' : '')}>
    {!layout && <div className="nex-production-toolbar">
      <label>작업 검색<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }}/></label>
      <span role="status">{query.trim() ? `${number.format(filtered.length)}개 검색 · ` : ''}{number.format(schedule.tasks.length)}개 일정 항목</span>
      <nav aria-label="일정표 페이지">
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button>
        <span>{page + 1} / {pages}</span>
        <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>다음</button>
      </nav>
    </div>}
    <div className="nex-production-scroll" tabIndex={0} role="region" aria-label="작업 목록과 일별 간트 차트">
      <table style={layout ? { width, tableLayout: 'fixed' } : undefined}>
        {layout && <colgroup>
          {fields.map(field => <col key={field.key} style={{ width: field.width }}/>)}
          {days.map(day => <col key={day.date} style={{ width: layout.ganttWidth }}/>)}
        </colgroup>}
        <thead><tr>
          {fields.map(({ key }) => <th key={key} scope="col" className={'prod-' + key} title={scheduleLabels[key]}>{scheduleLabels[key]}</th>)}
          {days.map(day => <th key={day.date} scope="col" title={day.date}
            className={'prod-day' + (day.workday ? '' : ' prod-off')}>{day.date.slice(5).replace('-', '/')}</th>)}
        </tr></thead>
        <tbody>{rows.map(task => {
          const summary = task.level < 3;
          const dark = task.level === 2 || task.color === '진한 파랑';
          return <tr key={task.id} className={summary ? 'prod-summary' : undefined}>
            {fields.map(({ key, width }) => {
              if (key === 'name') return <th key={key} scope="row" className="prod-name" title={task.name}
                style={{ paddingInlineStart: Math.min(10 + (task.level - 1) * 14, width / 2) }}>{task.name}</th>;
              const value = layout && key === 'hours' ? displayHours(task.hours) : display(task[key]);
              return <td key={key} className={'prod-' + key} title={String(value)}>{value}</td>;
            })}
            {days.map(day => {
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
