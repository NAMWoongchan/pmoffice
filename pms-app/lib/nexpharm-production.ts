import { readSheet } from './server-xml';
import { excelDate } from './task-model';
import { isISODate } from './validation';
import { address, parseBook } from './workbook';

export const RD = 'rd';
export const PRODUCTION = 'production_outsourcing';
export type NexpharmTemplate = typeof RD | typeof PRODUCTION;
export const workbookLimit = 8 * 1024 * 1024;
export const productionColors: Record<string, string> = {
  '파랑': '#4472C4', '진한 파랑': '#1F4E78', '하늘색': '#DDEBF7', '오렌지색': '#FCE4D6',
  '보라': '#CCC0DA', '빨강': '#FFC7CE', '옅은 빨강': '#FCE8E8', '연주황': '#FFE699',
  '초록': '#C6EFCE', '기타': '#E7E6E6',
};

const expected = {
  A: 'ID', B: '작업 이름', C: '전산코드', D: '제조번호', E: '제조량', F: '기간', G: '작업 시간',
  H: '시작', I: '완료', J: '자원 이름', K: '선행 작업', L: '포장 단위', M: '구분', N: '위수탁사',
  O: '메모', P: '개요 수준', Q: '막대 색깔',
};
type ScheduleValue = string | number;
export type ProductionTask = {
  id: string; name: string; level: number; start: string; finish: string; color: string;
  code: string; lot: string; quantity: ScheduleValue; duration: ScheduleValue; hours: ScheduleValue;
  resource: string; predecessor: string; unit: string; category: string; contractor: string; notes: string;
};
export type ProductionSchedule = {
  title: string; start: string; finish: string;
  days: { date: string; workday: boolean }[];
  tasks: ProductionTask[];
};

export function parseProductionWorkbook(bytes: Uint8Array, filename: string): ProductionSchedule {
  if (!/\.(xlsx|xlsm)$/i.test(filename) || bytes.length > workbookLimit) {
    throw Error('생산위수탁관리 Excel(.xlsx, .xlsm) 파일을 최대 8MiB까지 등록할 수 있습니다.');
  }
  const book = parseBook(bytes, filename, {
    allowEmpty: true,
    skipTasks: true,
    readSheet(text, strings, sheet) {
      return readSheet(!sheet.hidden && sheet.name === '일정표' ? text : '<worksheet/>', strings, { skipBlank: true });
    },
  });
  const sheet = book.sheets.find(item => item.name === '일정표' && !item.hidden);
  if (!sheet || Object.entries(expected).some(([col, title]) => sheet.cells[col + '1']?.v !== title)) {
    throw Error('생산위수탁관리 형식의 일정표 시트와 열 제목을 확인해 주세요.');
  }
  const cell = (col: string, row: number) => {
    const item = sheet.cells[col + row];
    if (item?.t === 'e') throw Error(`일정표 ${col}${row}의 Excel 오류를 수정해 주세요.`);
    return item?.v ?? '';
  };
  const date = (value: unknown) => typeof value === 'number' && value > 0 && value < 2958466
    ? excelDate(value, book.date1904) : typeof value === 'string' && isISODate(value) ? value : '';
  const numberOrText = (value: unknown): ScheduleValue => typeof value === 'number' ? value : String(value);
  const rows = Object.keys(sheet.cells).filter(key => /^B\d+$/.test(key))
    .map(key => Number(key.slice(1))).filter(row => row >= 3 && String(cell('B', row)).trim()).sort((a, b) => a - b);
  if (!rows.length || rows.length > 11000) throw Error('일정표에 1~11,000개의 작업 행이 필요합니다.');
  const ids = new Set<string>();
  const tasks = rows.map((row): ProductionTask => {
    const value = (col: string) => cell(col, row);
    const string = (col: string) => String(value(col));
    const id = string('A').trim();
    const level = Number(value('P'));
    const start = date(value('H'));
    const finish = date(value('I'));
    if (!/^\d+$/.test(id) || Number(id) < 1 || ids.has(id) || ![1, 2, 3].includes(level)) {
      throw Error(`일정표 ${row}행의 고유 ID와 개요 수준을 확인해 주세요.`);
    }
    if ((value('H') !== '' && !start) || (value('I') !== '' && !finish) || (start && finish && finish < start)) {
      throw Error(`일정표 ${row}행의 시작·완료 날짜를 확인해 주세요.`);
    }
    ids.add(id);
    return {
      id, level, start, finish, name: string('B'),
      color: Object.hasOwn(productionColors, string('Q')) ? string('Q') : '기타',
      code: string('C'), lot: string('D'), quantity: numberOrText(value('E')), duration: numberOrText(value('F')),
      hours: numberOrText(value('G')), resource: string('J'), predecessor: string('K'), unit: string('L'),
      category: string('M'), contractor: string('N'), notes: string('O'),
    };
  });
  const days = Object.keys(sheet.cells).filter(key => /^[A-Z]+1$/.test(key) && address(key).c >= 18)
    .sort((a, b) => address(a).c - address(b).c).flatMap(key => {
      const dt = date(cell(key.slice(0, -1), 1));
      if (!dt) return [];
      const flag = cell(key.slice(0, -1), 2);
      const weekday = new Date(dt + 'T00:00:00Z').getUTCDay();
      return [{ date: dt, workday: flag === 1 || (flag === '' && weekday > 0 && weekday < 6) }];
    });
  if (!days.length || days.length > 366 || days.some((day, i) => i > 0 && day.date <= days[i - 1].date)) {
    throw Error('일정표 R열부터 날짜를 오름차순으로 입력해 주세요.');
  }
  const starts = tasks.map(task => task.start).filter(Boolean).sort();
  const finishes = tasks.map(task => task.finish).filter(Boolean).sort();
  return {
    title: String(cell('B', 2)).trim().slice(0, 160) || filename.replace(/\.(xlsx|xlsm)$/i, '').slice(0, 160),
    start: starts[0] ?? '', finish: finishes.at(-1) ?? '', days, tasks,
  };
}
