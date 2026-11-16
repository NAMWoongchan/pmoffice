import config from './inquiry-public.json';

export async function workbookRequest(session, slug, action, options = {}) {
  const params = new URLSearchParams({ project: slug, action, kind: 'workbook' });
  const headers = new Headers(options.headers);
  headers.set('apikey', config.publishableKey);
  headers.set('Authorization', 'Bearer ' + session.access_token);
  const response = await fetch(config.url + '/functions/v1/nexpharm-pms?' + params, {
    ...options, headers, cache: 'no-store',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw Object.assign(Error(data?.error || '공정표 요청을 완료하지 못했습니다.'), { status: response.status });
  }
  return response;
}

export async function workbookRange(buffer, name) {
  const { parseNexpharmFile } = await import('../../../pms-app/lib/nexpharm-book.ts');
  const { tasks } = parseNexpharmFile(new Uint8Array(buffer), name, 'workbook');
  let { start, finish } = tasks[0];
  for (const task of tasks) {
    if (task.start < start) start = task.start;
    if (task.finish > finish) finish = task.finish;
  }
  return { start, finish };
}

export function projectMonths(ranges) {
  const index = date => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const spans = Object.fromEntries(Object.entries(ranges).filter(([, range]) => range?.start && range.finish)
    .map(([slug, range]) => [slug, [index(range.start), index(range.finish)]]));
  const periods = Object.values(spans);
  if (!periods.length) return { labels: [], spans: {} };
  const start = Math.min(...periods.map(period => period[0]));
  const finish = Math.max(...periods.map(period => period[1]));
  const labels = Array.from({ length: finish - start + 1 }, (_, offset) => {
    const month = start + offset;
    return String(Math.floor(month / 12)).slice(-2).padStart(2, '0') + '-' + String(month % 12 + 1).padStart(2, '0');
  });
  return {
    labels,
    spans: Object.fromEntries(Object.entries(spans).map(([slug, [first, last]]) => [slug, [first - start + 1, last - first + 1]])),
  };
}

const tags = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li']);
const removed = new Set(['script', 'style', 'svg', 'math', 'iframe', 'object', 'template']);

export function cleanComment(value) {
  if (!value) return { html: '', text: '' };
  if (typeof document === 'undefined') return { html: '', text: '' };
  const input = document.createElement('template');
  input.innerHTML = value;
  const output = document.createElement('div');
  function append(node, target) {
    if (node.nodeType === 3) { target.append(node.textContent); return; }
    const tag = node.localName;
    if (!tag || removed.has(tag)) return;
    const element = tags.has(tag) ? target.appendChild(document.createElement(tag)) : target;
    for (const child of node.childNodes) append(child, element);
  }
  for (const child of input.content.childNodes) append(child, output);
  const text = [...output.childNodes].map(node => node.textContent).join(' ').replace(/\s+/g, ' ').trim();
  return { html: output.innerHTML, text };
}
