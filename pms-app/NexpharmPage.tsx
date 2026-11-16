import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CalendarRange, ChevronRight, Download, FileText, Flag, FolderUp, Menu, X } from 'lucide-react';
import { NexpharmReference } from './components/NexpharmReference';
import { NexpharmSchedule } from './components/NexpharmSchedule';
import { NexpharmProductionGrid } from './components/NexpharmProductionGrid';
import { productionOutline, presetBranches, type OutlinePreset } from './lib/nexpharm-outline';
import type { DateScale } from './lib/nexpharm-production-timescale';
import { NexpharmProductionCalendar } from './components/NexpharmProductionCalendar';
import { NexpharmScheduleSettings, useNexpharmScheduleSettings } from './components/NexpharmScheduleSettings';
import { auth, slug } from './transport';
import { nexpharmFile, type FileMeta } from './lib/nexpharm-api';
import { parseNexpharmFile, scheduleSnapshot, type NexpharmFile } from './lib/nexpharm-book';
import type { Book } from './lib/workbook';
import { parseProductionWorkbook, PRODUCTION, type NexpharmTemplate, type ProductionSchedule } from './lib/nexpharm-production';
import './nexpharm.css';

const menu = [
  { key: 'schedule', label: '사업 일정표', icon: CalendarRange },
  { key: 'milestones', label: '마일스톤 대시보드', icon: Flag },
  { key: 'reference', label: '세부 정보', icon: FileText },
  { key: 'files', label: '파일 관리', icon: FolderUp },
] as const;
const calendarMenu = { key: 'calendar', label: '달력 설정', icon: CalendarDays } as const;
const productionMenu = [menu[0], calendarMenu] as const;
type View = typeof menu[number]['key'] | typeof calendarMenu.key | 'settings';
type Entry = { meta?: FileMeta | null; book?: Book; production?: ProductionSchedule; legacy?: boolean; error?: string };
const kinds = ['workbook', 'reference'] as const;
const labels = { workbook: '공정표', reference: '참고 정보' };
const center = '/pms/nexpharm/';
const embedded = new URLSearchParams(location.search).get('embed') === '1';

function readView(): View {
  const key = location.hash.slice(1);
  if (key === 'settings') return key;
  return [...menu, calendarMenu].find(item => item.key === key)?.key ?? 'schedule';
}

