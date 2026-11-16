import React, { useCallback, useEffect, useState } from 'react';
import { auth } from '../transport';
import { defaultScheduleLayout, fieldWidth, ganttWidth, scheduleLabels,
  type ScheduleLayout } from '../lib/nexpharm-schedule-layout';

export function useNexpharmScheduleSettings(project: string, enabled: boolean) {
  const [layout, setLayout] = useState(defaultScheduleLayout);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState('loading');
    void (async () => {
      try {
        const { data, error } = await auth.rpc('nexpharm_schedule_layout', { p_slug: project });
        if (error) throw error;
        if (active) {
          setLayout(data ?? defaultScheduleLayout());
          setState('ready');
        }
      } catch {
        if (active) setState('error');
      }
    })();
    return () => { active = false; };
  }, [enabled, project, attempt]);

  const save = useCallback(async (draft: ScheduleLayout) => {
    const { data, error } = await auth.rpc('nexpharm_schedule_layout', { p_slug: project, p_layout: draft });
    if (error || !data) throw Error('열 설정을 저장하지 못했습니다. 다시 시도해 주세요.');
    setLayout(data);
  }, [project]);
  return { layout, state, save, retry: () => setAttempt(previous => previous + 1) };
}

export function NexpharmScheduleSettings({ preferences, close }: {
  preferences: ReturnType<typeof useNexpharmScheduleSettings>; close: () => void;
}) {
  const { layout, state, save, retry } = preferences;
  const [draft, setDraft] = useState(layout);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setDraft(layout); }, [layout]);
  const valid = (width: number, bounds: { min: number; max: number }) =>
    Number.isInteger(width) && width >= bounds.min && width <= bounds.max;
  const canSave = draft.fields.every(field => valid(field.width, fieldWidth)) && valid(draft.ganttWidth, ganttWidth);

  function changeField(index: number, change: Partial<ScheduleLayout['fields'][number]>) {
    setDraft(previous => ({ ...previous, fields: previous.fields.map((field, i) => i === index ? { ...field, ...change } : field) }));
  }
  function move(index: number, offset: number) {
    setDraft(previous => {
      const fields = [...previous.fields];
      [fields[index], fields[index + offset]] = [fields[index + offset], fields[index]];
      return { ...previous, fields };
    });
  }

  return <section id="nex-schedule-settings" className="panel nex-schedule-settings" aria-labelledby="nex-schedule-settings-title">
    <h2 id="nex-schedule-settings-title">일정표 열 설정</h2>
    {state === 'error' ? <p role="alert">저장된 설정을 불러오지 못했습니다. <button type="button" onClick={retry}>다시 시도</button></p>
      : state === 'loading' ? <p role="status">저장된 설정을 불러오고 있습니다.</p> : <form onSubmit={async event => {
        event.preventDefault();
        if (busy || !canSave) return;
        setBusy(true);
        setMessage('');
        try { await save(draft); close(); }
        catch { setMessage('열 설정을 저장하지 못했습니다. 다시 시도해 주세요.'); }
        finally { setBusy(false); }
      }}>
        <ul className="nex-layout-list">{draft.fields.map((field, i) => {
          const label = scheduleLabels[field.key];
          return <li key={field.key}>
            <label><input type="checkbox" aria-label={label + ' 표시'} checked={field.visible}
              disabled={busy || field.key === 'name'} onChange={event => changeField(i, { visible: event.target.checked })}/>{label}</label>
            <label>너비 <input type="number" aria-label={label + ' 너비(px)'} value={field.width || ''} {...fieldWidth}
              required disabled={busy} onChange={event => changeField(i, { width: Number(event.target.value) })}/> px</label>
            <button type="button" aria-label={label + ' 위로'} disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" aria-label={label + ' 아래로'} disabled={busy || i === draft.fields.length - 1}
              onClick={() => move(i, 1)}>↓</button>
          </li>;
        })}</ul>
        <div className="nex-layout-actions">
          <label><input type="checkbox" checked={draft.ganttVisible} disabled={busy}
            onChange={event => setDraft(previous => ({ ...previous, ganttVisible: event.target.checked }))}/>간트 날짜 표시</label>
          <label>날짜 열 너비 <input type="number" aria-label="날짜 열 너비(px)" value={draft.ganttWidth || ''} {...ganttWidth} required
            disabled={busy} onChange={event => setDraft(previous => ({ ...previous, ganttWidth: Number(event.target.value) }))}/> px</label>
        </div>
        {message && <p role="alert">{message}</p>}
        <div className="nex-layout-actions">
          <button type="button" disabled={busy} onClick={() => setDraft(defaultScheduleLayout())}>기본값 복원</button>
          <button type="button" disabled={busy} onClick={close}>취소</button>
          <button type="submit" className="primary" disabled={busy || !canSave}>{busy ? '저장 중…' : '설정 저장'}</button>
        </div>
      </form>}
  </section>;
}
