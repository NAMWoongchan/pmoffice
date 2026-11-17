import React, { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { productionColors, type ProductionSchedule, type ProductionTask } from '../lib/nexpharm-production';
import { displayHours, scheduleLabels, type ScheduleLayout } from '../lib/nexpharm-schedule-layout';
import { productionTimescale, type DateScale } from '../lib/nexpharm-production-timescale';

const rowHeight = 32;
const headerHeight = 72;
const overscan = 32;
const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });

function useRowWindow(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 80 });
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const frame = window.frameElement;
    const outer = frame?.ownerDocument.defaultView ?? window;
    let request = 0;
    const update = () => {
      const frameTop = frame ? frame.getBoundingClientRect().top + frame.clientTop : 0;
      const top = host.getBoundingClientRect().top + frameTop + headerHeight;
      const start = Math.max(0, Math.min(count, Math.floor(-top / rowHeight)) - overscan);
      const end = Math.min(count, Math.max(start + 1, Math.ceil((outer.innerHeight - top) / rowHeight) + overscan));
      setRange(old => old.start === start && old.end === end ? old : { start, end });
    };
    const queue = () => {
      cancelAnimationFrame(request);
      request = requestAnimationFrame(update);
    };
    update();
    outer.addEventListener('scroll', queue, { passive: true });
    outer.addEventListener('resize', queue);
    if (outer !== window) window.addEventListener('resize', queue);
    return () => {
      cancelAnimationFrame(request);
      outer.removeEventListener('scroll', queue);
      outer.removeEventListener('resize', queue);
      window.removeEventListener('resize', queue);
    };
  }, [count]);
  return { ref, start: Math.min(range.start, count), end: Math.min(range.end, count) };
}

function Pane({ id, label, className, width, children }: {
  id?: string; label: string; className: string; width: number; children: ReactNode;
}) {
  const top = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  function sync(source: HTMLDivElement, target: HTMLDivElement | null) {
    if (target && source.scrollLeft !== target.scrollLeft) target.scrollLeft = source.scrollLeft;
  }
  return <div id={id} className={className}>
    <h2 className="nex-pane-title">{label}</h2>
    <div ref={top} className="nex-pane-horizontal" tabIndex={0} role="region" aria-label={label + ' 가로 스크롤'}
      onScroll={event => sync(event.currentTarget, grid.current)}>
      <div style={{ width }} aria-hidden="true"/>
    </div>
    <div ref={grid} className="nex-production-scroll" tabIndex={0} role="region" aria-label={label}
      onScroll={event => sync(event.currentTarget, top.current)}>{children}</div>
  </div>;
}

function dividerGeometry(divider: HTMLDivElement) {
  const panes = divider.parentElement!;
  const bounds = panes.getBoundingClientRect();
  const available = Math.max(0, bounds.width - divider.getBoundingClientRect().width);
  const minimum = Math.min(160, available * 0.3);
  return { panes, left: bounds.left, available, minimum, maximum: available - minimum,
    current: divider.previousElementSibling!.getBoundingClientRect().width };
}

function resizePanes(divider: HTMLDivElement, width: number, geometry = dividerGeometry(divider)) {
  const { panes, available, minimum, maximum } = geometry;
  if (available === 0) return;
  const share = Math.max(minimum, Math.min(width, maximum)) / available;
  panes.style.setProperty('--nex-adjusted-task-width', `calc(var(--nex-pane-space) * ${share})`);
}

