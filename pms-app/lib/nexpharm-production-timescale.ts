import type { ProductionSchedule } from './nexpharm-production';

export type DateScale = 'day' | 'week';
type Day = ProductionSchedule['days'][number];
type DateColumn = { days: Day[]; month: string; group: string; date: string; detail: string };
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const utcDay = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay();

export function productionTimescale(days: readonly Day[], scale: DateScale) {
  const columns: DateColumn[] = [];
  const daySlots = new Map<string, number>();
  let previousMonth = '';
  for (const day of days) {
    const month = day.date.slice(0, 7);
    const date = Number(day.date.slice(8));
    const weekday = utcDay(day.date);
    const firstWeekday = utcDay(month + '-01');
    const week = Math.floor((date - 1 + (firstWeekday + 6) % 7) / 7) + 1;
    const [year, m] = month.split('-');
    const group = scale === 'day'
      ? Number(m) + '월 ' + (date <= 10 ? '초순' : date <= 20 ? '중순' : '하순')
      : year + '년 ' + Number(m) + '월';
    const detail = scale === 'day' ? weekdays[weekday] : 'W' + week;
    let column = columns[columns.length - 1];
    if (scale === 'day' || previousMonth !== month || column?.detail !== detail) {
      column = { days: [], month, group, date: day.date, detail };
      columns.push(column);
    }
    column.days.push(day);
    previousMonth = month;
  }
  columns.forEach((column, i) => column.days.forEach((day, j) => daySlots.set(day.date, i + j / column.days.length)));
  const groups: { key: string; label: string; span: number }[] = [];
  for (const column of columns) {
    const key = column.month + column.group;
    const group = groups[groups.length - 1];
    if (group?.key === key) group.span++;
    else groups.push({ key, label: column.group, span: 1 });
  }
  return { columns, groups, daySlots };
}