export default function NexpharmPage({ title, canManage, template }: { title: string; canManage: boolean; template?: NexpharmTemplate }) {
  const isProduction = template === PRODUCTION;
  const visibleMenu = isProduction ? [...productionMenu, ...(canManage ? [menu[3]] : [])] : menu;
  const availableKinds = isProduction ? kinds.slice(0, 1) : kinds;
  const [view, setView] = useState<View>(readView);
  const activeView = (isProduction && view === 'settings') || visibleMenu.some(item => item.key === view) ? view : 'schedule';
  const fullSchedule = isProduction && activeView === 'schedule';
  const preferences = useNexpharmScheduleSettings(slug, isProduction);
  const [outline, setOutline] = useState<OutlinePreset>('1');
  const [branches, setBranches] = useState<Set<string>>(() => new Set());
  const [scale, setScale] = useState<DateScale>('day');
  const settingsOpened = useRef(false);
  const shell = useRef<HTMLDivElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const [entries, setEntries] = useState<Record<NexpharmFile, Entry>>({ workbook: {}, reference: {} });
  const [busy, setBusy] = useState<NexpharmFile | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobile, setMobile] = useState(false);
  const mounts = useRef(true);
  const revisions = useRef({ workbook: 0, reference: 0 });

  const navigate = useCallback((target: View, reset = target === 'schedule') => {
    if (reset) {
      setOutline('1');
      setBranches(new Set());
    }
    if (target === 'settings') settingsOpened.current = true;
    location.hash = target;
    setView(target);
    setMobile(false);
  }, []);

  useEffect(() => {
    if (!embedded || !isProduction || window.parent === window) return;
    const sendView = () => window.parent.postMessage({
      type: 'pmoffice-nexpharm-view', project: slug, view: activeView,
    }, location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== location.origin
          || event.data?.type !== 'pmoffice-nexpharm-navigate' || event.data.project !== slug) return;
      const target = event.data.view;
      if (target === 'schedule' || target === 'calendar' || (target === 'files' && canManage)) navigate(target);
    };
    sendView();
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [activeView, isProduction, canManage, navigate]);

  useEffect(() => {
    if (!embedded || !fullSchedule || window.parent === window) return;
    const pageKey = (event: KeyboardEvent) => {
      if (!['PageDown', 'PageUp'].includes(event.key) || event.defaultPrevented
          || (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable=true]'))) return;
      event.preventDefault();
      window.parent.scrollBy(0, (event.key === 'PageDown' ? 1 : -1) * Math.max(100, window.parent.innerHeight - 64));
    };
    window.addEventListener('keydown', pageKey);
    return () => window.removeEventListener('keydown', pageKey);
  }, [fullSchedule]);

  useEffect(() => {
    if (!embedded || !isProduction || window.parent === window || !shell.current) return;
    const root = shell.current;
    const send = (height: number | null) => window.parent.postMessage(
      { type: 'pmoffice-nexpharm-schedule-height', project: slug, height }, window.location.origin);
    const measure = () => send(Math.ceil(root.getBoundingClientRect().height));
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    return () => { observer.disconnect(); send(null); };
  }, [isProduction]);

  function closeSettings() {
    if (settingsOpened.current) history.back();
    else {
      history.replaceState(history.state, '', '#schedule');
      setView('schedule');
    }
  }

  useEffect(() => {
    if (!fullSchedule || !settingsOpened.current) return;
    settingsOpened.current = false;
    settingsButton.current?.focus({ preventScroll: true });
  }, [fullSchedule]);

  const refresh = useCallback(async (kind: NexpharmFile) => {
    const revision = ++revisions.current[kind];
    const save = (entry: Entry) => {
      if (mounts.current && revision === revisions.current[kind]) setEntries(previous => ({ ...previous, [kind]: entry }));
    };
    let meta: FileMeta | null | undefined;
    try {
      if (isProduction && kind === 'workbook') {
        const { data, error } = await auth.rpc('nexpharm_production_snapshot', { p_slug: slug });
        if (error && !['PGRST202', '42883'].includes(error.code)) throw Error(error.message);
        if (data) {
          save({ meta: data.current, production: data.schedule ?? undefined });
          return;
        }
      }
      const { current } = await (await nexpharmFile(kind, 'meta')).json() as { current: FileMeta | null };
      meta = current;
      if (!current) { save({ meta: null }); return; }
      if (isProduction) {
        const { etag, schedule } = await (await nexpharmFile(kind, 'schedule')).json();
        if (etag !== current.etag) throw Error('파일이 변경되었습니다. 다시 확인해 주세요.');
        save({ meta: current, production: schedule, legacy: true });
        return;
      }
      const response = await nexpharmFile(kind, 'file');
      if (response.headers.get('ETag') !== current.etag) throw Error('파일이 변경되었습니다. 다시 확인해 주세요.');
      const book = parseNexpharmFile(new Uint8Array(await response.arrayBuffer()), current.name, kind);
      save({ meta: current, book });
    } catch (reason) {
      save({ meta, error: reason instanceof Error ? reason.message : '파일을 읽지 못했습니다.' });
    }
  }, [isProduction]);

  useEffect(() => {
    mounts.current = true;
    if (isProduction) refresh('workbook');
    else kinds.forEach(refresh);
    const sync = () => setView(readView());
    window.addEventListener('hashchange', sync);
    return () => {
      mounts.current = false;
      window.removeEventListener('hashchange', sync);
    };
  }, [isProduction, refresh]);

  async function change(kind: NexpharmFile, action: 'publish' | 'remove', file?: File) {
    const entry = entries[kind];
    if (!canManage || busy || entry.meta === undefined) return;
    if (action === 'remove' && !entry.meta) return;
    if (action === 'remove' && !window.confirm(entry.meta?.name + ' 파일을 현재 게시본에서 제거하시겠습니까?')) return;
    if (action === 'publish' && entry.meta && !window.confirm('현재 ' + labels[kind] + ' 파일을 교체하시겠습니까?')) return;
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      let body: ArrayBuffer | undefined;
      const headers = new Headers({ 'If-Match': entry.meta?.etag ?? 'seed' });
      if (file) {
        if (file.size > 8 * 1024 * 1024) throw Error('Excel 파일을 최대 8MiB까지 등록할 수 있습니다.');
        body = await file.arrayBuffer();
        if (isProduction) parseProductionWorkbook(new Uint8Array(body), file.name);
        else parseNexpharmFile(new Uint8Array(body), file.name, kind);
        headers.set('Content-Type', 'application/octet-stream');
        headers.set('X-Filename', encodeURIComponent(file.name));
      }
      const result = await (await nexpharmFile(kind, action, { method: 'POST', headers, body })).json();
      await refresh(kind);
      setNotice(labels[kind] + (action === 'publish' ? ' 파일을 등록했습니다.' : ' 파일을 제거했습니다.')
        + (result.audit_recorded === false ? ' 감사 기록 확인이 필요합니다.' : ''));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '파일 변경을 완료하지 못했습니다.');
      if ((reason as { status?: number }).status === 409) await refresh(kind);
    } finally { setBusy(null); }
  }

  async function migrateProduction() {
    if (!preferences.canApplyGlobal || busy) return;
    setBusy('workbook');
    setError('');
    try {
      await nexpharmFile('workbook', 'migrate', { method: 'POST' });
      await refresh('workbook');
      setNotice('게시된 생산 일정을 데이터베이스로 이관했습니다.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '생산 일정 이관을 완료하지 못했습니다.');
    } finally { setBusy(null); }
  }

  async function download(kind: NexpharmFile) {
    if (busy) return;
    setBusy(kind);
    setError('');
    try {
      const response = await nexpharmFile(kind, 'file');
      const name = decodeURIComponent(response.headers.get('X-Filename') || 'original.xlsx');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '다운로드를 완료하지 못했습니다.');
    } finally { setBusy(null); }
  }

  const schedule = entries.workbook;
  const reference = entries.reference;
  const snapshot = useMemo(() => schedule.book ? scheduleSnapshot(schedule.book) : null, [schedule.book]);
  const selectedMenu = visibleMenu.find(item => item.key === activeView);
  const viewLabel = activeView === 'settings' ? '일정표 열 설정' : fullSchedule ? title.replace(/생산계획$/, '생산 계획') : selectedMenu?.label ?? '일정표';
  const production = schedule.production;
  const hierarchy = useMemo(() => productionOutline(production?.tasks ?? []), [production]);
  const expanded = useMemo(() => outline === 'custom' ? branches : presetBranches(production?.tasks ?? [], outline), [production, branches, outline]);
  const rows = useMemo(() => (production?.tasks ?? []).filter(task => {
    if (outline !== 'custom') return outline === 'all' || task.level <= Number(outline);
    return (task.level === 1 || (hierarchy.ancestors.get(task.id)?.length ?? 0) > 0)
      && (hierarchy.ancestors.get(task.id) ?? []).every(id => expanded.has(id));
  }), [production, hierarchy, outline, expanded]);

  function toggleBranch(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
      for (const child of next) if (hierarchy.ancestors.get(child)?.includes(id)) next.delete(child);
    } else next.add(id);
    setBranches(next);
    setOutline('custom');
  }

  function unavailable(kind: NexpharmFile) {
    const entry = entries[kind];
    return <section className="panel nex-empty-detail">
      <p>{entry.error || (entry.meta === null ? '등록된 ' + labels[kind] + ' 없음' : '파일을 불러오고 있습니다.')}</p>
      {entry.error && <button onClick={() => refresh(kind)}>다시 확인</button>}
      {entry.meta === null && canManage && <button onClick={() => navigate('files')}>파일 관리 열기</button>}
    </section>;
  }

  const navigation = <nav aria-label="프로젝트 일정 보기">{visibleMenu.map(({ key, label, icon: Icon }) =>
    <button key={key} className={key === activeView ? 'selected' : ''} aria-current={key === activeView ? 'page' : undefined}
      onClick={() => navigate(key)}><Icon size={19}/><span>{isProduction && key === 'schedule' ? '일정표' : label}</span></button>)}</nav>;

  return <div ref={shell} className={'app-shell nex-detail' + (embedded ? ' nex-embedded' : '')
    + (isProduction ? ' nex-full-schedule' : '')}>
    {!embedded && mobile && <button className="sidebar-overlay" aria-label="메뉴 닫기" onClick={() => setMobile(false)}/>}
    {!embedded && <aside className={'sidebar ' + (mobile ? 'mobile-open' : '')}>
      <a className="brand" href={center} target="_top"><span className="brand-symbol">P</span><strong>PMOffice<span>넥스팜 PMS</span></strong></a>
      <button className="mobile-close" onClick={() => setMobile(false)} aria-label="메뉴 닫기"><X size={20}/></button>
      <div className="sidebar-content">
        <div className="project-label"><span>넥스팜 프로젝트</span><strong>{title}</strong>
          {snapshot && <small>{snapshot.start} ~ {snapshot.finish}</small>}</div>
        {navigation}
      </div>
      <div className="sidebar-footer"><a className="nex-center-link" href={center} target="_top">← 프로젝트 센터</a></div>
    </aside>}
    <div className="main-area">
      {!embedded && <div className="topbar">
        <button className="hamburger" onClick={() => setMobile(true)} aria-label="메뉴 열기" aria-expanded={mobile}><Menu size={22}/></button>
        <span className="breadcrumb">넥스팜 PMS <ChevronRight size={14}/> <strong>{viewLabel}</strong></span>
        <span className="source-indicator">{canManage ? '파일 관리 가능' : '열람 회원'}</span>
      </div>}
      <main>
        {embedded && !isProduction && <div className="nex-view-nav">{navigation}</div>}
        {activeView !== 'settings' && <header className="page-header"><div><h1 className={fullSchedule ? 'nex-production-title' : undefined}>{viewLabel}</h1>{!fullSchedule && <p>{title}</p>}</div>
          <div className="header-actions">
            {fullSchedule && <>
              <select value={scale} aria-label="날짜 표시줄" onChange={event => setScale(event.target.value as DateScale)}>
                <option value="day">일(Day)</option><option value="week">주(Week)</option>
              </select>
              <select value={outline} aria-label="개요 수준" onChange={event => setOutline(event.target.value as OutlinePreset)}>
                <option value="all">모든 개요 수준</option>
                {outline === 'custom' && <option value="custom" disabled>직접 펼치기</option>}
                {[1, 2, 3].map(level => <option key={level} value={level}>{level}수준까지</option>)}
              </select>
              <button type="button" ref={settingsButton} onClick={() => navigate('settings')}>설정</button>
            </>}
            {(activeView === 'schedule' || activeView === 'milestones') && (!isProduction || canManage) && schedule.meta && <button className="primary" disabled={!!busy}
              onClick={() => download('workbook')}><Download size={16}/> 공정표 원본</button>}
            {activeView === 'reference' && reference.meta && <button className="primary" disabled={!!busy}
              onClick={() => download('reference')}><Download size={16}/> 참고 엑셀 원본</button>}
          </div>
        </header>}
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="nex-message" role="status">{notice}</p>}
        {activeView === 'settings' && <NexpharmScheduleSettings preferences={preferences} close={closeSettings}/>}
        {activeView === 'schedule' && (production
          ? <NexpharmProductionGrid key={schedule.meta?.etag} schedule={production} layout={preferences.layout}
              rows={rows} parents={hierarchy.parents} expanded={expanded} toggle={toggleBranch} scale={scale}/>
          : schedule.book && snapshot
          ? <NexpharmSchedule key={schedule.meta?.etag} tasks={schedule.book.tasks} {...snapshot}/>
          : unavailable('workbook'))}
        {activeView === 'calendar' && (schedule.production
          ? <NexpharmProductionCalendar days={schedule.production.days}/>
          : unavailable('workbook'))}
        {activeView === 'milestones' && (snapshot ? <>
          <div className="nex-kpis">
            {[['전체 작업', snapshot.total], ['완료', snapshot.completed], ['잔여', snapshot.remaining], ['마일스톤', snapshot.milestones.length]].map(([label, value]) =>
              <div className="panel" key={label}><span>{label}</span><strong>{value}건</strong></div>)}
          </div>
          <section className="panel nex-milestone">
            <h2>마일스톤 목록</h2><p>판정 기준일 {snapshot.asOf} · 최하위 작업 기준</p>
            {snapshot.milestones.length ? <div className="nex-table-scroll" tabIndex={0} role="region" aria-label="마일스톤 목록">
              <table className="nex-reference-table"><thead><tr>
                {['WBS', '마일스톤', '예정일', '완료율', '상태'].map(label => <th scope="col" key={label}>{label}</th>)}
              </tr></thead><tbody>{snapshot.milestones.map(task => {
                const status = task.pct === 1 ? '완료' : task.finish < snapshot.asOf ? '기한 경과 미완료' : task.start > snapshot.asOf ? '예정' : '기간 내 미완료';
                return <tr key={task.id}><td>{task.wbs}</td><th scope="row">{task.name}</th><td>{task.finish}</td>
                  <td>{Math.round(task.pct * 100)}%</td><td><span className={'nex-status ' + (task.pct === 1 ? 'done' : task.finish < snapshot.asOf ? 'late' : '')}>{status}</span></td></tr>;
              })}</tbody></table>
            </div> : <p>표시할 마일스톤이 없습니다.</p>}
          </section>
        </> : unavailable('workbook'))}
        {activeView === 'reference' && (reference.book ? <NexpharmReference key={reference.meta?.etag} book={reference.book}/> : unavailable('reference'))}
        {activeView === 'files' && <div className="nex-file-list">{availableKinds.map(kind => {
          const entry = entries[kind];
          return <section className="panel nex-file" key={kind}><h2>{labels[kind]}</h2>
            <p>{entry.meta?.name || entry.error || (entry.meta === null ? '등록된 파일 없음' : '파일 확인 중…')}</p>
            <div>
              {canManage && entry.meta !== undefined && <label className={'nex-upload ' + (busy ? 'disabled' : '')}>
                {entry.meta ? '엑셀 교체' : '엑셀 업로드'}<input type="file" accept={isProduction ? '.xlsx,.xlsm' : '.xlsx'} aria-label={labels[kind] + ' 엑셀 업로드'}
                  disabled={!!busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) change(kind, 'publish', file); }}/>
              </label>}
              {entry.meta && <button disabled={!!busy} onClick={() => download(kind)}>원본 다운로드</button>}
              {slug === 'nexpharm-8088c44595a3' && entry.legacy && preferences.canApplyGlobal &&
                <button disabled={!!busy} onClick={migrateProduction}>게시 일정 DB로 이관</button>}
              {entry.meta && canManage && <button className="nex-remove" disabled={!!busy} onClick={() => change(kind, 'remove')}>제거</button>}
              {entry.error && <button onClick={() => refresh(kind)}>다시 확인</button>}
            </div>
          </section>;
        })}</div>}
      </main>
    </div>
  </div>;
}
