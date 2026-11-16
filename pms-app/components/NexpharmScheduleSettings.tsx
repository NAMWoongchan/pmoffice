import React, { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '../transport';
import { defaultScheduleLayout, fieldWidth, ganttWidth, scheduleLabels,
  type ScheduleLayout } from '../lib/nexpharm-schedule-layout';

type Preferences = { layout: ScheduleLayout; common: ScheduleLayout; revision: number; canApplyGlobal: boolean };
const defaults = (): Preferences => ({
  layout: defaultScheduleLayout(), common: defaultScheduleLayout(), revision: 0, canApplyGlobal: false,
});

export function useNexpharmScheduleSettings(project: string, enabled: boolean) {
  const [preferences, setPreferences] = useState(defaults);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let loaded = false;
    const read = async () => {
      const id = ++sequence.current;
      try {
        const { data, error } = await auth.rpc('nexpharm_schedule_preferences', { p_slug: project });
        if (error || !data) throw error;
        if (active && id === sequence.current) {
          loaded = true;
          setPreferences(data);
          setState('ready');
        }
      } catch {
        if (active && !loaded && id === sequence.current) setState('error');
      }
    };
    setState('loading');
    void read();
    const timer = window.setInterval(read, 30000);
    window.addEventListener('focus', read);
    const frame = window.frameElement;
    const host = frame?.ownerDocument.defaultView;
    if (host && host !== window) host.addEventListener('focus', read);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', read);
      if (host && host !== window) host.removeEventListener('focus', read);
    };
  }, [enabled, project, attempt]);

  const save = useCallback(async (layout: ScheduleLayout, revision: number, global: boolean) => {
    const { data, error } = await auth.rpc('nexpharm_schedule_preferences', {
      p_slug: project, p_action: global ? 'global' : 'personal', p_layout: layout, p_revision: revision,
    });
    if (error?.code === '40001') throw Error('공통 설정이 변경되었습니다. 최신 공통값을 불러온 뒤 다시 적용해 주세요.');
    if (error || !data) throw Error('열 설정을 저장하지 못했습니다. 다시 시도해 주세요.');
    ++sequence.current;
    setPreferences(data);
    setState('ready');
  }, [project]);

  return { ...preferences, state, save, retry: () => setAttempt(previous => previous + 1) };
}

type Settings = ReturnType<typeof useNexpharmScheduleSettings>;
const valid = (width: number, bounds: { min: number; max: number }) =>
  Number.isInteger(width) && width >= bounds.min && width <= bounds.max;

function SettingsForm({ preferences, close }: { preferences: Settings; close: () => void }) {
  const [draft, setDraft] = useState(preferences.layout);
  const [revision, setRevision] = useState(preferences.revision);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const problems = draft.fields.some(field => !valid(field.width, fieldWidth) || !(field.title ?? scheduleLabels[field.key]).trim())
    || !valid(draft.ganttWidth, ganttWidth);

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

  async function apply(global: boolean) {
    if (busy) return;
    setSubmitted(true);
    if (problems) {
      setMessage('표시된 입력값을 확인해 주세요.');
      return;
    }
    if (global && !window.confirm('모든 열람 사용자의 현재 열 설정을 이 공통값으로 적용하시겠습니까?')) return;
    setBusy(true);
    setMessage('');
    try {
      await preferences.save(draft, revision, global);
      close();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '열 설정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return <form noValidate onSubmit={event => { event.preventDefault(); void apply(false); }}>
    <ul className="nex-layout-list">{draft.fields.map((field, i) => {
      const label = scheduleLabels[field.key];
      const title = field.title ?? label;
      const invalidWidth = submitted && !valid(field.width, fieldWidth);
      const invalidTitle = submitted && !title.trim();
      return <li key={field.key}>
        <label><input type="checkbox" aria-label={label + ' 표시'} checked={field.visible}
          disabled={busy || field.key === 'name'} onChange={event => changeField(i, { visible: event.target.checked })}/>{label}</label>
        <label>열 제목 <input type="text" aria-label={label + ' 열 제목'} maxLength={80} value={title}
          aria-invalid={invalidTitle} aria-describedby={invalidTitle ? 'nex-title-' + field.key : undefined}
          disabled={busy} onChange={event => changeField(i, { title: event.target.value })}/></label>
        <label>너비 <input type="number" aria-label={label + ' 너비(px)'} value={field.width || ''} {...fieldWidth}
          aria-invalid={invalidWidth} aria-describedby={invalidWidth ? 'nex-width-' + field.key : undefined}
          step={1} disabled={busy} onChange={event => changeField(i, { width: Number(event.target.value) })}/> px</label>
        <button type="button" aria-label={label + ' 위로'} disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button>
        <button type="button" aria-label={label + ' 아래로'} disabled={busy || i === draft.fields.length - 1}
          onClick={() => move(i, 1)}>↓</button>
        {invalidTitle && <small id={'nex-title-' + field.key}>열 제목을 입력해 주세요.</small>}
        {invalidWidth && <small id={'nex-width-' + field.key}>너비는 48~600px의 정수로 입력해 주세요.</small>}
      </li>;
    })}</ul>
    <div className="nex-layout-actions">
      <label><input type="checkbox" checked={draft.ganttVisible} disabled={busy}
        onChange={event => setDraft(previous => ({ ...previous, ganttVisible: event.target.checked }))}/>간트 날짜 표시</label>
      <label>날짜 열 너비 <input type="number" aria-label="날짜 열 너비(px)" value={draft.ganttWidth || ''} {...ganttWidth}
        aria-invalid={submitted && !valid(draft.ganttWidth, ganttWidth)}
        aria-describedby={submitted && !valid(draft.ganttWidth, ganttWidth) ? 'nex-gantt-width' : undefined}
        step={1} disabled={busy} onChange={event => setDraft(previous => ({ ...previous, ganttWidth: Number(event.target.value) }))}/> px</label>
      {submitted && !valid(draft.ganttWidth, ganttWidth) && <small id="nex-gantt-width">36~180px의 정수로 입력해 주세요.</small>}
    </div>
    {message && <p role="alert">{message}</p>}
    <div className="nex-layout-actions">
      <button type="button" disabled={busy} onClick={() => {
        setDraft(preferences.common);
        setRevision(preferences.revision);
        setMessage('');
        setSubmitted(false);
      }}>기본값 복원</button>
      <button type="button" disabled={busy} onClick={close}>취소</button>
      <button type="submit" className="primary" disabled={busy}>{busy ? '저장 중…' : '설정 적용'}</button>
      {preferences.canApplyGlobal && <button type="button" className="nex-global-layout" disabled={busy}
        onClick={() => void apply(true)}>전역 설정 적용</button>}
    </div>
  </form>;
}

export function NexpharmScheduleSettings({ preferences, close }: { preferences: Settings; close: () => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  return <section id="nex-schedule-settings" className="panel nex-schedule-settings" aria-labelledby="nex-schedule-settings-title">
    <h1 id="nex-schedule-settings-title" ref={title} tabIndex={-1}>일정표 열 설정</h1>
    {preferences.state === 'error'
      ? <p role="alert">저장된 설정을 불러오지 못했습니다. <button type="button" onClick={preferences.retry}>다시 시도</button> <button type="button" onClick={close}>취소</button></p>
      : preferences.state === 'loading'
        ? <p role="status">저장된 설정을 불러오고 있습니다.</p>
        : <SettingsForm preferences={preferences} close={close}/>}
  </section>;
}