function ScheduleDivider({ taskPaneId }: { taskPaneId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);
  const [range, setRange] = useState({ min: 0, max: 100, now: 50 });

  useLayoutEffect(() => {
    const divider = ref.current;
    if (!divider) return;
    const update = () => {
      const { available, minimum, maximum, current } = dividerGeometry(divider);
      if (available === 0) return;
      const percent = (width: number) => Math.round(width / available * 100);
      const next = { min: percent(minimum), max: percent(maximum), now: percent(current) };
      setRange(old => old.min === next.min && old.max === next.max && old.now === next.now ? old : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(divider.parentElement!);
    observer.observe(divider.previousElementSibling!);
    return () => observer.disconnect();
  }, []);

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.removeAttribute('data-dragging');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div ref={ref} className="nex-schedule-divider" role="separator" tabIndex={0}
    aria-label="작업 목록 너비 조절" aria-orientation="vertical" aria-controls={taskPaneId}
    aria-valuemin={range.min} aria-valuemax={range.max} aria-valuenow={range.now}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || drag.current) return;
      event.preventDefault();
      const divider = event.currentTarget;
      divider.focus({ preventScroll: true });
      divider.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, offset: event.clientX - divider.getBoundingClientRect().left };
      divider.setAttribute('data-dragging', '');
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const geometry = dividerGeometry(event.currentTarget);
      resizePanes(event.currentTarget, event.clientX - geometry.left - active.offset, geometry);
    }}
    onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const geometry = dividerGeometry(event.currentTarget);
      const { current, minimum, maximum } = geometry;
      const widths: Record<string, number> = { ArrowLeft: current - 24, ArrowRight: current + 24, Home: minimum, End: maximum };
      event.preventDefault();
      resizePanes(event.currentTarget, widths[event.key], geometry);
    }}/>;
}

function Spacer({ rows, columns }: { rows: number; columns: number }) {
  return rows > 0 ? <tr aria-hidden="true" className="nex-row-gap"><td colSpan={columns} style={{ height: rows * rowHeight }}/></tr> : null;
}

