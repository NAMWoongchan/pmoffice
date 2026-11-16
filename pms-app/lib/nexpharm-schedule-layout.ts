import type { ProductionTask } from './nexpharm-production';

export const fieldWidth = { min: 48, max: 600 };
export const ganttWidth = { min: 36, max: 180 };
export const scheduleColumns = [
  ['id', 'ID', 52], ['name', '작업 이름', 260], ['code', '전산코드', 144], ['lot', '제조번호', 70],
  ['quantity', '제조량', 88], ['duration', '기간', 64], ['hours', 'M/H', 90],
  ['start', '시작', 100], ['finish', '완료', 100], ['resource', '자원 이름', 214],
  ['predecessor', '선행 작업', 96], ['unit', '포장 단위', 86], ['category', '구분', 90],
  ['contractor', '위수탁사', 112], ['notes', '메모', 180],
] as const satisfies readonly (readonly [keyof ProductionTask, string, number])[];

export type ScheduleColumn = typeof scheduleColumns[number][0];
export type ScheduleLayout = {
  fields: { key: ScheduleColumn; width: number; visible: boolean; title?: string }[];
  ganttVisible: boolean;
  ganttWidth: number;
};

export function defaultScheduleLayout(): ScheduleLayout {
  return { fields: scheduleColumns.map(([key, , width]) => ({ key, width, visible: true })),
    ganttVisible: true, ganttWidth: 60 };
}

export const scheduleLabels = Object.fromEntries(scheduleColumns.map(([key, label]) => [key, label])) as Record<ScheduleColumn, string>;
const hoursFormat = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const displayHours = (value: string | number) => typeof value === 'number' ? hoursFormat.format(value) : value;
