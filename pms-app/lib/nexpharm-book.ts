import { strFromU8 } from 'fflate';
import { SaxesParser } from 'saxes';
import { milestoneTasks } from './milestones';
import { readSheet } from './server-xml';
import { isISODate } from './validation';
import { colName, displayCell, parseBook, today, type Book, type Sheet } from './workbook';

export type NexpharmFile = 'workbook' | 'reference';
const MAX_BYTES = 8 * 1024 * 1024;
const scheduleHeaders = { A: '작업 이름', B: '완료율', D: '시작', E: '완료', H: 'ID', M: '개요 수준', N: '개요 번호', O: '중요 시점' };

export function parseNexpharmFile(bytes: Uint8Array, name: string, kind: NexpharmFile): Book {
  if (!/\.xlsx$/i.test(name) || bytes.length > MAX_BYTES) throw Error('xlsx 파일을 최대 8MiB까지 등록할 수 있습니다.');
  const reference = kind === 'reference';
  const book = parseBook(bytes, name, {
    allowEmpty: true,
    skipTasks: reference,
    readSheet(text, strings, sheet) {
      if (sheet.hidden && (reference || sheet.name !== '_MSP_C0')) return readSheet('<worksheet/>', []);
      if (!reference && !['사업 일정표', '마일스톤 대시보드', '_MSP_C0'].includes(sheet.name)) return readSheet('<worksheet/>', []);
      return readSheet(text, strings, { skipBlank: true });
    },
  });
  if (Object.keys(book.files).some(path => /(?:^|\/)vbaProject\.bin$/i.test(path))) throw Error('매크로가 없는 xlsx 파일을 선택해 주세요.');
  if (reference) {
    if (!book.sheets.some(sheet => !sheet.hidden && (sheet.rows > 0 || sheetImages(book, sheet).length > 0))) {
      throw Error('표시할 셀이 있는 참고 통합문서를 선택해 주세요.');
    }
    return book;
  }
  const sheet = book.sheets.find(item => item.name === '사업 일정표' && !item.hidden);
  if (!sheet || Object.entries(scheduleHeaders).some(([column, title]) => sheet.cells[column + '1']?.v !== title)) {
    throw Error('사업 일정표 시트의 작업 이름, 완료율, 날짜, ID, WBS 및 중요 시점 열을 확인해 주세요.');
  }
  const rows = Object.entries(sheet.cells).filter(([address, cell]) => /^H(?:[2-9]|[1-9]\d+)$/.test(address) && cell.v !== '');
  if (book.tasks.length !== rows.length || !book.tasks.some(task => !task.summary)) {
    throw Error('작업의 ID, 이름 및 WBS를 확인해 주세요.');
  }
  if (book.tasks.some(task => !/^\d+$/.test(task.id) || !/^\d+(?:\.\d+)*$/.test(task.wbs)
    || !Number.isInteger(task.level) || task.level < 0
    || !isISODate(task.start) || !isISODate(task.finish) || task.finish < task.start
    || !Number.isFinite(task.pct) || task.pct < 0 || task.pct > 1)) {
    throw Error('작업의 날짜, ID, WBS 또는 완료율을 확인해 주세요.');
  }
  if (new Set(book.tasks.map(task => task.wbs)).size !== book.tasks.length) throw Error('중복된 WBS를 확인해 주세요.');
  return book;
}

export function scheduleSnapshot(book: Book) {
  const tasks = book.tasks;
  const start = tasks.reduce((value, task) => task.start < value ? task.start : value, tasks[0].start);
  const finish = tasks.reduce((value, task) => task.finish > value ? task.finish : value, tasks[0].finish);
  const dashboard = book.sheets.find(sheet => sheet.name === '마일스톤 대시보드');
  const master = book.sheets.find(sheet => sheet.name === '사업 일정표');
  const asOf = [dashboard?.cells.A3?.v, ...Object.entries(master?.cells ?? {})
    .filter(([address]) => /^A\d+$/.test(address)).map(([, cell]) => cell.v)]
    .map(value => String(value ?? '').match(/판정 기준일:\s*(\d{4}-\d{2}-\d{2})/)?.[1])
    .find((value): value is string => !!value && isISODate(value)) ?? today();
  const work = tasks.filter(task => !task.summary);
  const completed = work.filter(task => task.pct === 1).length;
  return { start, finish, asOf, total: work.length, completed, remaining: work.length - completed, milestones: milestoneTasks(tasks) };
}

function xmlTags(book: Book, path: string, names: string[]) {
  const tags: { name: string; attributes: Record<string, string> }[] = [];
  if (!book.files[path]) return tags;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', tag => {
    const name = tag.name.split(':').at(-1)!;
    if (names.includes(name)) tags.push({ name, attributes: tag.attributes });
  });
  parser.write(strFromU8(book.files[path])).close();
  return tags;
}

function internalTarget(book: Book, path: string, id: string | undefined) {
  if (!id) return '';
  const split = path.lastIndexOf('/') + 1;
  const relPath = path.slice(0, split) + '_rels/' + path.slice(split) + '.rels';
  const rel = xmlTags(book, relPath, ['Relationship']).find(item => item.attributes.Id === id)?.attributes;
  if (!rel?.Target || rel.TargetMode === 'External') return '';
  const url = new URL(rel.Target, 'https://workbook.invalid/' + path);
  return url.origin === 'https://workbook.invalid' && url.pathname.startsWith('/xl/') ? url.pathname.slice(1) : '';
}

const imageTypes: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export function sheetImages(book: Book, sheet: Sheet) {
  return xmlTags(book, sheet.path, ['drawing']).flatMap(node => {
    const drawing = internalTarget(book, sheet.path, node.attributes['r:id']);
    let title = '';
    return xmlTags(book, drawing, ['blip', 'cNvPr']).flatMap(tag => {
      if (tag.name === 'cNvPr') { title = tag.attributes.descr ?? ''; return []; }
      const path = internalTarget(book, drawing, tag.attributes['r:embed']);
      const type = imageTypes[path.split('.').at(-1)?.toLowerCase() ?? ''];
      if (!path.startsWith('xl/media/') || !type || !book.files[path]) return [];
      return [{ bytes: book.files[path], type, title }];
    });
  });
}

export function referenceRows(book: Book, sheet: Sheet) {
  const grid = new Map<number, Map<string, string>>();
  const columns = new Set<string>();
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const match = address.match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    const value = displayCell(book, cell);
    if (!value) continue;
    const [, column, row] = match;
    const columnIndex = [...column].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
    if (sheet.hiddenCols.includes(columnIndex)) continue;
    columns.add(column);
    const rowNumber = Number(row);
    const values = grid.get(rowNumber) ?? new Map<string, string>();
    values.set(column, value);
    grid.set(rowNumber, values);
  }
  const ordered = Array.from({ length: Math.min(sheet.cols, 16384) }, (_, index) => colName(index + 1))
    .filter(column => columns.has(column));
  return { columns: ordered, rows: [...grid.entries()].sort(([a], [b]) => a - b) };
}
