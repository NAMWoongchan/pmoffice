import { isISODate } from './validation';

export type Scale = 'month' | 'week';
export type Period = { start: string; end: string; label: string };
const DAY = 86400000;
const date = (value: string) => new Date(value + 'T00:00:00Z');
const iso = (value: Date) => value.toISOString().slice(0, 10);

export function timeline(start: string, finish: string, scale: Scale, page: number) {
  const anchor = date(start);
  const span = scale === 'month' ? 12 : 16;
  if (scale === 'month') anchor.setUTCDate(1);
  else anchor.setUTCDate(anchor.getUTCDate() - (anchor.getUTCDay() + 6) % 7);

  const shift = (index: number) => {
    const boundary = new Date(anchor);
    if (scale === 'month') boundary.setUTCMonth(anchor.getUTCMonth() + index);
    else boundary.setUTCDate(anchor.getUTCDate() + index * 7);
    return boundary;
  };
  const periods: Period[] = [];
  for (let index = page * span; index < (page + 1) * span; index++) {
    const first = iso(shift(index));
    if (first > finish) break;
    const last = iso(new Date(shift(index + 1).getTime() - DAY));
    periods.push({
      start: first,
      end: last,
      label: scale === 'month'
        ? first.slice(0, 4) + '년 ' + Number(first.slice(5, 7)) + '월'
        : first.slice(5).replace('-', '.') + '–' + last.slice(5).replace('-', '.'),
    });
  }
  return { periods, hasNext: (periods.at(-1)?.end ?? '') < finish };
}

export function timelineBar(start: string, finish: string, milestone: boolean, period: Period) {
  if (!isISODate(start) || !isISODate(finish) || start > finish) return null;
  const begin = date(period.start).getTime();
  const end = date(period.end).getTime() + DAY;
  const position = (value: string) => (date(value).getTime() - begin) / (end - begin) * 100;
  const oneDay = DAY / (end - begin) * 100;
  if (milestone) {
    if (finish < period.start || finish > period.end) return null;
    return { left: position(finish) + oneDay / 2, width: 0 };
  }
  if (finish < period.start || start > period.end) return null;
  const left = Math.max(0, position(start));
  const right = Math.min(100, position(finish) + oneDay);
  return { left, width: right - left };
}
