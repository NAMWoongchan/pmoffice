import React from 'react';
import type { ProductionSchedule } from '../lib/nexpharm-production';
import './nexpharm-production-calendar.css';

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];

export function NexpharmProductionCalendar({ days }: Pick<ProductionSchedule, 'days'>) {
  const month = days[0]?.date.slice(0, 7);
  if (!month) return <section className="panel nex-empty-detail"><p>게시된 계획 월의 날짜가 없습니다.</p></section>;

  const [year, monthNumber] = month.split('-');
  const first = new Date(month + '-01T00:00:00Z');
  const offset = (first.getUTCDay() + 6) % 7;
  const inMonth = days.filter(day => day.date.startsWith(month + '-'));
  const end = new Date(first);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const weekCount = Math.ceil((offset + end.getUTCDate()) / 7);
  const byDay = new Map(inMonth.map(day => [Number(day.date.slice(8)), day]));
  const workdays = inMonth.filter(day => day.workday).length;

  return <section className="panel nex-production-calendar">
    <table>
      <caption>
        <strong>{year}년 {Number(monthNumber)}월</strong>
        <span>작업일 {workdays}일 <span aria-hidden="true">·</span> 휴무일 {inMonth.length - workdays}일</span>
      </caption>
      <thead><tr>{weekdays.map(day => <th key={day} scope="col">{day}</th>)}</tr></thead>
      <tbody>{Array.from({ length: weekCount }, (_, week) => <tr key={week}>
        {weekdays.map((weekday, column) => {
          const day = byDay.get(week * 7 + column - offset + 1);
          if (!day) return <td key={weekday} className="nex-calendar-empty"/>;
          return <td key={weekday} className={day.workday ? undefined : 'nex-calendar-off'}>
            <time dateTime={day.date}>{Number(day.date.slice(8))}</time>
            <span>{day.workday ? '작업일' : '휴무일'}</span>
          </td>;
        })}
      </tr>)}</tbody>
    </table>
  </section>;
}
