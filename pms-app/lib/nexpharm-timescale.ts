import { isISODate } from './validation';

export type Period = { start: string; end: string; label: string };
const DAY = 86400000;
const date = (value: string) => new Date(value + 'T00:00:00Z');
const iso = (value: Date) => value.toISOString().slice(0, 10);

export function timeline(start: string, finish: string, page: number) {
  const anchor = date(start);
  const span = 12;
  anchor.setUTCDate(1);

  const shift = (index: number) => {
    const boundary = new Date(anchor);
    boundary.setUTCMonth(anchor.getUTCMonth() + index);
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
      label: first.slice(2, 7),
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
  return { left: 0, width: 100 };
}