export function NexpharmProductionGrid({ schedule, layout, rows, parents, expanded, toggle, scale, resizable }: {
  schedule: ProductionSchedule; layout: ScheduleLayout; rows: ProductionTask[];
  parents: ReadonlySet<string>; expanded: ReadonlySet<string>; toggle: (id: string) => void; scale: DateScale; resizable?: boolean;
}) {
  const { ref, start, end } = useRowWindow(rows.length);
  const taskPaneId = useId();
  const fields = layout.fields.filter(field => field.key === 'name' || field.visible);
  const taskWidth = fields.reduce((sum, field) => sum + field.width, 0);
  const { columns, groups, daySlots } = useMemo(() => productionTimescale(schedule.days, scale), [schedule.days, scale]);
  const dateWidth = layout.ganttWidth;
  const chartWidth = columns.length * dateWidth;
  const chartVisible = layout.ganttVisible && chartWidth > 0;
  const showDivider = chartVisible && resizable;
  const windowRows = rows.slice(start, end);

  const offDays = useMemo(() => columns.flatMap(column => column.days.flatMap((day, i) => {
    if (day.workday) return [];
    const x = (daySlots.get(day.date) ?? 0) * dateWidth;
    return [{ date: day.date, x, width: dateWidth / column.days.length }];
  })), [columns, daySlots, dateWidth]);

  function segments(task: ProductionTask) {
    if (!task.start || !task.finish) return [];
    const bars: { from: number; to: number }[] = [];
    for (const column of columns) {
      for (const day of column.days) {
        if (day.date < task.start || day.date > task.finish
            || (!parents.has(task.id) && !day.workday && day.date !== task.start)) continue;
        const from = daySlots.get(day.date) ?? 0;
        const to = from + 1 / column.days.length;
        const previous = bars[bars.length - 1];
        if (previous && Math.abs(previous.to - from) < 0.00001) previous.to = to;
        else bars.push({ from, to });
      }
    }
    return bars;
  }

  return <section className="panel nex-production nex-production-full nex-windowed-schedule">
    <div ref={ref} className={'nex-schedule-panes' + (chartVisible ? ' nex-has-chart' : '') + (showDivider ? ' nex-resizable' : '')}>
      <Pane id={showDivider ? taskPaneId : undefined} label="작업 목록" className="nex-task-pane" width={taskWidth}>
        <table aria-label="생산 작업 목록" aria-rowcount={rows.length + 1} style={{ width: taskWidth, tableLayout: 'fixed' }}>
          <colgroup>{fields.map(field => <col key={field.key} style={{ width: field.width }}/>)}</colgroup>
          <thead><tr>{fields.map(field => <th key={field.key} scope="col" title={field.title ?? scheduleLabels[field.key]}>{field.title ?? scheduleLabels[field.key]}</th>)}</tr></thead>
          <tbody>
            <Spacer rows={start} columns={fields.length}/>
            {windowRows.map((task, i) => <tr key={task.id} data-task-id={task.id} aria-rowindex={start + i + 2}
              className={parents.has(task.id) ? 'prod-summary' : undefined}>
              {fields.map(field => {
                if (field.key === 'name') return <th key={field.key} scope="row" className="prod-task-name"
                  style={{ paddingInlineStart: Math.min(8 + (task.level - 1) * 14, Math.max(2, field.width - 30)) }}>
                  <span className="prod-task-label">
                    {parents.has(task.id) && <button type="button" className="prod-outline-button"
                      aria-label={task.name + (expanded.has(task.id) ? ' 접기' : ' 펼치기')}
                      aria-expanded={expanded.has(task.id)} onClick={() => toggle(task.id)}>{expanded.has(task.id) ? '−' : '+'}</button>}
                    <span title={task.name}>{task.name}</span>
                  </span>
                </th>;
                const raw = task[field.key];
                const value = field.key === 'hours' ? displayHours(raw) : typeof raw === 'number' ? number.format(raw) : raw;
                return <td key={field.key} className={'prod-value-' + field.key} title={String(value)}>{value}</td>;
              })}
            </tr>)}
            <Spacer rows={rows.length - end} columns={fields.length}/>
          </tbody>
        </table>
      </Pane>
      {showDivider && <ScheduleDivider taskPaneId={taskPaneId}/>}
      {chartVisible && <Pane label="간트 차트" className="nex-chart-pane" width={chartWidth}>
        <div className="nex-chart-track" style={{ width: chartWidth, '--nex-date-width': dateWidth + 'px' } as React.CSSProperties}>
          <table aria-label={scale === 'day' ? '일별 날짜 표시줄' : '주별 날짜 표시줄'}
            style={{ width: chartWidth, tableLayout: 'fixed' }}>
            <colgroup>{columns.map(column => <col key={column.date} style={{ width: dateWidth }}/>)}</colgroup>
            <thead>
              <tr>{groups.map(group => <th key={group.key} scope="colgroup" colSpan={group.span}>{group.label}</th>)}</tr>
              <tr>{columns.map(column => <th key={column.date} scope="col" title={column.date}
                className={column.days.every(day => !day.workday) ? 'prod-off' : undefined}>{column.date.slice(5).replace('-', '/')}</th>)}</tr>
              <tr>{columns.map(column => <th key={column.date} scope="col">{column.detail}</th>)}</tr>
            </thead>
          </table>
          <div className="nex-chart-rows" style={{ height: rows.length * rowHeight }} aria-label="작업 일정 막대">
            <div className="nex-chart-off" aria-hidden="true">{offDays.map(day =>
              <span key={day.date} style={{ left: day.x, width: day.width }}/>)}</div>
            {windowRows.map((task, i) => {
              const dark = task.level === 2 || task.color === '진한 파랑';
              return <div className="nex-chart-task" key={task.id} data-task-id={task.id}
                style={{ top: (start + i) * rowHeight }} aria-label={task.name}>
                {segments(task).map((bar, index) => <span key={bar.from} className="prod-bar"
                  title={task.name + ' · ' + task.start + ' ~ ' + task.finish}
                  style={{ left: bar.from * dateWidth, width: (bar.to - bar.from) * dateWidth,
                    backgroundColor: dark ? productionColors['진한 파랑'] : productionColors[task.color], color: dark ? '#fff' : '#182637' }}>
                  {index === 0 && <span className="prod-label">{task.name}</span>}
                </span>)}
              </div>;
            })}
          </div>
        </div>
      </Pane>}
    </div>
    {!rows.length && <p>선택한 개요 수준의 작업이 없습니다.</p>}
  </section>;
}
